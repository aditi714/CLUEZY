"""Deterministic diagnostic rule engine with explainable, verifiable rule evaluations."""

from typing import Any, Dict, List, Optional
from app.diagnostic.types import EvidenceEvaluation


class DiagnosticRuleEngine:
    """Evaluates collected evidence against defined deterministic rules, producing transparent reasoning."""

    def evaluate_evidence(
        self,
        evidence_map: Dict[str, Any],
        rules: List[Dict[str, Any]],
    ) -> List[EvidenceEvaluation]:
        """Evaluate evidence against rule set.
        
        Supports:
        - Positive evidence (confirms/boosts a cause)
        - Negative evidence (contradicts/reduces a cause)
        - Unknown evidence (neutral, does not penalize)
        """
        evaluations: List[EvidenceEvaluation] = []

        for rule in rules:
            key = rule["evidence_key"]
            if key not in evidence_map:
                continue

            observed = evidence_map[key]

            # 1. Unknown / inconclusive evidence handling
            if observed is None or observed == "unknown":
                evaluations.append(
                    EvidenceEvaluation(
                        evidence_key=key,
                        observed_value="unknown",
                        effect="neutral",
                        score_delta=0.0,
                        reason=f"Evidence for '{key}' is unknown/unconfirmed; candidate cause scores remain unchanged.",
                    )
                )
                continue

            # 2. Match observed value against rule evaluations
            eval_map = rule.get("evaluations", {})
            target_adjustments = eval_map.get(observed)
            if not target_adjustments:
                continue

            for adj in target_adjustments:
                delta = adj.get("delta", 0.0)
                effect = "positive" if delta > 0 else ("negative" if delta < 0 else "neutral")
                status_override = adj.get("status_override")

                evaluations.append(
                    EvidenceEvaluation(
                        evidence_key=key,
                        observed_value=observed,
                        effect=effect,
                        score_delta=delta,
                        reason=adj.get("reason", f"Adjusted score by {delta:+.2f} based on {key}={observed}."),
                    )
                )

        return evaluations


rule_engine = DiagnosticRuleEngine()

