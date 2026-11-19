"""Unit tests verifying all 12 database models and relationships."""

import uuid
from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ActionOutcome,
    AnonymousSession,
    CandidateCause,
    DiagnosticCause,
    DiagnosticQuestion,
    DiagnosticRule,
    Evidence,
    Investigation,
    KnowledgeCategory,
    Message,
    RecommendedAction,
    Report,
)


@pytest.mark.asyncio
async def test_all_12_models_creation_and_relationships(db_session: AsyncSession):
    # 1. AnonymousSession
    session = AnonymousSession(
        session_token="clz_test_token_12345",
        user_identifier="Parth",
        daily_token_limit=200000,
        tokens_used=5000,
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db_session.add(session)
    await db_session.flush()

    assert session.remaining_tokens == 195000
    assert session.remaining_percentage == 97.5

    # 2. KnowledgeCategory
    category = KnowledgeCategory(
        name="Network",
        slug="network",
        description="Network and connectivity issues",
    )
    db_session.add(category)
    await db_session.flush()

    # 3. DiagnosticCause
    diag_cause = DiagnosticCause(
        category_id=category.id,
        title="DNS Resolution Failure",
        slug="dns-resolution-failure",
        description="Domain name server unable to translate domain to IP address.",
        typical_symptoms=["Websites timeout", "IP address loads but domain fails"],
        severity="High",
    )
    db_session.add(diag_cause)
    await db_session.flush()

    # 4. DiagnosticQuestion
    question = DiagnosticQuestion(
        cause_id=diag_cause.id,
        category_id=category.id,
        question_text="Does https://1.1.1.1 open in your browser?",
        purpose="Verify TCP IP connectivity bypassing DNS",
        expected_type="choice",
        options=["It opens", "It doesn't open", "I'm not sure"],
    )
    db_session.add(question)
    await db_session.flush()

    # 5. DiagnosticRule
    rule = DiagnosticRule(
        name="DNS IP check match",
        condition={"ip_reachable": True, "dns_resolves": False},
        action={"confirm_cause": "dns-resolution-failure"},
        priority=10,
    )
    db_session.add(rule)
    await db_session.flush()

    # 6. Investigation
    investigation = Investigation(
        reference_id="INV-2387",
        session_id=session.id,
        title="Laptop can't open websites (DNS issue)",
        problem_description="Connected to Wi-Fi but websites aren't opening.",
        status="active",
        category="Network",
    )
    db_session.add(investigation)
    await db_session.flush()

    # 7. Message
    msg = Message(
        investigation_id=investigation.id,
        sender="assistant",
        content="Let's check your DNS settings.",
        suggested_responses=["Ready", "Need help"],
    )
    db_session.add(msg)

    # 8. Evidence
    evidence = Evidence(
        investigation_id=investigation.id,
        category="network",
        key="DNS Resolver",
        value="Unresponsive",
        confidence=0.95,
        source="diagnostic_check",
    )
    db_session.add(evidence)

    # 9. CandidateCause
    cand_cause = CandidateCause(
        investigation_id=investigation.id,
        diagnostic_cause_id=diag_cause.id,
        title="DNS configuration issue",
        likelihood="High",
        status="suspected",
    )
    db_session.add(cand_cause)
    await db_session.flush()

    # 10. RecommendedAction
    action = RecommendedAction(
        investigation_id=investigation.id,
        cause_id=diag_cause.id,
        title="Change DNS to a reliable one",
        step_number=2,
        total_steps=3,
        steps=["Open Settings", "Set DNS to 8.8.8.8"],
        status="testing",
    )
    db_session.add(action)
    await db_session.flush()

    # 11. ActionOutcome
    outcome = ActionOutcome(
        recommended_action_id=action.id,
        investigation_id=investigation.id,
        outcome="working",
        user_feedback="Websites load immediately now!",
    )
    db_session.add(outcome)

    # 12. Report
    report = Report(
        investigation_id=investigation.id,
        title="Resolution Report: DNS Issue",
        summary="DNS resolver on client machine was misconfigured.",
        root_cause="Faulty DNS server provided by router DHCP.",
        fix_applied="Changed primary DNS to Google Public DNS 8.8.8.8.",
        resolution_steps=["Updated Wi-Fi adapter IPv4 DNS to 8.8.8.8 and 8.8.4.4."],
        preventative_measures=["Ensure DHCP lease assigns valid secondary DNS."],
    )
    db_session.add(report)
    await db_session.commit()

    # Verify querying and relationships
    stmt = select(Investigation).where(Investigation.reference_id == "INV-2387")
    res = await db_session.execute(stmt)
    loaded_inv = res.scalar_one()

    assert loaded_inv.title == "Laptop can't open websites (DNS issue)"
    assert loaded_inv.session_id == session.id
    assert loaded_inv.status == "active"

