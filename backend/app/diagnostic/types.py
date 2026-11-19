"""Type definitions and data models for the deterministic diagnostic engine."""

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional
from pydantic import BaseModel, Field


@dataclass
class EvidenceEvaluation:
    """Result of evaluating a specific piece of evidence against a diagnostic rule."""
    evidence_key: str
    observed_value: Any
    effect: str  # 'positive', 'negative', 'neutral', 'unknown'
    score_delta: float
    reason: str


@dataclass
class ScoredCause:
    """Internal scored diagnostic cause with identifiable reasoning chain."""
    slug: str
    title: str
    score: float
    likelihood: str  # 'High', 'Medium', 'Low'
    status: str      # 'suspected', 'testing', 'confirmed', 'ruled_out'
    reasons: List[str] = field(default_factory=list)
    positive_evidence: List[str] = field(default_factory=list)
    negative_evidence: List[str] = field(default_factory=list)


@dataclass
class DiagnosticQuestionDef:
    """Definition of a diagnostic inquiry or verification action."""
    id: str
    question_text: str
    purpose: str
    discriminates_between: List[str]  # Cause slugs this question can isolate
    options: List[Dict[str, str]]     # [{"label": "...", "value": "...", "evidence_key": "...", "evidence_val": ...}]
    action_type: str = "question"     # 'question', 'action', 'physical_check'
    command: Optional[str] = None     # Optional terminal command suggestion e.g. "ping 1.1.1.1"


@dataclass
class PlannedStep:
    """Next diagnostic step determined by the question planner."""
    step_type: str  # 'question', 'recommended_action', 'resolution_ready', 'escalation'
    question: Optional[DiagnosticQuestionDef] = None
    action_title: Optional[str] = None
    action_steps: Optional[List[str]] = None
    reason: str = ""
    suggested_responses: List[str] = field(default_factory=list)


class InvestigationProgressRequest(BaseModel):
    """Payload to submit answer or diagnostic outcome and advance investigation state."""
    user_message: Optional[str] = Field(default=None, description="Freeform text explanation from user")
    question_id: Optional[str] = Field(default=None, description="ID of question being answered")
    selected_option_value: Optional[str] = Field(default=None, description="Selected quick reply value")
    action_id: Optional[str] = Field(default=None, description="UUID of action being reported")
    action_outcome: Optional[str] = Field(default=None, description="Outcome: 'working', 'not_working', 'need_help', 'partial'")
    confirm_resolution: Optional[bool] = Field(default=None, description="Explicit user confirmation that issue is fixed")

