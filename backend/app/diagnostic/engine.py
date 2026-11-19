"""Diagnostic engine facade orchestrating rules, scoring, and question planning."""

import logging
from typing import Any, Dict, List, Optional, Set, Tuple

from app.diagnostic.planner import question_planner
from app.diagnostic.rules import rule_engine
from app.diagnostic.scenarios.wifi_no_internet import (
    CAUSES,
    QUESTIONS,
    RULES,
    SCENARIO_NAME,
)
from app.diagnostic.scorer import cause_scorer
from app.diagnostic.types import DiagnosticQuestionDef, PlannedStep, ScoredCause

logger = logging.getLogger(__name__)


class DiagnosticEngine:
    """Central orchestrator for deterministic, explainable technical problem solving."""

    def __init__(self):
        self.scenario_name = SCENARIO_NAME
        self.causes_catalog = CAUSES
        self.rules = RULES
        self.questions = QUESTIONS

    def get_question_by_id(self, question_id: str) -> Optional[DiagnosticQuestionDef]:
        """Look up question definition by identifier."""
        return next((q for q in self.questions if q.id == question_id), None)

    def match_action_title_to_cause_slug(self, action_title: Optional[str]) -> Optional[str]:
        """Resolve a recommended action title back to its catalog cause slug."""
        if not action_title:
            return None
        title_lower = action_title.lower().strip()
        if title_lower in self.causes_catalog:
            return title_lower

        for slug, cause_def in self.causes_catalog.items():
            fix_title = cause_def.get("fix_action", {}).get("title", "").lower()
            cause_title = cause_def.get("title", "").lower()
            if (
                (fix_title and (fix_title == title_lower or fix_title in title_lower or title_lower in fix_title))
                or (cause_title and cause_title in title_lower)
            ):
                return slug

        if "dns" in title_lower and ("8.8.8.8" in title_lower or "change" in title_lower):
            return "dns_resolution_failure"
        if "power cycle" in title_lower or "router" in title_lower or "gateway" in title_lower:
            return "gateway_connectivity_failure"
        if "dhcp" in title_lower or "renew" in title_lower or "ipconfig" in title_lower:
            return "ip_configuration_issue"
        if "isp" in title_lower or "outage" in title_lower or "ont" in title_lower:
            return "isp_outage"
        return None

    def get_action_help_guidance(self, action_title: Optional[str]) -> str:
        """Retrieve detailed OS-specific guidance for a recommended remediation action."""
        slug = self.match_action_title_to_cause_slug(action_title)
        if slug and slug in self.causes_catalog:
            guidance = self.causes_catalog[slug].get("fix_action", {}).get("help_guidance")
            if guidance:
                return guidance
        return (
            "Here is additional guidance to execute this step on Windows:\n"
            "1. Press **Windows Key + R**, type `cmd`, and press **Enter** to open Command Prompt.\n"
            "2. Follow each numbered step carefully and check if websites begin loading.\n"
            "3. When finished, click **It's working now** or **Still not working** below."
        )

    def map_option_to_evidence(
        self,
        question_id: Optional[str],
        option_value: str,
    ) -> Optional[Tuple[str, Any]]:
        """Map user-selected quick-reply option value or label to an evidence key and value."""
        if not option_value:
            return None

        val_lower = option_value.lower().strip().replace("’", "'")

        # Global explicit negative check first so "It doesn't open" never matches "It opens"
        if "doesn't open" in val_lower or "does not open" in val_lower or "ip_unreachable" in val_lower:
            return ("ip_reachable", False)
        if "it opens" in val_lower or "ip_reachable" in val_lower or "1.1.1.1 loads" in val_lower or "ping succeeds" in val_lower:
            return ("ip_reachable", True)

        # If question_id is provided, check that specific question first
        candidates = [self.get_question_by_id(question_id)] if question_id else self.questions
        for q in candidates:
            if not q:
                continue
            for opt in q.options:
                opt_val = opt.get("value", "").lower().replace("’", "'")
                opt_lbl = opt.get("label", "").lower().replace("’", "'")
                if (
                    val_lower == opt_val
                    or val_lower == opt_lbl
                    or (len(val_lower) > 4 and (val_lower in opt_lbl or opt_lbl in val_lower))
                    or (len(opt_val) > 4 and opt_val in val_lower)
                ):
                    key = opt.get("evidence_key")
                    val = opt.get("evidence_val")
                    if key is not None:
                        return (key, val)

        # Fallback global aliases for natural language replies
        if "timed out" in val_lower or "unreachable" in val_lower:
            if question_id == "check_gateway_ping" or "gateway" in val_lower or "192.168" in val_lower:
                return ("gateway_ping_success", False)
            return ("ip_reachable", False)
        if "other devices work" in val_lower or "other_devices_ok" in val_lower or "phone works" in val_lower or "yes, other" in val_lower:
            return ("other_devices_working", True)
        if "all devices down" in val_lower or "all_devices_down" in val_lower or "no devices work" in val_lower or "no, all" in val_lower:
            return ("other_devices_working", False)
        if "valid_ip" in val_lower or "192.168." in val_lower or "10.0." in val_lower or "standard ip" in val_lower:
            if question_id != "check_gateway_ping":
                return ("has_valid_ip", True)
        if "apipa" in val_lower or "169.254" in val_lower:
            return ("has_valid_ip", False)
        if "gateway_reachable" in val_lower or "router replies" in val_lower or "yes, router" in val_lower:
            return ("gateway_ping_success", True)
        if "gateway_unreachable" in val_lower or "router unreachable" in val_lower:
            return ("gateway_ping_success", False)
        if "lights_normal" in val_lower or "green" in val_lower or "white" in val_lower:
            return ("router_wan_down", False)
        if "lights_error" in val_lower or "red" in val_lower or "orange" in val_lower or "blinking" in val_lower:
            return ("router_wan_down", True)
        if "not sure" in val_lower or "unknown" in val_lower or "cannot access" in val_lower or "no other devices" in val_lower:
            if question_id:
                q_obj = self.get_question_by_id(question_id)
                if q_obj and q_obj.options:
                    ek = q_obj.options[0].get("evidence_key")
                    if ek:
                        return (ek, None)
            return ("unknown", None)

        return None

    def evaluate_and_progress(
        self,
        evidence_map: Dict[str, Any],
        answered_question_ids: Set[str],
        tested_actions: Optional[Dict[str, str]] = None,
        last_action_outcome: Optional[str] = None,
    ) -> Tuple[List[ScoredCause], PlannedStep]:
        """Compute updated candidate cause scores and plan the next optimal diagnostic step."""
        # Normalize tested_actions keys to cause slugs
        normalized_tested: Dict[str, str] = {}
        if tested_actions:
            for k, v in tested_actions.items():
                slug = self.match_action_title_to_cause_slug(k) or k
                normalized_tested[slug] = v

        # 1. Cause Scoring Engine: rank and update causes with verifiable reason logs
        scored_causes = cause_scorer.compute_cause_scores(
            causes_catalog=self.causes_catalog,
            evidence_map=evidence_map,
            rules=self.rules,
            tested_actions=normalized_tested,
        )

        # Known evidence keys (with non-None values)
        known_keys = {k for k, v in evidence_map.items() if v is not None and v != "unknown"}

        # 2. Diagnostic Question Planner: select next distinguishing check or solution action
        next_step = question_planner.plan_next_step(
            scored_causes=scored_causes,
            all_questions=self.questions,
            answered_question_ids=answered_question_ids,
            known_evidence_keys=known_keys,
            causes_catalog=self.causes_catalog,
            last_action_outcome=last_action_outcome,
            tested_actions=normalized_tested,
        )

        return scored_causes, next_step


diagnostic_engine = DiagnosticEngine()
