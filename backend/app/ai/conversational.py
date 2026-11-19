"""Conversational Troubleshooting Engine for Cluezy.

Handles recognized problems that do not have a dedicated deterministic scenario
(e.g., laptop automatic shutdowns, Python crashes, hardware noises) as well as
unclear problem statements requiring interactive clarification.

Integrates with Groq AI (openai/gpt-oss-120b) while providing robust domain
heuristics to guarantee rapid, deterministic, explainable questions and cause
rankings under all environment conditions.
"""

import json
import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.ai.client import groq_client

logger = logging.getLogger(__name__)


class ConversationalCauseItem(BaseModel):
    """Candidate cause generated for conversational troubleshooting."""
    title: str
    likelihood: str = Field(..., description="High, Medium, or Low")
    confidence_score: float = Field(default=0.5, ge=0.0, le=1.0)
    notes: Optional[str] = None


class ConversationalStepPlan(BaseModel):
    """Complete diagnostic step plan for conversational troubleshooting."""
    question_text: str
    suggested_responses: List[str] = Field(default_factory=list)
    candidate_causes: List[ConversationalCauseItem] = Field(default_factory=list)
    recommended_action_title: Optional[str] = None
    recommended_action_steps: List[str] = Field(default_factory=list)
    recommended_action_expected: Optional[str] = None
    category: str = "General"
    question_id: str = "conversational_q1"


