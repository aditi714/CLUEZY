"""Anonymous session request and response schemas."""

import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class SessionCreateRequest(BaseModel):
    """Payload to create or initialize an anonymous session."""
    user_identifier: Optional[str] = Field(
        default="Anonymous Explorer",
        max_length=100,
        description="Display name or client identifier for the session",
    )


class SessionResponse(BaseModel):
    """Schema representing anonymous session details and token balance."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_token: str
    user_identifier: Optional[str]
    daily_token_limit: int
    tokens_used: int
    remaining_tokens: int
    remaining_percentage: float
    is_active: bool
    expires_at: datetime
    created_at: datetime

