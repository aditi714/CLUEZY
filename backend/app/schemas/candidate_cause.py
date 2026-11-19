"""Candidate cause schemas."""

import uuid
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class CandidateCauseItem(BaseModel):
    """Schema representing a potential diagnostic root cause."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    diagnostic_cause_id: Optional[uuid.UUID] = None
    title: str
    likelihood: str
    status: str
    confidence_score: Optional[float] = None
    notes: Optional[str] = None

