"""Unit tests for the Deterministic Diagnostic Engine (Milestone 3).

Verifies rule evaluation, cause scoring, question planning, investigation progression,
and resolution confirmation without any paid Groq API calls.
"""

import pytest
from httpx import AsyncClient

from app.diagnostic.engine import diagnostic_engine
from app.diagnostic.planner import question_planner
from app.diagnostic.rules import rule_engine
from app.diagnostic.scenarios.wifi_no_internet import CAUSES, QUESTIONS, RULES
from app.diagnostic.scorer import cause_scorer
from app.diagnostic.types import InvestigationProgressRequest


# ==============================================================================
# 1. Diagnostic Rule Engine Tests (Positive, Negative, Unknown Evidence)
# ==============================================================================

def test_rule_engine_positive_and_negative_evidence():
    """Verify rule engine handles positive, negative, and rule-out evidence with identifiable reasons."""
    # Positive evidence for DNS failure: 1.1.1.1 is reachable
    positive_evals = rule_engine.evaluate_evidence(
        evidence_map={"ip_reachable": True},
        rules=RULES,
    )
    assert len(positive_evals) >= 3

    dns_eval = next(e for e in positive_evals if "dns" in e.reason.lower())
    assert dns_eval.effect == "positive"
    assert dns_eval.score_delta > 0
    assert "identifiable" not in dns_eval.reason  # Real reason text
    assert len(dns_eval.reason) > 10

    # Negative evidence for gateway/ISP: if IP is reachable, gateway and ISP outage are refuted
    neg_eval = next(e for e in positive_evals if "gateway" in e.reason.lower())
    assert neg_eval.effect == "negative"
    assert neg_eval.score_delta < 0

    # Negative evidence for DNS failure: IP is NOT reachable
    negative_evals = rule_engine.evaluate_evidence(
        evidence_map={"ip_reachable": False},
        rules=RULES,
    )
    dns_neg_eval = next(e for e in negative_evals if "dns" in e.reason.lower())
    assert dns_neg_eval.effect == "negative"
    assert dns_neg_eval.score_delta < 0


def test_rule_engine_unknown_evidence():
    """Verify unknown or unconfirmed evidence is treated neutrally with 0.0 score delta."""
    unknown_evals = rule_engine.evaluate_evidence(
        evidence_map={"ip_reachable": "unknown", "other_devices_working": None},
        rules=RULES,
    )
    assert len(unknown_evals) == 2
    for ev in unknown_evals:
        assert ev.effect == "neutral"
        assert ev.score_delta == 0.0
        assert "unchanged" in ev.reason.lower()


# ==============================================================================
# 2. Cause Scoring Engine Tests
# ==============================================================================

def test_cause_scoring_and_ranking_with_evidence():
    """Verify causes are scored deterministically, ranked, and preserve reasoning chains."""
    # Scenario: IP is reachable, phone works on same Wi-Fi
    evidence = {
        "ip_reachable": True,
        "other_devices_working": True,
    }
    scored = cause_scorer.compute_cause_scores(
        causes_catalog=CAUSES,
        evidence_map=evidence,
        rules=RULES,
    )

    # 1. DNS Resolution Failure must be rank #1 with High likelihood
    top_cause = scored[0]
    assert top_cause.slug == "dns_resolution_failure"
    assert top_cause.likelihood == "High"
    assert top_cause.score >= 0.70
    assert len(top_cause.reasons) >= 2
    for r in top_cause.reasons:
        assert r.startswith("[+") or r.startswith("[-")

    # 2. ISP Outage must be definitively ruled out because other devices are working
    isp_cause = next(c for c in scored if c.slug == "isp_outage")
    assert isp_cause.status == "ruled_out"
    assert isp_cause.likelihood == "Low"
    assert isp_cause.score == 0.05


def test_cause_scoring_never_discards_plausible_causes():
    """Verify that an unsuccessful fix outcome does not discard or rule out plausible causes."""
    # Initial DNS failure
    evidence = {"ip_reachable": True}
    scored_initial = cause_scorer.compute_cause_scores(CAUSES, evidence, RULES)
    initial_top = scored_initial[0]
    assert initial_top.slug == "dns_resolution_failure"

    # User applied first DNS fix but reports it did not work
    tested_actions = {"dns_resolution_failure": "not_working"}
    scored_after = cause_scorer.compute_cause_scores(
        causes_catalog=CAUSES,
        evidence_map=evidence,
        rules=RULES,
        tested_actions=tested_actions,
    )

    dns_after = next(c for c in scored_after if c.slug == "dns_resolution_failure")
    # Score reduced due to failed fix attempt
    assert dns_after.score < initial_top.score
    # But NOT discarded or ruled out
    assert dns_after.status != "ruled_out"
    assert dns_after.score >= 0.15
    assert any("First-line remediation did not fix" in r for r in dns_after.reasons)


# ==============================================================================
# 3. Diagnostic Question Planner Tests
# ==============================================================================

