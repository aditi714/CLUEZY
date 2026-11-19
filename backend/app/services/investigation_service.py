"""Investigation business logic service with deterministic diagnostic engine integration."""

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai.classifier import problem_classifier
from app.ai.conversational import conversational_troubleshooter
from app.ai.extractor import evidence_extractor
from app.core.errors import ResourceNotFoundException
from app.diagnostic.engine import diagnostic_engine
from app.diagnostic.registry import TriageDisposition, scenario_registry
from app.models.action import ActionOutcome, RecommendedAction
from app.models.candidate_cause import CandidateCause
from app.models.evidence import Evidence
from app.models.investigation import Investigation
from app.models.message import Message
from app.models.report import Report
from app.models.session import AnonymousSession
from app.schemas.investigation import (
    InvestigationCreateRequest,
    InvestigationProgressRequest,
)
from app.services.session_service import session_service


class InvestigationService:
    """Manages creation, state progression, and resolution of troubleshooting investigations."""

    async def _generate_reference_id(self, db: AsyncSession) -> str:
        """Generate a unique human-friendly reference ID, e.g. INV-2387."""
        for _ in range(10):
            num = random.randint(1000, 9999)
            candidate = f"INV-{num}"
            stmt = select(Investigation.id).where(Investigation.reference_id == candidate)
            exists = await db.scalar(stmt)
            if not exists:
                return candidate
        return f"INV-{uuid.uuid4().hex[:6].upper()}"

    def _build_evidence_map(self, evidence_list: List[Evidence]) -> Dict[str, Any]:
        """Convert stored evidence records into a typed evidence map for rule evaluation."""
        emap: Dict[str, Any] = {}
        for ev in evidence_list:
            key = ev.key.lower().replace(" ", "_")
            val = ev.value
            # Normalization
            if val == "True" or val is True:
                emap[key] = True
            elif val == "False" or val is False:
                emap[key] = False
            elif val == "unknown" or val == "None" or val is None:
                emap[key] = None
            else:
                emap[key] = val

            # Also store explicit key directly if different
            if ev.key != key:
                emap[ev.key] = val

            # Specific known alias mapping
            if "other_devices" in key or "phone" in key:
                if "work" in str(val).lower() or val is True or val == "True":
                    emap["other_devices_working"] = True
                elif "down" in str(val).lower() or val is False or val == "False":
                    emap["other_devices_working"] = False

            if "ip" in key and "169.254" in str(val):
                emap["has_valid_ip"] = False
            elif "ip" in key and ("192.168." in str(val) or "10." in str(val)):
                emap["has_valid_ip"] = True

        return emap

    async def _charge_session_tokens(self, db: AsyncSession, session_id: uuid.UUID, amount: int) -> None:
        """Charge tokens against the anonymous session and enforce daily quota within current transaction."""
        stmt = select(AnonymousSession).where(AnonymousSession.id == session_id)
        session = await db.scalar(stmt)
        if session:
            from app.core.errors import RateLimitExceededException
            if session.tokens_used + amount > session.daily_token_limit:
                raise RateLimitExceededException(
                    f"Daily limit of {session.daily_token_limit} tokens reached. Remaining: {session.remaining_tokens}."
                )
            session.tokens_used += amount

    async def create_investigation(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        request: InvestigationCreateRequest,
    ) -> Investigation:
        """Create a new investigation, initialize starter evidence and triage dialogue."""
        await self._charge_session_tokens(db, session_id, 600)
        ref_id = await self._generate_reference_id(db)

        # 1. AI Evidence Extractor and Problem Classifier
        extraction = await evidence_extractor.extract_evidence(request.problem_description)
        classification = await problem_classifier.classify_problem(
            request.problem_description,
            evidence=extraction.evidence,
        )

        title = request.title
        if not title:
            desc = extraction.problem_summary or request.problem_description.strip()
            title = desc if len(desc) <= 50 else desc[:47] + "..."

        device_val = request.device_type or next(
            (e.value for e in extraction.evidence if e.category == "device"), None
        )
        os_val = request.os_info or next(
            (e.value for e in extraction.evidence if e.category == "os" or e.key.lower() == "os"), None
        )
        network_val = request.network_info or next(
            (e.value for e in extraction.evidence if e.category == "network"), None
        )
        category_val = request.category or classification.category or "Network"

        investigation = Investigation(
            reference_id=ref_id,
            session_id=session_id,
            title=title,
            problem_description=request.problem_description,
            device_type=device_val,
            os_info=os_val,
            network_info=network_val,
            status="active",
            category=category_val,
        )
        db.add(investigation)
        await db.flush()

        # 2. Record user's initial problem description message
        turn_ts = datetime.now(timezone.utc)
        user_message = Message(
            investigation_id=investigation.id,
            sender="user",
            content=request.problem_description,
            suggested_responses=[],
            created_at=turn_ts,
        )
        db.add(user_message)

        # 3. Insert Evidence items
        seen_keys: Set[str] = set()

        if request.device_type:
            db.add(
                Evidence(
                    investigation_id=investigation.id,
                    category="device",
                    key="Device",
                    value=request.device_type,
                    confidence=1.0,
                    source="user_stated",
                )
            )
            seen_keys.add("device")

        if request.os_info:
            db.add(
                Evidence(
                    investigation_id=investigation.id,
                    category="os",
                    key="Operating System",
                    value=request.os_info,
                    confidence=1.0,
                    source="user_stated",
                )
            )
            seen_keys.add("operating system")
            seen_keys.add("os")

        if request.network_info:
            db.add(
                Evidence(
                    investigation_id=investigation.id,
                    category="network",
                    key="Network",
                    value=request.network_info,
                    confidence=1.0,
                    source="user_stated",
                )
            )
            seen_keys.add("network")

        db.add(
            Evidence(
                investigation_id=investigation.id,
                category="issue",
                key="Issue",
                value=title,
                confidence=1.0,
                source="user_stated",
            )
        )
        seen_keys.add("issue")

        # Initial evidence map for diagnostic scoring
        initial_evidence_map: Dict[str, Any] = {}
        for item in extraction.evidence:
            if item.key.lower() not in seen_keys:
                db.add(
                    Evidence(
                        investigation_id=investigation.id,
                        category=item.category,
                        key=item.key,
                        value=item.value,
                        confidence=item.confidence,
                        source=item.source,
                    )
                )
                seen_keys.add(item.key.lower())

            if "other device" in item.key.lower() or "phone" in item.key.lower():
                if "work" in item.value.lower():
                    initial_evidence_map["other_devices_working"] = True
                elif "no" in item.value.lower() or "down" in item.value.lower():
                    initial_evidence_map["other_devices_working"] = False

        # 4. Scenario Compatibility & Diagnostic Engine Initialization
        disposition = scenario_registry.triage_investigation(
            problem_description=request.problem_description,
            category=category_val,
            suggested_scenario=classification.scenario,
            confidence=classification.confidence,
        )

        scenario_meta = (
            scenario_registry.find_compatible_scenario(
                problem_description=request.problem_description,
                category=category_val,
                suggested_scenario=classification.scenario,
                confidence=classification.confidence,
            )
            if disposition == TriageDisposition.SUPPORTED_SCENARIO
            else None
        )

        active_scenario_id = scenario_meta.id if scenario_meta else "conversational"

        # Record scenario_id in evidence to drive subsequent turns
        db.add(
            Evidence(
                investigation_id=investigation.id,
                category="classification",
                key="scenario_id",
                value=active_scenario_id,
                confidence=classification.confidence,
                source="classifier",
            )
        )

        if active_scenario_id == "wifi_no_internet":
            # Deterministic scenario path (Wi-Fi connected but no internet)
            scored_causes, planned_step = diagnostic_engine.evaluate_and_progress(
                evidence_map=initial_evidence_map,
                answered_question_ids=set(),
            )

            for sc in scored_causes:
                notes_str = "\n".join(sc.reasons) if sc.reasons else None
                db.add(
                    CandidateCause(
                        investigation_id=investigation.id,
                        title=sc.title,
                        likelihood=sc.likelihood,
                        status=sc.status,
                        confidence_score=sc.score,
                        notes=notes_str,
                    )
                )

            question_text = (
                planned_step.question.question_text
                if planned_step.question
                else "First diagnostic check: can you try opening https://1.1.1.1 in your browser, or ping 1.1.1.1 from the terminal?"
            )
            suggested = (
                planned_step.suggested_responses
                if planned_step.suggested_responses
                else ["It opens", "It doesn't open", "I'm not sure"]
            )
            q_id = planned_step.question.id if planned_step.question else "check_ip_access"

            assistant_reply = Message(
                investigation_id=investigation.id,
                sender="assistant",
                content=(
                    f"Got it. I'm investigating: \"{title}\". Let's run a few quick checks to isolate the cause.\n\n"
                    f"{question_text}"
                ),
                suggested_responses=suggested,
                extra_data={"question_id": q_id, "step_type": "question", "scenario_id": active_scenario_id},
                created_at=turn_ts + timedelta(milliseconds=50),
            )
            db.add(assistant_reply)

            db.add(
                RecommendedAction(
                    investigation_id=investigation.id,
                    title="Check website access using IP (1.1.1.1)",
                    step_number=1,
                    total_steps=3,
                    steps=[
                        "Open your web browser (or open Command Prompt via Win + R > cmd).",
                        "Navigate directly to https://1.1.1.1 (or run 'ping 1.1.1.1' in Command Prompt).",
                        "Observe whether the Cloudflare page opens (or ping replies) or if it times out.",
                    ],
                    expected_result="Page loads via IP address if DNS is the sole issue; times out if gateway or WAN link is down.",
                    status="pending",
                )
            )
        else:
            # Conversational troubleshooting mode (e.g. laptop automatic shutdown, python crash, hardware noise, unclear)
            step_plan = await conversational_troubleshooter.plan_initial_step(
                problem_description=request.problem_description,
                category=category_val,
                is_unclear=(disposition == TriageDisposition.UNCLEAR_CLARIFICATION),
            )

            for c in step_plan.candidate_causes:
                db.add(
                    CandidateCause(
                        investigation_id=investigation.id,
                        title=c.title,
                        likelihood=c.likelihood,
                        status="investigating",
                        confidence_score=c.confidence_score,
                        notes=c.notes,
                    )
                )

            assistant_reply = Message(
                investigation_id=investigation.id,
                sender="assistant",
                content=(
                    f"Got it. I'm investigating: \"{title}\". Let's run a few quick checks to isolate the cause.\n\n"
                    f"{step_plan.question_text}"
                ),
                suggested_responses=step_plan.suggested_responses,
                extra_data={
                    "question_id": step_plan.question_id,
                    "step_type": "question",
                    "scenario_id": active_scenario_id,
                },
                created_at=turn_ts + timedelta(milliseconds=50),
            )
            db.add(assistant_reply)

            if step_plan.recommended_action_title:
                db.add(
                    RecommendedAction(
                        investigation_id=investigation.id,
                        title=step_plan.recommended_action_title,
                        step_number=1,
                        total_steps=len(step_plan.recommended_action_steps) or 1,
                        steps=step_plan.recommended_action_steps or [step_plan.recommended_action_title],
                        expected_result=step_plan.recommended_action_expected or "Isolates the root cause.",
                        status="pending",
                    )
                )

        await db.commit()
        return await self.get_investigation(db, session_id, str(investigation.id))

    async def progress_investigation(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        identifier: str,
        request: InvestigationProgressRequest,
    ) -> Investigation:
        """Advance investigation state by recording answers, test outcomes, updating cause scores, and selecting next step."""
        investigation = await self.get_investigation(db, session_id, identifier)

        if investigation.status == "resolved":
            return investigation

        # Infer active question_id from last assistant message if not explicitly provided
        active_question_id = request.question_id
        if not active_question_id and not request.action_outcome and not request.confirm_resolution:
            for m in reversed(investigation.messages):
                if m.sender == "assistant" and m.extra_data and m.extra_data.get("question_id"):
                    active_question_id = m.extra_data.get("question_id")
                    break

        # 1. Determine user's reply text
        user_text = request.user_message.strip() if request.user_message else None
        if not user_text and request.selected_option_value:
            user_text = request.selected_option_value
        elif not user_text and request.action_outcome:
            outcome_labels = {
                "working": "It's working now",
                "not_working": "Still not working",
                "need_help": "I need help with these steps",
                "partial": "Partially working",
            }
            user_text = outcome_labels.get(request.action_outcome, f"Action outcome: {request.action_outcome}")

        # Duplicate submission guard: if the latest user message within the last 3 seconds has identical content & parameters
        if user_text and investigation.messages:
            recent_user_msgs = [m for m in investigation.messages if m.sender == "user"]
            if recent_user_msgs:
                last_um = recent_user_msgs[-1]
                now_utc = datetime.now(timezone.utc)
                created = last_um.created_at
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                if (
                    last_um.content == user_text
                    and (now_utc - created).total_seconds() < 2.0
                    and last_um.extra_data
                    and last_um.extra_data.get("question_id") == active_question_id
                    and last_um.extra_data.get("selected_option_value") == request.selected_option_value
                    and last_um.extra_data.get("action_outcome") == request.action_outcome
                ):
                    return investigation

        await self._charge_session_tokens(db, session_id, 400)
        turn_ts = datetime.now(timezone.utc)
        assistant_ts = turn_ts + timedelta(milliseconds=50)

        if user_text:
            db.add(
                Message(
                    investigation_id=investigation.id,
                    sender="user",
                    content=user_text,
                    extra_data={
                        "question_id": active_question_id,
                        "selected_option_value": request.selected_option_value,
                        "action_outcome": request.action_outcome,
                    },
                    created_at=turn_ts,
                )
            )

        # 2. Process question answer or conversational reply and map to new Evidence
        existing_ev_by_key = {e.key.lower(): e for e in investigation.evidence}
        new_mapped_pair: Optional[Tuple[str, Any]] = None

        if request.selected_option_value or (user_text and not request.action_outcome and not request.confirm_resolution):
            ans_val = request.selected_option_value or user_text
            mapped = diagnostic_engine.map_option_to_evidence(active_question_id, ans_val)
            if mapped:
                ev_key, ev_val = mapped
                new_mapped_pair = (ev_key, ev_val)
                val_str = str(ev_val) if ev_val is not None else "unknown"
                if ev_key.lower() in existing_ev_by_key:
                    existing_ev_by_key[ev_key.lower()].value = val_str
                    existing_ev_by_key[ev_key.lower()].source = "test_verified"
                else:
                    new_ev = Evidence(
                        investigation_id=investigation.id,
                        category="diagnostic_check",
                        key=ev_key,
                        value=val_str,
                        confidence=1.0,
                        source="test_verified",
                    )
                    db.add(new_ev)
                    existing_ev_by_key[ev_key.lower()] = new_ev

            # If the user typed a custom message (> 8 chars and not just a button label), also extract additional facts
            if request.user_message and len(request.user_message.strip()) > 8 and not request.selected_option_value:
                extraction = await evidence_extractor.extract_evidence(request.user_message)
                for item in extraction.evidence:
                    k_low = item.key.lower()
                    if k_low not in existing_ev_by_key:
                        new_ev = Evidence(
                            investigation_id=investigation.id,
                            category=item.category,
                            key=item.key,
                            value=item.value,
                            confidence=item.confidence,
                            source=item.source,
                        )
                        db.add(new_ev)
                        existing_ev_by_key[k_low] = new_ev

        # 3. Process recommended action outcome & collect all tested actions
        tested_actions_map: Dict[str, str] = {}
        for prior_act in investigation.recommended_actions:
            slug = diagnostic_engine.match_action_title_to_cause_slug(prior_act.title)
            if slug and prior_act.status in ("succeeded", "failed"):
                tested_actions_map[slug] = "working" if prior_act.status == "succeeded" else "not_working"

        target_action: Optional[RecommendedAction] = None
        if request.action_outcome:
            if request.action_id:
                try:
                    act_uuid = uuid.UUID(request.action_id)
                    target_action = next((a for a in investigation.recommended_actions if a.id == act_uuid), None)
                except ValueError:
                    target_action = None

            if not target_action and investigation.recommended_actions:
                # Target the most recent pending action, or most recent action overall
                pending_actions = [a for a in investigation.recommended_actions if a.status == "pending"]
                target_action = pending_actions[-1] if pending_actions else investigation.recommended_actions[-1]

            if target_action:
                db.add(
                    ActionOutcome(
                        recommended_action_id=target_action.id,
                        investigation_id=investigation.id,
                        outcome=request.action_outcome,
                        user_feedback=request.user_message,
                    )
                )
                if request.action_outcome == "working":
                    target_action.status = "succeeded"
                    slug = diagnostic_engine.match_action_title_to_cause_slug(target_action.title)
                    if slug:
                        tested_actions_map[slug] = "working"
                elif request.action_outcome == "not_working":
                    target_action.status = "failed"
                    slug = diagnostic_engine.match_action_title_to_cause_slug(target_action.title)
                    if slug:
                        tested_actions_map[slug] = "not_working"

        # 3b. Handle "need_help" on a recommended action without failing it
        if request.action_outcome == "need_help":
            act_title = target_action.title if target_action else None
            guidance = diagnostic_engine.get_action_help_guidance(act_title)
            db.add(
                Message(
                    investigation_id=investigation.id,
                    sender="assistant",
                    content=guidance,
                    suggested_responses=["It's working now", "Still not working"],
                    extra_data={
                        "action_title": act_title,
                        "step_type": "action_help",
                    },
                    created_at=assistant_ts,
                )
            )
            await db.commit()
            return await self.get_investigation(db, session_id, str(investigation.id))

        # 4. Check for explicit resolution confirmation
        # Rule: Resolution is NEVER assumed without explicit user confirmation.
        is_confirming = (
            request.confirm_resolution is True
            or (request.selected_option_value and "resolved" in request.selected_option_value.lower())
            or (
                user_text
                and any(
                    phrase in user_text.lower()
                    for phrase in ["problem is resolved", "yes, resolved", "confirm resolution", "issue is resolved"]
                )
            )
        )

        if is_confirming:
            investigation.status = "resolved"
            investigation.resolved_at = datetime.now(timezone.utc)

            # Determine root cause from top candidate cause
            sorted_causes = sorted(
                investigation.candidate_causes,
                key=lambda c: (1 if c.status == "confirmed" else 0, c.confidence_score),
                reverse=True,
            )
            top_cause_title = sorted_causes[0].title if sorted_causes else "DNS Resolution Failure"

            # Determine actual fix applied from succeeded action or top cause catalog
            succeeded_act = next(
                (a for a in reversed(investigation.recommended_actions) if a.status == "succeeded"),
                investigation.recommended_actions[-1] if investigation.recommended_actions else None,
            )
            fix_applied_text = (
                succeeded_act.title
                if succeeded_act
                else "Updated network & DNS configuration settings."
            )
            fix_steps_list = (
                list(succeeded_act.steps)
                if (succeeded_act and succeeded_act.steps)
                else [
                    "Identified symptoms and isolated connectivity failure",
                    f"Targeted root cause: {top_cause_title}",
                    "Verified remediation and restored internet connectivity",
                ]
            )
            ev_summary_items = [
                f"{e.key}: {e.value}"
                for e in investigation.evidence
                if e.value not in ("None", "unknown")
            ]
            ev_summary_str = "; ".join(ev_summary_items[:6]) if ev_summary_items else investigation.problem_description

            if not investigation.report:
                db.add(
                    Report(
                        investigation_id=investigation.id,
                        title=f"Resolution Report: {investigation.title}",
                        summary=(
                            f"Technical problem '{investigation.title}' was diagnosed and verified resolved. "
                            f"Supporting evidence: {ev_summary_str}."
                        ),
                        root_cause=top_cause_title,
                        fix_applied=fix_applied_text,
                        resolution_steps=fix_steps_list,
                        preventative_measures=[
                            "Keep reliable secondary DNS servers (e.g. 8.8.8.8 / 1.1.1.1) configured as fallback.",
                            "Periodically verify router firmware updates and DHCP lease renewal stability.",
                            "Save this diagnostic runbook for rapid future recovery.",
                        ],
                    )
                )

            db.add(
                Message(
                    investigation_id=investigation.id,
                    sender="assistant",
                    content=(
                        f"Problem Resolved! Your issue (**{top_cause_title}**) has been fixed by applying: "
                        f"**{fix_applied_text}**. A complete post-mortem resolution report is now ready."
                    ),
                    suggested_responses=["View Full Report", "Save this Fix", "Start a new investigation"],
                    extra_data={"resolution_confirmed": True},
                    created_at=assistant_ts,
                )
            )
            await db.commit()
            return await self.get_investigation(db, session_id, str(investigation.id))

        # If user reports fix is working, but hasn't explicitly confirmed resolution yet:
        if request.action_outcome == "working":
            db.add(
                Message(
                    investigation_id=investigation.id,
                    sender="assistant",
                    content=(
                        "Great to hear that the fix worked! Can you please confirm if everything is working normally "
                        "so we can finalize the resolution report?"
                    ),
                    suggested_responses=["Yes, problem is resolved", "Still having issues"],
                    extra_data={"awaiting_resolution_confirmation": True},
                    created_at=assistant_ts,
                )
            )
            await db.commit()
            return await self.get_investigation(db, session_id, str(investigation.id))

        # 5. Check Scenario Mode: Conversational vs Deterministic Wi-Fi
        scenario_ev = next((e for e in investigation.evidence if e.key.lower() == "scenario_id"), None)
        active_scenario_id = scenario_ev.value if scenario_ev else "wifi_no_internet"

        if active_scenario_id != "wifi_no_internet":
            # Conversational troubleshooting progression (laptop shutdown, Python crash, hardware noise, unclear)
            current_causes_data = [
                {
                    "title": c.title,
                    "likelihood": c.likelihood,
                    "confidence_score": c.confidence_score,
                    "notes": c.notes,
                }
                for c in investigation.candidate_causes
            ]
            conv_result = await conversational_troubleshooter.progress_dialogue(
                problem_description=investigation.problem_description,
                category=investigation.category or "General",
                conversation_history=[
                    {"sender": m.sender, "content": m.content}
                    for m in investigation.messages
                ],
                current_causes=current_causes_data,
                user_reply=user_text or "",
                active_question_id=active_question_id,
                action_outcome=request.action_outcome,
            )

            # Update existing candidate causes in database
            existing_causes_map = {c.title.lower(): c for c in investigation.candidate_causes}
            for uc in conv_result.get("updated_causes", []):
                matched_c = existing_causes_map.get(uc["title"].lower())
                if matched_c:
                    matched_c.likelihood = uc["likelihood"]
                    matched_c.confidence_score = uc["confidence_score"]
                    matched_c.status = uc.get("status", "investigating")

            # Add assistant response message
            db.add(
                Message(
                    investigation_id=investigation.id,
                    sender="assistant",
                    content=conv_result["reply_text"],
                    suggested_responses=conv_result.get("suggested_responses", []),
                    extra_data={
                        "question_id": conv_result.get("next_question_id"),
                        "step_type": "question",
                        "scenario_id": active_scenario_id,
                    },
                    created_at=assistant_ts,
                )
            )

            # If conversational engine recommended a new action
            act_data = conv_result.get("recommended_action")
            if act_data:
                db.add(
                    RecommendedAction(
                        investigation_id=investigation.id,
                        title=act_data["title"],
                        step_number=len(investigation.recommended_actions) + 1,
                        total_steps=len(act_data.get("steps", [])) or 1,
                        steps=act_data.get("steps", [act_data["title"]]),
                        expected_result=act_data.get("expected", "Isolates the root cause."),
                        status="pending",
                    )
                )

            await db.commit()
            return await self.get_investigation(db, session_id, str(investigation.id))

        # 6. Evaluate Deterministic Diagnostic Rule Engine & Cause Scoring Engine (Wi-Fi Scenario)
        await db.flush()
        current_evidence = list(existing_ev_by_key.values())
        emap = self._build_evidence_map(current_evidence)
        if new_mapped_pair:
            emap[new_mapped_pair[0]] = new_mapped_pair[1]

        answered_qids: Set[str] = set()
        for m in investigation.messages:
            if m.extra_data and m.extra_data.get("question_id"):
                answered_qids.add(m.extra_data["question_id"])
        if active_question_id:
            answered_qids.add(active_question_id)

        scored_causes, planned_step = diagnostic_engine.evaluate_and_progress(
            evidence_map=emap,
            answered_question_ids=answered_qids,
            tested_actions=tested_actions_map,
            last_action_outcome=request.action_outcome,
        )

        # 6. Update CandidateCause records in database
        existing_causes_map = {c.title.lower(): c for c in investigation.candidate_causes}
        for sc in scored_causes:
            matched_c = existing_causes_map.get(sc.title.lower())
            if not matched_c:
                for key, c in existing_causes_map.items():
                    if sc.slug in key or key in sc.slug or sc.title.lower() in key:
                        matched_c = c
                        break

            notes_str = "\n".join(sc.reasons) if sc.reasons else None
            if matched_c:
                matched_c.likelihood = sc.likelihood
                matched_c.confidence_score = sc.score
                matched_c.status = sc.status
                matched_c.notes = notes_str
            else:
                db.add(
                    CandidateCause(
                        investigation_id=investigation.id,
                        title=sc.title,
                        likelihood=sc.likelihood,
                        status=sc.status,
                        confidence_score=sc.score,
                        notes=notes_str,
                    )
                )

        # 7. Plan Next Step
        if planned_step.step_type == "recommended_action":
            investigation.status = "testing_solution"
            step_num = len(investigation.recommended_actions) + 1
            action_steps = planned_step.action_steps or []
            lead_cause = next(
                (
                    c
                    for c in scored_causes
                    if c.status != "ruled_out" and tested_actions_map.get(c.slug) != "not_working"
                ),
                scored_causes[0],
            )
            cause_meta = diagnostic_engine.causes_catalog.get(lead_cause.slug, {})
            expected_res = cause_meta.get("fix_action", {}).get(
                "expected_result",
                "Restores network connectivity and website resolution.",
            )

            new_action = RecommendedAction(
                investigation_id=investigation.id,
                title=planned_step.action_title or f"Apply fix for {lead_cause.title}",
                step_number=step_num,
                total_steps=max(3, step_num),
                steps=action_steps,
                expected_result=expected_res,
                status="pending",
            )
            db.add(new_action)

            steps_formatted = "\n".join(f"{i+1}. {s}" for i, s in enumerate(action_steps))
            prefix = ""
            if request.action_outcome == "not_working":
                prefix = "Since the previous fix didn't resolve the issue, I've updated the cause rankings. "

            db.add(
                Message(
                    investigation_id=investigation.id,
                    sender="assistant",
                    content=(
                        f"{prefix}Based on our evidence, the leading root cause is **{lead_cause.title}** "
                        f"({lead_cause.likelihood} likelihood).\n\n"
                        f"**Recommended Fix — {new_action.title}:**\n{steps_formatted}\n\n"
                        f"**Expected Result:** {expected_res}\n\n"
                        "Please test these steps (or open the **Next step** solution walkthrough) and let me know the result."
                    ),
                    suggested_responses=["It's working now", "Still not working", "I need help"],
                    extra_data={
                        "action_title": planned_step.action_title,
                        "step_type": "recommended_action",
                    },
                    created_at=assistant_ts,
                )
            )

        elif planned_step.step_type == "question" and planned_step.question:
            investigation.status = "active"
            q = planned_step.question
            prefix = ""
            if request.action_outcome == "not_working":
                prefix = (
                    "Understood — since that fix didn't solve it, I have lowered its score and we will explore "
                    "alternative causes.\n\n"
                )

            # Also update the active pending RecommendedAction card in sidebar if no fix is currently pending
            pending_checks = [a for a in investigation.recommended_actions if a.status == "pending"]
            if not pending_checks:
                step_num = len(investigation.recommended_actions) + 1
                db.add(
                    RecommendedAction(
                        investigation_id=investigation.id,
                        title=q.purpose or f"Diagnostic check: {q.id}",
                        step_number=step_num,
                        total_steps=max(3, step_num),
                        steps=[q.question_text],
                        expected_result="Provides evidence to narrow down the remaining candidate causes.",
                        status="pending",
                    )
                )

            db.add(
                Message(
                    investigation_id=investigation.id,
                    sender="assistant",
                    content=f"{prefix}{q.question_text}",
                    suggested_responses=planned_step.suggested_responses,
                    extra_data={"question_id": q.id, "step_type": "question"},
                    created_at=assistant_ts,
                )
            )

        elif planned_step.step_type == "escalation":
            investigation.status = "active"
            db.add(
                Message(
                    investigation_id=investigation.id,
                    sender="assistant",
                    content=(
                        "We have tested all primary diagnostic checks and local remediation actions, but the connection "
                        "issue persists. This indicates a deeper hardware or upstream ISP provisioning fault. "
                        "I recommend contacting your network administrator or ISP technical support with the evidence collected."
                    ),
                    suggested_responses=["Restart Investigation", "Contact Support"],
                    extra_data={"step_type": "escalation"},
                    created_at=assistant_ts,
                )
            )

        await db.commit()
        return await self.get_investigation(db, session_id, str(investigation.id))

    async def resolve_investigation(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        identifier: str,
        user_notes: Optional[str] = None,
    ) -> Investigation:
        """Explicitly resolve an investigation and generate resolution autopsy report."""
        return await self.progress_investigation(
            db=db,
            session_id=session_id,
            identifier=identifier,
            request=InvestigationProgressRequest(
                confirm_resolution=True,
                user_message=user_notes or "Problem confirmed resolved by user.",
            ),
        )

    async def list_investigations(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[dict], int]:
        """List investigations belonging to the specified session."""
        filters = [Investigation.session_id == session_id]
        if status:
            filters.append(Investigation.status == status)

        count_stmt = select(func.count(Investigation.id)).where(*filters)
        total = await db.scalar(count_stmt) or 0

        offset = (page - 1) * page_size
        stmt = (
            select(
                Investigation,
                func.count(Message.id).label("message_count"),
            )
            .outerjoin(Message, Message.investigation_id == Investigation.id)
            .where(*filters)
            .group_by(Investigation.id)
            .order_by(Investigation.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        result = await db.execute(stmt)
        rows = result.all()

        items = []
        for inv, msg_count in rows:
            items.append(
                {
                    "id": inv.id,
                    "reference_id": inv.reference_id,
                    "title": inv.title,
                    "problem_description": inv.problem_description,
                    "status": inv.status,
                    "category": inv.category,
                    "created_at": inv.created_at,
                    "updated_at": inv.updated_at,
                    "resolved_at": inv.resolved_at,
                    "message_count": msg_count,
                }
            )

        return items, total

    async def get_investigation(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        identifier: str,
    ) -> Investigation:
        """Fetch full investigation details by UUID or reference ID."""
        is_uuid = False
        try:
            val_uuid = uuid.UUID(identifier)
            is_uuid = True
        except ValueError:
            is_uuid = False

        conditions = [Investigation.session_id == session_id]
        if is_uuid:
            conditions.append(Investigation.id == val_uuid)
        else:
            conditions.append(Investigation.reference_id == identifier.upper().lstrip("#"))

        stmt = (
            select(Investigation)
            .where(*conditions)
            .options(
                selectinload(Investigation.messages),
                selectinload(Investigation.evidence),
                selectinload(Investigation.candidate_causes),
                selectinload(Investigation.recommended_actions).selectinload(RecommendedAction.outcomes),
                selectinload(Investigation.report),
            )
            .execution_options(populate_existing=True)
        )
        result = await db.execute(stmt)
        investigation = result.scalar_one_or_none()

        if not investigation:
            raise ResourceNotFoundException("Investigation", identifier)

        return investigation


investigation_service = InvestigationService()
