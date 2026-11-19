"""Evidence schemas."""

import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class EvidenceItem(BaseModel):
    """Schema representing an evidence fact item."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category: str
    key: str
    value: str
    confidence: float
    source: str
    created_at: datetime

