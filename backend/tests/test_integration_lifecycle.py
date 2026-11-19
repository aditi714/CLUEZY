"""End-to-End Integration Lifecycle, Multi-Path Scenario, and Security Tests for CLUEZY."""

import pytest
from httpx import AsyncClient

from app.core.security import rate_limiter


@pytest.fixture(autouse=True)
def reset_rate_limiter_fixture():
    """Ensure rate limiter state is fresh for each test."""
    rate_limiter.reset()
    yield
    rate_limiter.reset()


@pytest.mark.asyncio
async def test_complete_end_to_end_investigation_lifecycle_with_failed_fix_and_alternative(
    client: AsyncClient,
):
    """
    Test the complete lifecycle:
    Anonymous session -> Create investigation -> Extract evidence -> Classify problem ->
    Initialize diagnostic causes -> Ask question -> Submit answer -> Update evidence ->
    Update candidate causes -> Recommend action -> Submit failed outcome ->
    Continue diagnosis -> Recommend alternative fix -> Submit successful outcome ->
    Explicitly confirm resolution -> Generate report -> Retrieve investigation history.
    """
    # 1. Create Anonymous Session
    sess_res = await client.post("/api/v1/sessions", json={"user_identifier": "E2E Tester"})
    assert sess_res.status_code == 200
    sess_data = sess_res.json()["data"]
    token = sess_data["session_token"]
    headers = {"X-Session-Token": token}
    assert sess_data["remaining_tokens"] == 200000

    # 2. Create Investigation
    create_res = await client.post(
        "/api/v1/investigations",
        json={
            "problem_description": "My Windows 11 laptop is connected to Wi-Fi but websites aren't opening in Chrome.",
        },
        headers=headers,
    )
    assert create_res.status_code == 201
    inv = create_res.json()["data"]
    ref_id = inv["reference_id"]
    assert ref_id.startswith("INV-")
    assert inv["status"] == "active"
    assert len(inv["evidence"]) >= 2
    assert len(inv["candidate_causes"]) == 4

    # Verify initial question is check_ip_access
    last_msg = inv["messages"][-1]
    assert last_msg["sender"] == "assistant"
    assert last_msg["extra_data"]["question_id"] == "check_ip_access"

    # 3. Submit answer to Question 1 ("It opens" -> ip_reachable = True)
    ans1_res = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={
            "question_id": "check_ip_access",
            "selected_option_value": "It opens",
        },
        headers=headers,
    )
    assert ans1_res.status_code == 200
    inv = ans1_res.json()["data"]

    # Evidence and Candidate Causes must update: DNS Resolution Failure is High and recommended action is planned
    ev_map = {e["key"]: e["value"] for e in inv["evidence"]}
    assert ev_map.get("ip_reachable") == "True"

    dns_cause = next(c for c in inv["candidate_causes"] if "DNS" in c["title"])
    assert dns_cause["likelihood"] == "High"
    assert inv["status"] == "testing_solution"

    # Find the DNS recommended action
    dns_action = inv["recommended_actions"][-1]
    assert "DNS" in dns_action["title"]
    assert dns_action["status"] == "pending"

    # 4. Ask for help on the recommended action ("need_help") -> must provide OS guidance without failing action
    help_res = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={
            "action_id": dns_action["id"],
            "action_outcome": "need_help",
        },
        headers=headers,
    )
    assert help_res.status_code == 200
    inv = help_res.json()["data"]
    assert "ncpa.cpl" in inv["messages"][-1]["content"] or "DNS" in inv["messages"][-1]["content"]

    # 5. Submit FAILED outcome for the DNS fix ("not_working") -> must continue diagnosis, NOT terminate
    fail_res = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={
            "action_id": dns_action["id"],
            "action_outcome": "not_working",
            "user_message": "Changed DNS to 8.8.8.8 but websites still fail to load.",
        },
        headers=headers,
    )
    assert fail_res.status_code == 200
    inv = fail_res.json()["data"]
    assert inv["status"] == "active"
    assert inv["report"] is None

    # DNS cause must still exist (never discarded), with lowered confidence score
    dns_cause_after = next(c for c in inv["candidate_causes"] if "DNS" in c["title"])
    assert dns_cause_after["confidence_score"] < dns_cause["confidence_score"]
    assert dns_cause_after["status"] != "ruled_out"

    # Assistant asks the next distinguishing question
    next_q_msg = inv["messages"][-1]
    next_qid = next_q_msg["extra_data"].get("question_id")
    assert next_qid is not None and next_qid != "check_ip_access"

    # 6. Answer next question (or report APIPA 169.254.x.x IP address to trigger DHCP failure cause)
    ip_ans_res = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={
            "question_id": "check_ip_address_validity",
            "selected_option_value": "Starts with 169.254 (APIPA / No valid IP)",
        },
        headers=headers,
    )
    assert ip_ans_res.status_code == 200
    inv = ip_ans_res.json()["data"]

    # Now Incorrect IP Configuration / DHCP Failure becomes confirmed / High and recommends DHCP renewal fix!
    ip_cause = next(c for c in inv["candidate_causes"] if "IP Configuration" in c["title"] or "DHCP" in c["title"])
    assert ip_cause["likelihood"] == "High"
    assert inv["status"] == "testing_solution"

    alt_action = inv["recommended_actions"][-1]
    assert alt_action["id"] != dns_action["id"]
    assert "DHCP" in alt_action["title"] or "ipconfig" in " ".join(alt_action["steps"]).lower()

    # 7. Submit SUCCESSFUL outcome for alternative fix ("working")
    # Rule: Must NOT auto-resolve yet; must ask for explicit user confirmation!
    work_res = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={
            "action_id": alt_action["id"],
            "action_outcome": "working",
        },
        headers=headers,
    )
    assert work_res.status_code == 200
    inv = work_res.json()["data"]
    assert inv["status"] != "resolved"
    assert inv["report"] is None
    assert inv["messages"][-1]["extra_data"].get("awaiting_resolution_confirmation") is True

    # 8. Explicitly confirm resolution -> generates final report
    resolve_res = await client.post(
        f"/api/v1/investigations/{ref_id}/resolve",
        json={"user_notes": "Confirmed! Renewing the DHCP lease assigned 192.168.1.45 and websites open now."},
        headers=headers,
    )
    assert resolve_res.status_code == 200
    resolved_inv = resolve_res.json()["data"]
    assert resolved_inv["status"] == "resolved"
    assert resolved_inv["resolved_at"] is not None
    assert resolved_inv["report"] is not None
    assert "IP Configuration" in resolved_inv["report"]["root_cause"] or "DHCP" in resolved_inv["report"]["root_cause"]
    assert "DHCP" in resolved_inv["report"]["fix_applied"]

    # 9. Simulate browser refresh & retrieve investigation history
    refresh_res = await client.get(f"/api/v1/investigations/{ref_id}", headers=headers)
    assert refresh_res.status_code == 200
    restored = refresh_res.json()["data"]
    assert restored["reference_id"] == ref_id
    assert restored["status"] == "resolved"
    assert len(restored["messages"]) == len(resolved_inv["messages"])

    history_res = await client.get("/api/v1/investigations", headers=headers)
    assert history_res.status_code == 200
    history_items = history_res.json()["data"]["items"]
    assert any(item["reference_id"] == ref_id and item["status"] == "resolved" for item in history_items)


