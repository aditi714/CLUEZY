"""Investigation request and response schemas."""

import uuid
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.action import RecommendedActionItem
from app.schemas.candidate_cause import CandidateCauseItem
from app.schemas.evidence import EvidenceItem
from app.schemas.message import MessageResponse
from app.schemas.report import ReportResponse


class InvestigationCreateRequest(BaseModel):
    """Payload to start a new troubleshooting investigation."""
    problem_description: str = Field(
        ...,
        min_length=5,
        max_length=5000,
        description="User description of the technical issue",
        examples=["My laptop is connected to Wi-Fi but websites aren't opening."],
    )
    title: Optional[str] = Field(
        default=None,
        max_length=255,
        description="Optional title for the investigation",
    )
    device_type: Optional[str] = Field(
        default=None,
        max_length=100,
        description="Device type, e.g. Laptop (Windows), MacBook, Linux server",
    )
    os_info: Optional[str] = Field(
        default=None,
        max_length=100,
        description="Operating system information",
    )
    network_info: Optional[str] = Field(
        default=None,
        max_length=100,
        description="Network state, e.g. Connected to Wi-Fi",
    )
    category: Optional[str] = Field(
        default=None,
        max_length=100,
        description="Category: Network, OS, Software, Programming",
    )


class InvestigationListItem(BaseModel):
    """Summarized investigation for listing views."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference_id: str
    title: str
    problem_description: str
    status: str
    category: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime] = None
    message_count: int = 0


class InvestigationDetailResponse(BaseModel):
    """Full investigation details including chat history, evidence, candidate causes, and actions."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference_id: str
    session_id: uuid.UUID
    title: str
    problem_description: str
    device_type: Optional[str] = None
    os_info: Optional[str] = None
    network_info: Optional[str] = None
    status: str
    category: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime] = None

    messages: List[MessageResponse] = Field(default_factory=list)
    evidence: List[EvidenceItem] = Field(default_factory=list)
    candidate_causes: List[CandidateCauseItem] = Field(default_factory=list)
    recommended_actions: List[RecommendedActionItem] = Field(default_factory=list)
    report: Optional[ReportResponse] = None


class InvestigationProgressRequest(BaseModel):
    """Payload to answer a diagnostic question or report fix action results."""
    user_message: Optional[str] = Field(
        default=None,
        max_length=5000,
        description="Optional conversational user text reply",
        examples=["I ran the check and 1.1.1.1 opened immediately."],
    )
    question_id: Optional[str] = Field(
        default=None,
        max_length=100,
        description="ID of the diagnostic question being answered (e.g. 'check_ip_access')",
        examples=["check_ip_access"],
    )
    selected_option_value: Optional[str] = Field(
        default=None,
        max_length=255,
        description="Selected option value or label (e.g. 'ip_reachable', 'other_devices_ok')",
        examples=["ip_reachable"],
    )
    action_id: Optional[str] = Field(
        default=None,
        max_length=100,
        description="UUID of the recommended action if reporting a fix outcome",
    )
    action_outcome: Optional[str] = Field(
        default=None,
        max_length=50,
        description="Outcome of applying recommended action: 'working', 'not_working', 'need_help', 'partial'",
        examples=["working", "not_working"],
    )
    confirm_resolution: Optional[bool] = Field(
        default=None,
        description="Set to true when user explicitly confirms problem is fixed and ready to resolve",
    )


class InvestigationResolveRequest(BaseModel):
    """Payload to confirm final resolution and generate investigation report."""
    user_notes: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Optional final confirmation notes from the user",
    )

