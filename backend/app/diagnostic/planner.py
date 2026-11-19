"""Diagnostic question and action planner selecting optimal distinguishing tests."""

import logging
from typing import Any, Dict, List, Optional, Set
from app.diagnostic.types import DiagnosticQuestionDef, PlannedStep, ScoredCause

logger = logging.getLogger(__name__)


class DiagnosticQuestionPlanner:
    """Plans the next investigative inquiry or remediation check based on discriminating power."""

    def plan_next_step(
        self,
        scored_causes: List[ScoredCause],
        all_questions: List[DiagnosticQuestionDef],
        answered_question_ids: Set[str],
        known_evidence_keys: Set[str],
        causes_catalog: Dict[str, Dict[str, Any]],
        last_action_outcome: Optional[str] = None,
        tested_actions: Optional[Dict[str, str]] = None,
    ) -> PlannedStep:
        """Select the next question or recommended action to isolate the root cause.

        Rules:
        - Avoid asking questions whose answers are already known.
        - Avoid repeating previously asked/answered questions.
        - Prioritize questions that distinguish between the top competing causes.
        - If confidence is high or questions exhausted, recommend a solution action for the top untried cause.
        - If a fix was unsuccessful, continue investigating alternatives without premature resolution.
        """
        tested = tested_actions or {}

        # If user explicitly confirmed the fix is working, await explicit resolution confirmation
        if last_action_outcome == "working":
            return PlannedStep(
                step_type="resolution_ready",
                reason="User reported the recommended fix restored internet access. Ready for explicit resolution confirmation.",
                suggested_responses=["Yes, problem is resolved", "Still having issues"],
            )

        active_causes = [c for c in scored_causes if c.status != "ruled_out"]
        untried_causes = [c for c in active_causes if tested.get(c.slug) != "not_working"]

        top_cause = untried_causes[0] if untried_causes else (active_causes[0] if active_causes else None)
        second_cause = untried_causes[1] if len(untried_causes) > 1 else None

        # Filter out questions already answered or whose evidence key is already populated
        available_questions: List[DiagnosticQuestionDef] = []
        for q in all_questions:
            if q.id in answered_question_ids:
                continue

            # Check if any option's evidence_key is already established with a non-None value
            keys_for_q = {opt.get("evidence_key") for opt in q.options if opt.get("evidence_key")}
            if keys_for_q and keys_for_q.issubset(known_evidence_keys):
                continue

            available_questions.append(q)

        # Decision threshold:
        # 1. If the user just reported an action as "not_working" and we still have distinguishing questions left,
        #    ask the next distinguishing question before jumping straight to another fix.
        # 2. Otherwise, if top untried cause has High confidence (score >= 0.70) and a clear margin (>= 0.25),
        #    OR if all distinguishing questions are exhausted and an untried cause exists, recommend its fix!
        score_gap = (top_cause.score - second_cause.score) if (top_cause and second_cause) else 1.0
        should_recommend_fix = False

        if untried_causes and top_cause:
            if last_action_outcome == "not_working" and available_questions:
                # Prefer gathering additional evidence after a failed fix when questions remain
                should_recommend_fix = False
            elif top_cause.score >= 0.70 and score_gap >= 0.25:
                should_recommend_fix = True
            elif not available_questions:
                # No more distinguishing questions left; test the best remaining untried candidate cause
                should_recommend_fix = True

        if should_recommend_fix and top_cause and untried_causes:
            cause_meta = causes_catalog.get(top_cause.slug, {})
            fix_meta = cause_meta.get("fix_action", {})
            if fix_meta:
                action_title = fix_meta.get("title", f"Apply fix for {top_cause.title}")
                action_steps = fix_meta.get("steps", [])

                return PlannedStep(
                    step_type="recommended_action",
                    action_title=action_title,
                    action_steps=action_steps,
                    reason=(
                        f"Candidate cause '{top_cause.title}' is the leading untried hypothesis ({top_cause.likelihood}, "
                        f"score: {top_cause.score:.2f}). Recommending targeted remediation steps."
                    ),
                    suggested_responses=["It's working now", "Still not working", "I need help"],
                )

        # Otherwise, select the question with the highest discriminating power between top active causes
        best_question: Optional[DiagnosticQuestionDef] = None
        best_discriminating_score = -1.0
        selection_reason = ""

        candidate_pool = untried_causes[:2] if untried_causes else active_causes[:2]
        top_slugs = {c.slug for c in candidate_pool}

        for q in available_questions:
            overlap = set(q.discriminates_between).intersection(top_slugs)
            score = float(len(overlap))

            # Bonus for practical diagnostic actions (e.g. ping test / IP check)
            if q.action_type == "action":
                score += 0.5

            if score > best_discriminating_score:
                best_discriminating_score = score
                best_question = q
                competing_titles = " vs ".join(c.title for c in candidate_pool)
                selection_reason = (
                    f"Selected '{q.id}' ({q.action_type}) to distinguish between leading candidate causes: {competing_titles}."
                )

        if best_question:
            suggested = [opt["label"] for opt in best_question.options]
            return PlannedStep(
                step_type="question",
                question=best_question,
                reason=selection_reason,
                suggested_responses=suggested,
            )

        # Fallback: Escalation condition if no questions and all plausible causes' fixes have been tried
        return PlannedStep(
            step_type="escalation",
            reason="Diagnostic inquiries and primary remediation actions exhausted. Escalating for advanced technician or ISP support.",
            suggested_responses=["Contact Support", "Restart Investigation"],
        )


question_planner = DiagnosticQuestionPlanner()
