"""Regression Test Suite for Scenario Compatibility and Conversational Troubleshooting.

Verifies:
1. "My Wi-Fi is connected but there is no internet" selects the deterministic Wi-Fi scenario.
2. "My laptop shuts down automatically" does NOT select the Wi-Fi scenario; assigns Hardware/Thermal causes and asks the shutdown diagnostic question.
3. "My Python application crashes when I run it" does NOT select the Wi-Fi scenario; assigns Software/Traceback causes and asks for the error message.
4. "My laptop is making a strange noise" assigns fan/hardware causes and asks for noise location/sound.
5. "It is not working" enters clarification mode instead of running specialized network checks.
6. Multi-turn conversational investigations update cause scores and progress to resolution.
"""

import pytest
from httpx import AsyncClient

from app.diagnostic.registry import TriageDisposition, scenario_registry


def test_scenario_registry_compatibility_logic():
    """Unit test for ScenarioRegistry compatibility filtering."""
    # Wi-Fi should match
    sc_wifi = scenario_registry.find_compatible_scenario(
        "My Wi-Fi is connected but there is no internet",
        category="Network",
    )
    assert sc_wifi is not None
    assert sc_wifi.id == "wifi_no_internet"

    # Laptop shutdown must NEVER match Wi-Fi
    sc_shutdown = scenario_registry.find_compatible_scenario(
        "My laptop shuts down automatically.",
        category="Hardware",
    )
    assert sc_shutdown is None

    # Python crash must NEVER match Wi-Fi
    sc_python = scenario_registry.find_compatible_scenario(
        "My Python application crashes when I run it",
        category="Software",
    )
    assert sc_python is None

    # Strange noise must NEVER match Wi-Fi
    sc_noise = scenario_registry.find_compatible_scenario(
        "My laptop is making a strange noise",
        category="Hardware",
    )
    assert sc_noise is None

    # Unclear check
    assert scenario_registry.is_unclear_problem("It is not working") is True
    assert scenario_registry.is_unclear_problem("broken") is True
    assert scenario_registry.is_unclear_problem("My laptop shuts down automatically") is False


@pytest.mark.asyncio
async def test_wifi_problem_selects_wifi_scenario(client: AsyncClient, auth_headers: dict):
    """Supported network problem activates deterministic Wi-Fi scenario with 1.1.1.1 checks."""
    res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "My Wi-Fi is connected but there is no internet."},
        headers=auth_headers,
    )
    assert res.status_code == 201
    data = res.json()["data"]

    # Verify Wi-Fi scenario evidence
    scenario_ev = next((e for e in data["evidence"] if e["key"].lower() == "scenario_id"), None)
    assert scenario_ev is not None
    assert scenario_ev["value"] == "wifi_no_internet"

    # Verify candidate causes are network-related
    cause_titles = [c["title"] for c in data["candidate_causes"]]
    assert any("DNS" in t for t in cause_titles)
    assert any("Gateway" in t or "DHCP" in t or "ISP" in t for t in cause_titles)

    # Verify opening check is 1.1.1.1 IP test
    last_msg = data["messages"][-1]
    assert "1.1.1.1" in last_msg["content"]
    assert any("check_ip" in str(last_msg.get("extra_data", {}).values()) or "1.1.1.1" in last_msg["content"] for _ in [1])


@pytest.mark.asyncio
async def test_laptop_shutdown_does_not_select_wifi_scenario(client: AsyncClient, auth_headers: dict):
    """Hardware shutdown problem must NEVER activate the Wi-Fi scenario or ask for 1.1.1.1 IP checks."""
    res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "My laptop shuts down automatically."},
        headers=auth_headers,
    )
    assert res.status_code == 201
    data = res.json()["data"]

    # 1. Verify scenario mode is conversational, NOT wifi_no_internet
    scenario_ev = next((e for e in data["evidence"] if e["key"].lower() == "scenario_id"), None)
    assert scenario_ev is not None
    assert scenario_ev["value"] != "wifi_no_internet"

    # 2. Verify candidate causes are Hardware / Thermal Overheating / Power, NOT DNS or Gateway
    cause_titles = [c["title"] for c in data["candidate_causes"]]
    assert not any("DNS" in t for t in cause_titles)
    assert not any("Gateway" in t for t in cause_titles)
    assert not any("DHCP" in t for t in cause_titles)
    assert any("Thermal" in t or "Overheat" in t or "Battery" in t or "Power" in t for t in cause_titles)

    # 3. Verify assistant message does NOT mention 1.1.1.1, ping, or Wi-Fi
    assistant_msgs = [m for m in data["messages"] if m["sender"] == "assistant"]
    assert len(assistant_msgs) > 0
    opening_text = assistant_msgs[-1]["content"]
    assert "1.1.1.1" not in opening_text
    assert "ping" not in opening_text.lower()
    assert "wi-fi" not in opening_text.lower()
    assert "wifi" not in opening_text.lower()

    # 4. Verify opening question focuses on shutdown behavior
    assert any(term in opening_text.lower() for term in ["suddenly", "shut down", "turn off", "blue screen", "restart"])

    # 5. Verify recommended action is relevant to ventilation/Event Viewer, NOT 1.1.1.1 IP ping
    actions = data["recommended_actions"]
    assert len(actions) > 0
    act = actions[0]
    assert "1.1.1.1" not in act["title"]
    assert any(term in act["title"].lower() for term in ["ventilation", "event viewer", "temperature", "fan", "power"])