def test_question_planner_selection_and_no_repeats():
    """Verify Question Planner selects discriminating check, avoids already answered questions, and returns selection reasons."""
    scored_causes = cause_scorer.compute_cause_scores(CAUSES, {}, RULES)

    # 1. Initial selection: check_ip_access (distinguishes top causes)
    step1 = question_planner.plan_next_step(
        scored_causes=scored_causes,
        all_questions=QUESTIONS,
        answered_question_ids=set(),
        known_evidence_keys=set(),
        causes_catalog=CAUSES,
    )
    assert step1.step_type == "question"
    assert step1.question is not None
    assert step1.question.id == "check_ip_access"
    assert len(step1.reason) > 10

    # 2. After check_ip_access is answered, planner must NOT repeat it
    step2 = question_planner.plan_next_step(
        scored_causes=scored_causes,
        all_questions=QUESTIONS,
        answered_question_ids={"check_ip_access"},
        known_evidence_keys={"ip_reachable"},
        causes_catalog=CAUSES,
    )
    assert step2.step_type in ["question", "recommended_action"]
    if step2.step_type == "question":
        assert step2.question.id != "check_ip_access"

    # 3. If evidence key is already known even without question_id, it is skipped
    step3 = question_planner.plan_next_step(
        scored_causes=scored_causes,
        all_questions=QUESTIONS,
        answered_question_ids=set(),
        known_evidence_keys={"ip_reachable", "other_devices_working"},
        causes_catalog=CAUSES,
    )
    if step3.step_type == "question":
        assert step3.question.id not in ["check_ip_access", "check_other_devices"]


# ==============================================================================
# 4. Investigation Progression API Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_investigation_progression_api_workflow(client: AsyncClient, auth_headers: dict):
    """End-to-end API test: create investigation, submit answer, update candidate causes, and progress."""
    # 1. Create investigation
    create_res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "My laptop is connected to Wi-Fi but websites aren't opening."},
        headers=auth_headers,
    )
    assert create_res.status_code == 201
    inv = create_res.json()["data"]
    inv_id = inv["id"]

    # 2. Submit answer: 1.1.1.1 is reachable
    progress_payload = {
        "question_id": "check_ip_access",
        "selected_option_value": "ip_reachable",
        "user_message": "Yes, https://1.1.1.1 opens in my browser.",
    }
    progress_res = await client.post(
        f"/api/v1/investigations/{inv_id}/progress",
        json=progress_payload,
        headers=auth_headers,
    )
    assert progress_res.status_code == 200
    updated_inv = progress_res.json()["data"]

    # Verify Evidence was persisted
    ev_keys = [e["key"] for e in updated_inv["evidence"]]
    assert "ip_reachable" in ev_keys

    # Verify candidate causes updated: DNS Resolution Failure is rank 1
    top_cause = updated_inv["candidate_causes"][0]
    assert "DNS" in top_cause["title"]
    assert top_cause["likelihood"] == "High"
    assert top_cause["confidence_score"] >= 0.70

    # Verify next step was planned
    assert len(updated_inv["messages"]) >= 3


@pytest.mark.asyncio
async def test_continuous_investigation_after_failed_fix(client: AsyncClient, auth_headers: dict):
    """Verify that an unsuccessful fix keeps investigation open and explores next alternative."""
    create_res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "Laptop connected to Wi-Fi but no internet access."},
        headers=auth_headers,
    )
    inv = create_res.json()["data"]
    inv_id = inv["id"]
    action_id = inv["recommended_actions"][0]["id"]

    # Report that the action fix did not work
    failed_fix_payload = {
        "action_id": action_id,
        "action_outcome": "not_working",
        "user_message": "I tried checking but it still does not work.",
    }
    res = await client.post(
        f"/api/v1/investigations/{inv_id}/progress",
        json=failed_fix_payload,
        headers=auth_headers,
    )
    assert res.status_code == 200
    updated = res.json()["data"]

    # Investigation must remain OPEN / ACTIVE
    assert updated["status"] in ["active", "testing_solution"]
    assert updated["resolved_at"] is None

    # Assistant continues investigation
    last_msg = updated["messages"][-1]
    assert last_msg["sender"] == "assistant"
    assert len(last_msg["suggested_responses"]) > 0


@pytest.mark.asyncio
async def test_resolution_requires_explicit_user_confirmation(client: AsyncClient, auth_headers: dict):
    """Verify that resolution is NOT assumed without explicit user confirmation."""
    create_res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "Wi-Fi connected but websites will not load."},
        headers=auth_headers,
    )
    inv = create_res.json()["data"]
    inv_id = inv["id"]
    action_id = inv["recommended_actions"][0]["id"]

    # 1. User reports fix is working, but WITHOUT confirm_resolution: True
    working_payload = {
        "action_id": action_id,
        "action_outcome": "working",
        "user_message": "Websites are opening now!",
    }
    res = await client.post(
        f"/api/v1/investigations/{inv_id}/progress",
        json=working_payload,
        headers=auth_headers,
    )
    assert res.status_code == 200
    state1 = res.json()["data"]

    # Investigation must NOT be marked resolved yet!
    assert state1["status"] != "resolved"
    assert state1["resolved_at"] is None
    # Assistant asks for confirmation
    assert "confirm" in state1["messages"][-1]["content"].lower()

    # 2. User explicitly confirms resolution
    confirm_payload = {
        "confirm_resolution": True,
        "user_message": "Yes, problem is resolved.",
    }
    res2 = await client.post(
        f"/api/v1/investigations/{inv_id}/progress",
        json=confirm_payload,
        headers=auth_headers,
    )
    assert res2.status_code == 200
    state2 = res2.json()["data"]

    # NOW investigation is marked resolved
    assert state2["status"] == "resolved"
    assert state2["resolved_at"] is not None
    assert state2["report"] is not None
    assert "Resolution Report" in state2["report"]["title"]

