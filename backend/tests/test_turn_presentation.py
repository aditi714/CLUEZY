"""Tests for TurnPresentation schema validation, scenario presentation builder, and invalid LLM output fallback."""

import json
from unittest.mock import AsyncMock
import pytest
from httpx import AsyncClient
from pydantic import ValidationError

from app.ai.conversational import ConversationalTroubleshooter, _parse_or_fallback_presentation
from app.diagnostic.engine import diagnostic_engine
from app.schemas.message import (
    TurnCheckItem,
    TurnPresentation,
    TurnQuestion,
    build_fallback_turn_presentation,
)


def test_turn_presentation_schema_validation():
    """Verify TurnPresentation enforces <=40 spoken words, no markdown/URLs, no '...' in summary, and max 3 checks."""
    valid = TurnPresentation(
        spoken="Our top hypothesis is DNS resolution failure. Does opening one dot one dot one dot one work?",
        summary="Testing whether direct IP routing works when bypassing domain name resolution.",
        checks=[
            TurnCheckItem(
                title="Ping Cloudflare IP",
                detail="Run ping 1.1.1.1 in Command Prompt to test direct IP connectivity.",
                command="ping 1.1.1.1",
            )
        ],
        question=TurnQuestion(
            text="Does the page open or reply to ping?",
            options=["It opens", "It doesn't open", "I'm not sure"],
        ),
    )
    assert len(valid.spoken.split()) <= 40
    assert "..." not in valid.summary
    assert len(valid.checks) == 1

    # 1. Reject spoken > 40 words
    with pytest.raises(ValidationError):
        TurnPresentation(
            spoken=" ".join(["word"] * 45),
            summary="Clean summary line.",
            checks=[],
            question=TurnQuestion(text="Is it working?", options=["Yes", "No"]),
        )

    # 2. Reject spoken containing URLs or markdown
    with pytest.raises(ValidationError):
        TurnPresentation(
            spoken="Please open https://1.1.1.1 in your browser now.",
            summary="Clean summary line.",
            checks=[],
            question=TurnQuestion(text="Does it open?", options=["Yes", "No"]),
        )

    with pytest.raises(ValidationError):
        TurnPresentation(
            spoken="Run **ipconfig** or `ping 1.1.1.1` in your console.",
            summary="Clean summary line.",
            checks=[],
            question=TurnQuestion(text="Does it open?", options=["Yes", "No"]),
        )

    # 3. Reject summary containing "..." truncation
    with pytest.raises(ValidationError):
        TurnPresentation(
            spoken="Let us check your system logs.",
            summary="Investigating laptop issue that shuts down...",
            checks=[],
            question=TurnQuestion(text="When does it happen?", options=["Gaming", "Idle"]),
        )

    # 4. Reject checks > 3 items
    with pytest.raises(ValidationError):
        TurnPresentation(
            spoken="Here are the diagnostic checks.",
            summary="Checking system state.",
            checks=[
                TurnCheckItem(title=f"Check {i}", detail=f"Detail {i}")
                for i in range(4)
            ],
            question=TurnQuestion(text="Which check failed?", options=["1", "2"]),
        )


def test_invalid_llm_output_fallback_presentation():
    """Verify invalid LLM JSON (e.g. >40 words spoken, markdown, or '...' in summary) falls back cleanly."""
    invalid_llm_payload = {
        "spoken": " ".join(["This is a very long spoken response with **markdown** and https://example.com"] * 5),
        "summary": "Truncated summary with ellipsis...",
        "checks": [{"title": f"Step {i}", "detail": f"Run step {i}"} for i in range(6)],
        "question": {"text": "What happens next?", "options": ["Option A", "Option B"]},
    }

    fallback_text = (
        "The symptoms point toward Thermal Overheating. "
        "How warm does the underside of the laptop feel before it turns off? "
        "Please check the exhaust vents as well."
    )
    fallback_opts = ["Very hot and fan spins loudly", "Cool / normal temperature"]

    pres = _parse_or_fallback_presentation(
        raw_data=invalid_llm_payload,
        fallback_text=fallback_text,
        fallback_options=fallback_opts,
        summary_hint="Leading cause is Thermal Overheating...",
        action_title="Check exhaust vents",
        action_steps=[
            "Feel the exhaust vents for heat.",
            "Run `ipconfig /all` in terminal.",
            "Check Event Viewer for Kernel-Power 41.",
            "Extra fourth step that must be trimmed to max 3.",
        ],
    )

    assert isinstance(pres, TurnPresentation)
    assert len(pres.spoken.split()) <= 40
    assert "..." not in pres.summary
    assert "…" not in pres.summary
    assert "https://" not in pres.spoken
    assert "**" not in pres.spoken
    assert len(pres.checks) == 3
    assert pres.checks[1].command == "ipconfig /all"
    # First question sentence extracted as question.text
    assert pres.question.text == "How warm does the underside of the laptop feel before it turns off?"
    assert pres.question.options == fallback_opts