@pytest.mark.asyncio
async def test_python_crash_selects_programming_conversational_mode(client: AsyncClient, auth_headers: dict):
    """Software/programming crash must NOT activate Wi-Fi scenario; should ask for error message/traceback."""
    res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "My Python application crashes when I run it."},
        headers=auth_headers,
    )
    assert res.status_code == 201
    data = res.json()["data"]

    # Verify candidate causes are Python/Software related
    cause_titles = [c["title"] for c in data["candidate_causes"]]
    assert not any("DNS" in t for t in cause_titles)
    assert any("Exception" in t or "Traceback" in t or "Dependency" in t or "Runtime" in t for t in cause_titles)

    # Verify assistant asks for traceback or error message
    last_msg = data["messages"][-1]
    assert "1.1.1.1" not in last_msg["content"]
    assert any(term in last_msg["content"].lower() for term in ["traceback", "error", "message", "console", "terminal"])


@pytest.mark.asyncio
async def test_strange_noise_selects_hardware_conversational_mode(client: AsyncClient, auth_headers: dict):
    """Strange noise problem must ask for sound characteristics and isolate fan/HDD."""
    res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "My laptop is making a strange noise."},
        headers=auth_headers,
    )
    assert res.status_code == 201
    data = res.json()["data"]

    # Verify candidate causes
    cause_titles = [c["title"] for c in data["candidate_causes"]]
    assert not any("DNS" in t for t in cause_titles)
    assert any("Fan" in t or "Drive" in t or "Coil" in t or "Bearing" in t for t in cause_titles)

    # Verify question asks about sound/location
    last_msg = data["messages"][-1]
    assert "1.1.1.1" not in last_msg["content"]
    assert any(term in last_msg["content"].lower() for term in ["noise", "sound", "fan", "clicking", "where"])


@pytest.mark.asyncio
async def test_unclear_problem_prompts_for_clarification(client: AsyncClient, auth_headers: dict):
    """Unclear problem ('It is not working') prompts for clarification without executing 1.1.1.1 check."""
    res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "It is not working"},
        headers=auth_headers,
    )
    assert res.status_code == 201
    data = res.json()["data"]

    # Verify assistant prompts for clarification
    last_msg = data["messages"][-1]
    assert "1.1.1.1" not in last_msg["content"]
    assert any(term in last_msg["content"].lower() for term in ["which device", "tell me", "clarify", "happens", "what specifically"])


@pytest.mark.asyncio
async def test_conversational_investigation_multi_turn_progression(client: AsyncClient, auth_headers: dict):
    """Conversational troubleshooting progresses turns, updates cause rankings, and confirms resolution."""
    # 1. Create laptop shutdown investigation
    create_res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "My laptop shuts down automatically."},
        headers=auth_headers,
    )
    assert create_res.status_code == 201
    inv = create_res.json()["data"]
    ref_id = inv["reference_id"]

    # 2. Answer with "Turns off suddenly without warning"
    turn1_res = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={"selected_option_value": "Turns off suddenly without warning"},
        headers=auth_headers,
    )
    assert turn1_res.status_code == 200
    turn1_data = turn1_res.json()["data"]

    # Verify Thermal Overheating confidence increased and is top-ranked
    sorted_causes = sorted(turn1_data["candidate_causes"], key=lambda c: c["confidence_score"], reverse=True)
    assert "Thermal" in sorted_causes[0]["title"] or "Overheat" in sorted_causes[0]["title"]
    assert sorted_causes[0]["likelihood"] == "High"

    # Verify follow-up question is asking about heat / fan noise
    last_msg = turn1_data["messages"][-1]
    assert "1.1.1.1" not in last_msg["content"]
    assert any(term in last_msg["content"].lower() for term in ["warm", "temperature", "fan", "heat", "demanding"])

    # 3. Report action outcome as "working"
    turn2_res = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={"action_outcome": "working"},
        headers=auth_headers,
    )
    assert turn2_res.status_code == 200
    turn2_data = turn2_res.json()["data"]
    # Check that investigation stays open awaiting explicit confirmation
    assert turn2_data["status"] != "resolved"

    # 4. Explicit user confirmation resolves the investigation and creates a report
    turn3_res = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={"confirm_resolution": True, "user_message": "Yes, cleaning the fan vents solved the shutdown issue."},
        headers=auth_headers,
    )
    assert turn3_res.status_code == 200
    turn3_data = turn3_res.json()["data"]
    assert turn3_data["status"] == "resolved"
    assert turn3_data["resolved_at"] is not None
    assert turn3_data["report"] is not None
    assert "Thermal" in turn3_data["report"]["root_cause"] or "Overheat" in turn3_data["report"]["root_cause"]

