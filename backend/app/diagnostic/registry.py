"""Scenario Registry and Compatibility Validator for Cluezy Diagnostic Engine.

Ensures that deterministic diagnostic scenarios are ONLY activated for problems
that strictly match their problem domain. Prevents unrelated hardware, power,
software, and conversational problems from falsely triggering specialized checks
(e.g. running 1.1.1.1 network ping checks for laptop shutdown problems).
"""

from enum import Enum
from typing import Any, Dict, List, Optional, Set
from pydantic import BaseModel


class TriageDisposition(str, Enum):
    """Investigation triage category."""
    SUPPORTED_SCENARIO = "supported_scenario"
    UNSUPPORTED_RECOGNIZED = "unsupported_recognized"
    UNCLEAR_CLARIFICATION = "unclear_clarification"


class ScenarioMetadata(BaseModel):
    """Metadata describing a diagnostic scenario and its strict activation criteria."""
    id: str
    name: str
    category: str
    description: str
    required_keywords: List[str]
    incompatible_keywords: List[str]
    incompatible_categories: List[str]


class ScenarioRegistry:
    """Central registry and compatibility validator for diagnostic scenarios."""

    def __init__(self) -> None:
        self._scenarios: Dict[str, ScenarioMetadata] = {}
        self._register_default_scenarios()

    def _register_default_scenarios(self) -> None:
        """Register the built-in deterministic scenarios."""
        self.register(
            ScenarioMetadata(
                id="wifi_no_internet",
                name="Wi-Fi connected but no internet access",
                category="Network",
                description="Troubleshooting local IP, default gateway, DNS, and ISP WAN connectivity when Wi-Fi is connected.",
                required_keywords=[
                    "wifi",
                    "wi-fi",
                    "internet",
                    "dns",
                    "gateway",
                    "router",
                    "network",
                    "offline",
                    "browser",
                    "page",
                    "site",
                    "ping",
                    "ip",
                    "web",
                    "ethernet",
                    "apipa",
                    "169.254",
                ],
                incompatible_keywords=[
                    "shut down",
                    "shutdown",
                    "shuts down",
                    "turns off",
                    "turn off",
                    "overheat",
                    "fan",
                    "blue screen",
                    "bsod",
                    "crash",
                    "python",
                    "code",
                    "syntax",
                    "exception",
                    "noise",
                    "clicking",
                    "smoke",
                    "battery",
                    "charger",
                    "keyboard",
                    "trackpad",
                    "screen black",
                    "audio",
                    "microphone",
                    "camera",
                    "postgresql",
                    "postgres",
                    "database",
                    "5432",
                    "econnrefused",
                    "eaddrinuse",
                    "docker",
                    "git",
                    "localhost",
                    "127.0.0.1",
                    "zoom",
                    "teams",
                    "bluetooth",
                    "hdmi",
                    "monitor",
                    "installer",
                    "windows update",
                    "100% disk",
                    "100% cpu",
                    "freezing",
                ],
                incompatible_categories=[
                    "Hardware",
                    "Operating System",
                    "Software",
                    "Programming",
                    "Audio",
                    "Display",
                    "Power",
                ],
            )
        )

    def register(self, scenario: ScenarioMetadata) -> None:
        """Register a new diagnostic scenario."""
        self._scenarios[scenario.id] = scenario

    def get_scenario(self, scenario_id: str) -> Optional[ScenarioMetadata]:
        """Retrieve scenario metadata by ID."""
        return self._scenarios.get(scenario_id)

    def is_unclear_problem(self, problem_description: str, confidence: float = 0.0) -> bool:
        """Detect whether a problem statement is too vague or brief to diagnose directly."""
        text = problem_description.strip().lower()
        words = text.split()

        # Very short or purely generic statements
        unclear_phrases = [
            "it is not working",
            "it's not working",
            "not working",
            "doesn't work",
            "does not work",
            "broken",
            "help",
            "help me",
            "it broke",
            "problem",
            "issue",
            "something is wrong",
            "nothing works",
        ]
        if text in unclear_phrases:
            return True

        if len(words) <= 3 and any(w in text for w in ["working", "broken", "help", "fix", "issue", "problem"]):
            return True

        if len(text) < 15 and confidence < 0.45:
            return True

        return False

    def find_compatible_scenario(
        self,
        problem_description: str,
        category: Optional[str] = None,
        suggested_scenario: Optional[str] = None,
        confidence: float = 0.0,
    ) -> Optional[ScenarioMetadata]:
        """Validate whether a compatible deterministic scenario exists for the user's problem.

        Returns ScenarioMetadata if and only if:
        1. The problem is in a matching category.
        2. The problem does NOT contain incompatible domain keywords.
        3. The problem text contains domain-relevant required keywords.
        """
        text_lower = problem_description.strip().lower()
        cat_lower = (category or "").strip().lower()

        # Check each registered scenario
        for sc in self._scenarios.values():
            # 1. Category check
            if cat_lower:
                for bad_cat in sc.incompatible_categories:
                    if bad_cat.lower() in cat_lower:
                        return None
                if sc.category.lower() not in cat_lower and cat_lower not in sc.category.lower():
                    # Category mismatch
                    continue

            # 2. Incompatible keywords check (e.g. "shuts down" in network scenario)
            has_incompatible = any(bad_kw in text_lower for bad_kw in sc.incompatible_keywords)
            if has_incompatible:
                continue

            # 3. Required keywords check (at least one must match)
            has_required = any(req_kw in text_lower for req_kw in sc.required_keywords)
            if not has_required:
                continue

            # Compatible match found
            return sc

        return None

    def triage_investigation(
        self,
        problem_description: str,
        category: Optional[str] = None,
        suggested_scenario: Optional[str] = None,
        confidence: float = 0.0,
    ) -> TriageDisposition:
        """Triage an investigation into supported deterministic, unsupported recognized, or unclear."""
        if self.is_unclear_problem(problem_description, confidence=confidence):
            return TriageDisposition.UNCLEAR_CLARIFICATION

        matched = self.find_compatible_scenario(
            problem_description=problem_description,
            category=category,
            suggested_scenario=suggested_scenario,
            confidence=confidence,
        )
        if matched is not None:
            return TriageDisposition.SUPPORTED_SCENARIO

        return TriageDisposition.UNSUPPORTED_RECOGNIZED


# Global scenario registry instance
scenario_registry = ScenarioRegistry()

