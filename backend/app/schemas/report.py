"""Report schemas."""

import uuid
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict


class ReportResponse(BaseModel):
    """Schema representing an investigation resolution report."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    investigation_id: uuid.UUID
    title: str
    summary: str
    root_cause: str
    fix_applied: str
    resolution_steps: Optional[List[str]] = None
    preventative_measures: Optional[List[str]] = None
    generated_at: datetime