@pytest.mark.asyncio
async def test_gateway_and_isp_outage_diagnostic_paths(client: AsyncClient):
    """Test non-DNS paths: IP unreachable -> All devices down -> Router WAN light red -> ISP Outage."""
    sess_res = await client.post("/api/v1/sessions")
    token = sess_res.json()["data"]["session_token"]
    headers = {"X-Session-Token": token}

    create_res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "Wi-Fi is connected on my PC but no internet access anywhere."},
        headers=headers,
    )
    ref_id = create_res.json()["data"]["reference_id"]

    # Step 1: 1.1.1.1 does NOT open (ip_reachable = False)
    r1 = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={"question_id": "check_ip_access", "selected_option_value": "It doesn't open"},
        headers=headers,
    )
    assert r1.status_code == 200

    # Step 2: Other devices also have no internet (other_devices_working = False)
    r2 = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={"question_id": "check_other_devices", "selected_option_value": "No, all devices have no internet"},
        headers=headers,
    )
    assert r2.status_code == 200

    # Step 3: Router WAN light is Red / Error (router_wan_down = True)
    r3 = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={"question_id": "check_router_lights", "selected_option_value": "Red / Orange / Blinking / Off (Error state)"},
        headers=headers,
    )
    assert r3.status_code == 200
    inv = r3.json()["data"]

    isp_cause = next(c for c in inv["candidate_causes"] if "ISP" in c["title"])
    assert isp_cause["status"] == "confirmed"
    assert isp_cause["likelihood"] == "High"


@pytest.mark.asyncio
async def test_security_ownership_isolation_and_rate_limiting(client: AsyncClient):
    """Verify session ownership isolation, input length validation, and sliding-window rate limiting."""
    s1 = (await client.post("/api/v1/sessions")).json()["data"]["session_token"]
    s2 = (await client.post("/api/v1/sessions")).json()["data"]["session_token"]

    inv_res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "Connected to Wi-Fi on laptop, websites fail to load."},
        headers={"X-Session-Token": s1},
    )
    ref_id = inv_res.json()["data"]["reference_id"]

    # Session 2 must NOT be able to view or progress Session 1's investigation
    unauth_get = await client.get(f"/api/v1/investigations/{ref_id}", headers={"X-Session-Token": s2})
    assert unauth_get.status_code == 404

    unauth_prog = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={"user_message": "Attempting unauthorized progress"},
        headers={"X-Session-Token": s2},
    )
    assert unauth_prog.status_code == 404

    # Input length validation: message > 5000 chars rejected with 422
    too_long_res = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={"user_message": "A" * 5500},
        headers={"X-Session-Token": s1},
    )
    assert too_long_res.status_code == 422

    # Rate limiter enforcement when limit is exceeded
    rate_limiter.max_requests = 3
    rate_limiter.reset()
    for _ in range(3):
        ok_res = await client.get("/api/v1/sessions/me", headers={"X-Session-Token": s1})
        assert ok_res.status_code == 200

    blocked_res = await client.get("/api/v1/sessions/me", headers={"X-Session-Token": s1})
    assert blocked_res.status_code == 429
    assert blocked_res.json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"
    rate_limiter.max_requests = 120

