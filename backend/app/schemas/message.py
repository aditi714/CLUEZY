"""Message schemas for investigation conversations."""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class MessageCreateRequest(BaseModel):
    """Payload to submit a user message within an investigation."""
    content: str = Field(..., min_length=1, max_length=10000, description="Text content of the message")
    selected_option: Optional[str] = Field(default=None, description="Pre-selected quick reply option if clicked")


class MessageResponse(BaseModel):
    """Schema representing a chat message."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    investigation_id: uuid.UUID
    sender: str
    content: str
    suggested_responses: Optional[List[str]] = None
    extra_data: Optional[Dict[str, Any]] = None
    created_at: datetime

