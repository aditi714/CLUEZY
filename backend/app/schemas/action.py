"""Recommended action and outcome schemas."""

import uuid
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class RecommendedActionItem(BaseModel):
    """Schema representing an action or fix step."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    cause_id: Optional[uuid.UUID] = None
    title: str
    step_number: int
    total_steps: int
    steps: Optional[List[str]] = None
    expected_result: Optional[str] = None
    status: str
    created_at: datetime


class ActionOutcomeCreate(BaseModel):
    """Payload to report the outcome of a recommended action."""
    outcome: str = Field(..., description="Result: working, not_working, need_help, partial")
    user_feedback: Optional[str] = Field(default=None, description="Optional text notes from user")