def test_wifi_scenario_turn_presentation_builder():
    """Verify deterministic Wi-Fi scenario builds valid TurnPresentation for questions and recommended actions."""
    # 1. Question step presentation
    scored, step = diagnostic_engine.evaluate_and_progress(
        evidence_map={},
        answered_question_ids=set(),
    )
    pres = diagnostic_engine.build_scenario_turn_presentation(scored, step)
    assert isinstance(pres, TurnPresentation)
    assert len(pres.spoken.split()) <= 40
    assert "..." not in pres.summary
    assert len(pres.checks) <= 3
    assert any(c.command == "ping 1.1.1.1" for c in pres.checks)
    assert "?" in pres.question.text
    assert "It opens" in pres.question.options

    # 2. Recommended action presentation (when ip_reachable=True -> DNS fix)
    scored2, step2 = diagnostic_engine.evaluate_and_progress(
        evidence_map={"ip_reachable": True},
        answered_question_ids={"check_ip_access"},
    )
    assert step2.step_type == "recommended_action"
    pres2 = diagnostic_engine.build_scenario_turn_presentation(scored2, step2)
    assert isinstance(pres2, TurnPresentation)
    assert len(pres2.spoken.split()) <= 40
    assert "..." not in pres2.summary
    assert 1 <= len(pres2.checks) <= 3
    assert any(c.command for c in pres2.checks)
    assert "It's working now" in pres2.question.options


@pytest.mark.asyncio
async def test_api_returns_presentation_for_both_wifi_and_conversational_paths(
    client: AsyncClient, auth_headers: dict
):
    """Verify POST /api/v1/investigations and /progress return presentation in extra_data and top-level message."""
    # 1. Wi-Fi scenario path
    wifi_res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "My Windows laptop is connected to Wi-Fi but websites do not open."},
        headers=auth_headers,
    )
    assert wifi_res.status_code == 201
    wifi_data = wifi_res.json()["data"]
    wifi_msg = wifi_data["messages"][-1]

    assert "Got it. I'm investigating:" not in wifi_msg["content"]
    assert "..." not in wifi_data["title"]
    assert wifi_msg["presentation"] is not None
    assert wifi_msg["extra_data"]["presentation"] is not None
    assert len(wifi_msg["presentation"]["spoken"].split()) <= 40
    assert "..." not in wifi_msg["presentation"]["summary"]
    assert len(wifi_msg["presentation"]["checks"]) <= 3
    assert len(wifi_msg["presentation"]["question"]["options"]) >= 2

    # 2. Conversational path
    conv_res = await client.post(
        "/api/v1/investigations",
        json={
            "problem_description": (
                "My gaming laptop shuts down suddenly without warning whenever I play demanding 3D games "
                "for more than ten minutes and the bottom chassis feels very hot."
            )
        },
        headers=auth_headers,
    )
    assert conv_res.status_code == 201
    conv_data = conv_res.json()["data"]
    conv_msg = conv_data["messages"][-1]

    # Verify title and summary are never truncated with "..."
    assert "..." not in conv_data["title"]
    assert "Got it. I'm investigating:" not in conv_msg["content"]
    assert conv_msg["presentation"] is not None
    assert conv_msg["extra_data"]["presentation"] is not None
    assert len(conv_msg["presentation"]["spoken"].split()) <= 40
    assert "..." not in conv_msg["presentation"]["summary"]
    assert len(conv_msg["presentation"]["checks"]) <= 3
    assert "?" in conv_msg["presentation"]["question"]["text"]
