"""Cause scoring engine ranking candidate causes with transparent reasoning."""

import logging
from typing import Any, Dict, List, Optional
from app.diagnostic.types import EvidenceEvaluation, ScoredCause

logger = logging.getLogger(__name__)


def score_to_likelihood(score: float, status: str) -> str:
    """Map numeric continuous score to categorical user-facing likelihood."""
    if status == "ruled_out":
        return "Low"
    if status == "confirmed":
        return "High"
    if score >= 0.70:
        return "High"
    if score >= 0.40:
        return "Medium"
    return "Low"


class CauseScoringEngine:
    """Updates and ranks candidate causes deterministically while maintaining evidence provenance."""

    def compute_cause_scores(
        self,
        causes_catalog: Dict[str, Dict[str, Any]],
        evidence_map: Dict[str, Any],
        rules: List[Dict[str, Any]],
        previous_scores: Optional[Dict[str, ScoredCause]] = None,
        tested_actions: Optional[Dict[str, str]] = None,  # {cause_slug: outcome e.g. 'not_working'}
    ) -> List[ScoredCause]:
        """Calculate updated cause scores and rankings based on accumulated evidence and action outcomes."""
        scored_causes: Dict[str, ScoredCause] = {}

        # 1. Initialize causes with baseline scores
        for slug, cause_def in causes_catalog.items():
            base_score = cause_def.get("base_score", 0.40)
            initial_status = "suspected"
            prev_reasons = []

            # Preserve previous investigation context if available
            if previous_scores and slug in previous_scores:
                prev = previous_scores[slug]
                initial_status = prev.status
                prev_reasons = list(prev.reasons)

            scored_causes[slug] = ScoredCause(
                slug=slug,
                title=cause_def.get("title", slug),
                score=base_score,
                likelihood="Medium",
                status=initial_status,
                reasons=prev_reasons,
                positive_evidence=[],
                negative_evidence=[],
            )

        # 2. Apply rule evaluations for each piece of evidence
        for rule in rules:
            key = rule["evidence_key"]
            if key not in evidence_map:
                continue

            observed = evidence_map[key]
            if observed is None or observed == "unknown":
                # Unknown evidence is neutral - does not alter scores
                continue

            evaluations = rule.get("evaluations", {}).get(observed, [])
            for adj in evaluations:
                target_slug = adj["cause"]
                if target_slug not in scored_causes:
                    continue

                cause = scored_causes[target_slug]
                delta = adj.get("delta", 0.0)
                reason = adj.get("reason", f"Adjusted by {delta:+.2f}")
                status_override = adj.get("status_override")

                # Apply score delta
                cause.score = max(0.05, min(0.95, cause.score + delta))

                if delta > 0:
                    cause.positive_evidence.append(key)
                elif delta < 0:
                    cause.negative_evidence.append(key)

                if reason not in cause.reasons:
                    cause.reasons.append(f"[{delta:+.2f}] {reason}")

                # Apply status override if definitively ruled out or confirmed
                if status_override == "ruled_out":
                    cause.status = "ruled_out"
                    cause.score = 0.05
                elif status_override == "confirmed" and cause.status != "ruled_out":
                    cause.status = "confirmed"
                    cause.score = 0.95

        # 3. Consider test fix outcomes: NEVER discard merely because one fix failed
        if tested_actions:
            for slug, outcome in tested_actions.items():
                if slug in scored_causes:
                    cause = scored_causes[slug]
                    if outcome == "working":
                        cause.status = "confirmed"
                        cause.score = 0.95
                        cause.reasons.append("[Fix verified] User confirmed recommended fix resolved the issue.")
                    elif outcome == "not_working":
                        # Reduce score slightly because this specific fix did not succeed,
                        # but keep plausible (do NOT discard or mark ruled_out!)
                        cause.score = max(0.15, cause.score - 0.20)
                        cause.reasons.append(
                            "[-0.20] First-line remediation did not fix problem; cause retains reduced plausibility while exploring alternatives."
                        )

        # 4. Finalize likelihood categories and rank causes
        results = list(scored_causes.values())
        for c in results:
            c.likelihood = score_to_likelihood(c.score, c.status)

        # Sort: confirmed first, then descending by score, ruled_out last
        def sort_key(c: ScoredCause):
            if c.status == "confirmed":
                return (2, c.score)
            if c.status == "ruled_out":
                return (-1, c.score)
            return (1, c.score)

        results.sort(key=sort_key, reverse=True)
        return results


cause_scorer = CauseScoringEngine()