class ConversationalTroubleshooter:
    """Orchestrates non-deterministic and unsupported troubleshooting investigations."""

    # Pre-defined, domain-expert fallback runbooks for common user inquiries
    DOMAIN_RUNBOOKS: Dict[str, Dict[str, Any]] = {
        "laptop_shutdown": {
            "category": "Hardware",
            "causes": [
                {
                    "title": "Thermal Overheating & Fan Obstruction",
                    "likelihood": "High",
                    "confidence_score": 0.85,
                    "notes": "Laptops abruptly shut down without error when CPU/GPU exceeds thermal junction limits (usually 95-105°C) to prevent silicon damage.",
                },
                {
                    "title": "Battery Degradation or Power Adapter Fault",
                    "likelihood": "Medium",
                    "confidence_score": 0.65,
                    "notes": "Failing battery cells experiencing sudden voltage drops under peak load trigger instant power-off.",
                },
                {
                    "title": "Operating System Kernel Crash / BSOD",
                    "likelihood": "Medium",
                    "confidence_score": 0.55,
                    "notes": "Kernel bugcheck or driver panic configured to restart/shut down immediately without displaying a memory dump.",
                },
                {
                    "title": "Motherboard / Voltage Regulator Defect",
                    "likelihood": "Low",
                    "confidence_score": 0.35,
                    "notes": "Failing capacitors or short circuits on motherboard power delivery rails.",
                },
            ],
            "question_id": "shutdown_behavior_type",
            "question_text": "Does your laptop suddenly turn off without warning, shut down normally after showing a message, display a blue screen, or restart automatically?",
            "suggested_responses": [
                "Turns off suddenly without warning",
                "Shuts down cleanly with message",
                "Blue screen (BSOD) crash",
                "Restarts automatically in a loop",
            ],
            "action_title": "Inspect laptop ventilation and check Event Viewer error logs",
            "action_steps": [
                "Feel the underside and exhaust vents of your laptop to check if it feels unusually hot or if fans are completely silent or whining.",
                "Ensure vents are elevated on a flat, hard surface (not on a bed, blanket, or lap).",
                "On Windows, press Win + X > Event Viewer > Windows Logs > System, and filter by Critical errors to check for Event ID 41 (Kernel-Power).",
            ],
            "action_expected": "Sudden cutoff during gaming/heavy load with hot base indicates overheating. Shutdown on battery alone indicates battery cell failure.",
        },
        "python_crash": {
            "category": "Software",
            "causes": [
                {
                    "title": "Unhandled Runtime Exception / Stack Traceback",
                    "likelihood": "High",
                    "confidence_score": 0.88,
                    "notes": "Python process terminated abruptly due to an unhandled exception (e.g. IndexError, KeyError, TypeError, or ZeroDivisionError).",
                },
                {
                    "title": "Missing Package Dependency or Virtualenv Mismatch",
                    "likelihood": "Medium",
                    "confidence_score": 0.70,
                    "notes": "Required third-party library is not installed in the currently active Python interpreter environment.",
                },
                {
                    "title": "Python Version Incompatibility or Segmentation Fault",
                    "likelihood": "Low",
                    "confidence_score": 0.40,
                    "notes": "C-extension crash, memory access violation, or syntax features unsupported by the installed Python version.",
                },
            ],
            "question_id": "python_error_traceback",
            "question_text": "What specific error message or traceback appears in your console or terminal when the application crashes?",
            "suggested_responses": [
                "ModuleNotFoundError / ImportError",
                "SyntaxError or IndentationError",
                "TypeError or AttributeError",
                "Exits silently without error message",
            ],
            "action_title": "Run script directly in terminal to capture stack trace",
            "action_steps": [
                "Open Command Prompt, PowerShell, or Terminal in your project directory.",
                "Activate your virtual environment if one is used (e.g., .\\venv\\Scripts\\activate).",
                "Run 'python <your_script>.py' and copy the full traceback output.",
            ],
            "action_expected": "Terminal captures exact file name, line number, and exception type causing the termination.",
        },
        "strange_noise": {
            "category": "Hardware",
            "causes": [
                {
                    "title": "Cooling Fan Bearing Wear or Debris Obstruction",
                    "likelihood": "High",
                    "confidence_score": 0.85,
                    "notes": "Dust buildup, dry bearing, or broken fan fin creates grinding, rattling, or high-pitched whining noises.",
                },
                {
                    "title": "Mechanical Hard Disk Drive (HDD) Head Failure",
                    "likelihood": "Medium",
                    "confidence_score": 0.60,
                    "notes": "Repetitive rhythmic clicking sound indicates HDD read/write head unable to find track zero ('click of death').",
                },
                {
                    "title": "High-Frequency Electronic Coil Whine",
                    "likelihood": "Low",
                    "confidence_score": 0.45,
                    "notes": "Inductors on graphics card or power delivery rails vibrating under electrical load.",
                },
            ],
            "question_id": "noise_characteristics",
            "question_text": "Where on the laptop does the noise come from, and what does it sound like (e.g. rattling fan, repetitive clicking, high-pitched electrical whine)?",
            "suggested_responses": [
                "Rattling / grinding near exhaust vents",
                "Repetitive rhythmic clicking sound",
                "High-pitched coil whine under load",
                "Loud buzzing or vibration",
            ],
            "action_title": "Isolate noise source and inspect fan exhaust",
            "action_steps": [
                "Listen closely to determine if the noise is located near the fan exhaust vents or the hard drive bay.",
                "Use compressed air (short bursts) into the vents while powered off to clear trapped debris.",
                "Back up critical personal files immediately if the noise is a repetitive clicking sound.",
            ],
            "action_expected": "Noise changing with CPU load points to fan or coil whine; constant mechanical clicking points to HDD failure.",
        },
        "unclear": {
            "category": "General",
            "causes": [
                {
                    "title": "Pending Initial Symptom Details",
                    "likelihood": "Low",
                    "confidence_score": 0.20,
                    "notes": "Awaiting specific details regarding which device, application, or service is failing.",
                }
            ],
            "question_id": "clarify_problem_scope",
            "question_text": "To help pinpoint the issue, could you tell me which device or application is having trouble, and what specifically happens when it fails?",
            "suggested_responses": [
                "Laptop / PC hardware issue",
                "Wi-Fi or network connection issue",
                "Software application crash",
                "Other technical issue",
            ],
            "action_title": "Provide symptom details in chat",
            "action_steps": [
                "Identify the affected device (e.g., Windows 11 laptop, iPhone, home router).",
                "Describe what happens (e.g., error messages, lights flashing, freezing).",
                "Note when the issue started and what you were doing when it occurred.",
            ],
            "action_expected": "Cluezy tailors diagnostic checks and candidate causes to your exact symptoms.",
        },
    }

    def _match_domain_runbook(self, problem_description: str) -> Optional[str]:
        """Match problem description against pre-configured domain runbooks."""
        p_low = problem_description.lower()

        # Laptop shutdown / power off
        if any(term in p_low for term in ["shut down", "shutdown", "shuts down", "turns off", "turn off", "powers off", "power off"]):
            return "laptop_shutdown"

        # Python / programming crash
        if any(term in p_low for term in ["python", "pip", "traceback", "syntaxerror", "modulenotfound", "script crash"]):
            return "python_crash"

        # Strange noise
        if any(term in p_low for term in ["noise", "clicking", "rattling", "whining", "buzzing", "sound from laptop", "fan noise"]):
            return "strange_noise"

        return None

    async def plan_initial_step(
        self,
        problem_description: str,
        category: Optional[str] = None,
        is_unclear: bool = False,
    ) -> ConversationalStepPlan:
        """Create the initial diagnostic step plan for an unsupported or unclear problem."""
        # 1. Unclear clarification check
        if is_unclear:
            raw = self.DOMAIN_RUNBOOKS["unclear"]
            return ConversationalStepPlan(
                category="General",
                question_id=raw["question_id"],
                question_text=raw["question_text"],
                suggested_responses=raw["suggested_responses"],
                candidate_causes=[ConversationalCauseItem(**c) for c in raw["causes"]],
                recommended_action_title=raw["action_title"],
                recommended_action_steps=raw["action_steps"],
                recommended_action_expected=raw["action_expected"],
            )

        # 2. Check pre-configured domain runbooks for immediate precision
        matched_key = self._match_domain_runbook(problem_description)
        if matched_key and matched_key in self.DOMAIN_RUNBOOKS:
            raw = self.DOMAIN_RUNBOOKS[matched_key]
            return ConversationalStepPlan(
                category=raw["category"],
                question_id=raw["question_id"],
                question_text=raw["question_text"],
                suggested_responses=raw["suggested_responses"],
                candidate_causes=[ConversationalCauseItem(**c) for c in raw["causes"]],
                recommended_action_title=raw["action_title"],
                recommended_action_steps=raw["action_steps"],
                recommended_action_expected=raw["action_expected"],
            )

        # 3. Dynamic Groq AI planning with fallback
        if groq_client.is_configured:
            try:
                system_prompt = (
                    "You are a Senior Technical Systems Diagnostician for CLUEZY.\n"
                    "Analyze the user's technical problem and return a structured diagnostic plan in valid JSON.\n"
                    "Requirements:\n"
                    "1. Ask ONE clear, focused diagnostic question that helps distinguish between candidate causes.\n"
                    "2. Provide 2 to 4 concise quick reply choices.\n"
                    "3. List 3 to 4 plausible candidate causes with likelihood ('High', 'Medium', or 'Low') and confidence score (0.0 to 1.0).\n"
                    "4. Propose an initial non-destructive verification check action.\n"
                    "Do NOT propose Wi-Fi or network checks unless the problem is specifically network-related.\n"
                    "Output JSON schema:\n"
                    "{\n"
                    '  "category": "Hardware" | "Software" | "Operating System" | "General",\n'
                    '  "question_text": "string",\n'
                    '  "suggested_responses": ["opt1", "opt2", "opt3"],\n'
                    '  "candidate_causes": [\n'
                    '    {"title": "Cause Name", "likelihood": "High"|"Medium"|"Low", "confidence_score": 0.8, "notes": "Explanation"}\n'
                    "  ],\n"
                    '  "recommended_action_title": "string",\n'
                    '  "recommended_action_steps": ["step 1", "step 2"],\n'
                    '  "recommended_action_expected": "string"\n'
                    "}"
                )
                user_prompt = f"User problem: {problem_description}\nCategory: {category or 'General'}"
                raw_resp = await groq_client.generate_chat_completion(
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.2,
                )
                data = json.loads(raw_resp)
                causes = [
                    ConversationalCauseItem(
                        title=c.get("title", "Hardware/Software anomaly"),
                        likelihood=c.get("likelihood", "Medium"),
                        confidence_score=float(c.get("confidence_score", 0.5)),
                        notes=c.get("notes"),
                    )
                    for c in data.get("candidate_causes", [])
                ]
                return ConversationalStepPlan(
                    category=data.get("category", category or "General"),
                    question_id="dynamic_ai_q1",
                    question_text=data.get(
                        "question_text",
                        f"Could you describe what happens immediately before '{problem_description}' occurs?",
                    ),
                    suggested_responses=data.get("suggested_responses", ["It happens randomly", "Under heavy usage", "Immediately on startup"]),
                    candidate_causes=causes or [
                        ConversationalCauseItem(title="System configuration anomaly", likelihood="Medium", confidence_score=0.5)
                    ],
                    recommended_action_title=data.get("recommended_action_title", "Review system logs and error codes"),
                    recommended_action_steps=data.get("recommended_action_steps", ["Check application or operating system error messages"]),
                    recommended_action_expected=data.get("recommended_action_expected", "Identifies specific fault triggering the issue"),
                )
            except Exception as e:
                logger.warning(f"Groq dynamic troubleshooting plan failed: {e}. Using general fallback.")

        # 4. General heuristic fallback
        return ConversationalStepPlan(
            category=category or "General",
            question_id="general_symptom_q1",
            question_text=f"Let's troubleshoot: \"{problem_description}\". Does this issue happen consistently or intermittently?",
            suggested_responses=["Happens consistently every time", "Happens intermittently / randomly", "Just started today"],
            candidate_causes=[
                ConversationalCauseItem(
                    title="Software or Driver Configuration Conflict",
                    likelihood="High",
                    confidence_score=0.70,
                    notes="Recently updated software, conflicting background service, or corrupted setting.",
                ),
                ConversationalCauseItem(
                    title="System Resource or Hardware Constraint",
                    likelihood="Medium",
                    confidence_score=0.55,
                    notes="Memory exhaustion, thermal throttling, or peripheral hardware defect.",
                ),
            ],
            recommended_action_title="Perform a clean restart and check error messages",
            recommended_action_steps=[
                "Save all open work.",
                "Restart the device completely (not sleep or hibernate).",
                "Observe whether any error dialog or code appears upon rebooting.",
            ],
            recommended_action_expected="Determines if background transient state resolves the failure.",
        )

    async def progress_dialogue(
        self,
        problem_description: str,
        category: str,
        conversation_history: List[Dict[str, str]],
        current_causes: List[Dict[str, Any]],
        user_reply: str,
        active_question_id: Optional[str] = None,
        action_outcome: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Progress conversational troubleshooting dialogue to the next question, fix, or resolution."""
        reply_lower = (user_reply or "").lower()

        # Update cause scores based on user feedback
        updated_causes = []
        for c in current_causes:
            title = c.get("title", "")
            title_lower = title.lower()
            likelihood = c.get("likelihood", "Medium")
            score = float(c.get("confidence_score", 0.5))
            notes = c.get("notes", "")

            # Heuristic score adjustments based on answers
            if "turn off" in reply_lower or "without warning" in reply_lower:
                if "thermal" in title_lower or "overheat" in title_lower:
                    likelihood = "High"
                    score = min(0.95, score + 0.20)
                elif "blue screen" in title_lower or "bsod" in title_lower:
                    likelihood = "Low"
                    score = max(0.15, score - 0.25)
            elif "blue screen" in reply_lower or "bsod" in reply_lower:
                if "blue screen" in title_lower or "bsod" in title_lower or "kernel" in title_lower:
                    likelihood = "High"
                    score = min(0.95, score + 0.30)
                elif "thermal" in title_lower:
                    likelihood = "Medium"
                    score = max(0.30, score - 0.20)
            elif "cleanly" in reply_lower or "message" in reply_lower:
                if "battery" in title_lower or "power" in title_lower:
                    likelihood = "High"
                    score = min(0.90, score + 0.20)

            updated_causes.append({
                "title": title,
                "likelihood": likelihood,
                "confidence_score": round(score, 2),
                "notes": notes,
                "status": "confirmed" if score >= 0.80 else "investigating",
            })

        # Sort causes by confidence score descending
        updated_causes.sort(key=lambda x: x["confidence_score"], reverse=True)
        top_cause = updated_causes[0]["title"] if updated_causes else "Identified Issue"

        # Action outcome resolution handling
        if action_outcome == "working":
            return {
                "reply_text": (
                    f"Excellent! It looks like our check confirmed and resolved the issue with **{top_cause}**.\n\n"
                    "Would you like to complete this investigation and save the final report?"
                ),
                "suggested_responses": ["Yes, mark issue resolved", "Keep investigating other issues"],
                "updated_causes": updated_causes,
                "recommended_action": None,
                "next_question_id": "confirm_completion",
                "ready_for_resolution": True,
            }

        # Select next diagnostic question or fix recommendation
        next_question_text = (
            f"Based on your response, **{top_cause}** is the most likely cause. "
            f"Does the problem happen only when running demanding applications, or even when the device is idle?"
        )
        suggested = ["Only during demanding apps / games", "Even when idle on desktop", "Only when on battery power"]
        action = None

        if "shutdown" in active_question_id or "thermal" in top_cause.lower():
            next_question_text = (
                f"The symptoms strongly point toward **{top_cause}**. "
                "How warm does the underside of the laptop feel before it turns off, and can you hear the cooling fan spinning loudly?"
            )
            suggested = ["Very hot and fan spins loudly", "Warm but fan is completely quiet", "Cool / normal temperature"]
            action = {
                "title": "Clean dust vents and test CPU temperature with HWMonitor",
                "steps": [
                    "Download and run a lightweight hardware monitor tool such as HWMonitor or Core Temp.",
                    "Monitor CPU package temperatures under normal use (normal: 40-60°C, critical: >90°C).",
                    "If temperatures spike above 90°C immediately before shutdown, clean exhaust vents with compressed air.",
                ],
                "expected": "Normal temperatures verify heatsink and thermal paste are functioning correctly.",
            }

        return {
            "reply_text": next_question_text,
            "suggested_responses": suggested,
            "updated_causes": updated_causes,
            "recommended_action": action,
            "next_question_id": f"followup_{active_question_id}",
            "ready_for_resolution": False,
        }


# Global instance
conversational_troubleshooter = ConversationalTroubleshooter()
