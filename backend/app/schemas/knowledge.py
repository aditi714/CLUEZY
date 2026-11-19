"""Knowledge category schemas."""

import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class KnowledgeCategoryItem(BaseModel):
    """Schema representing a knowledge category."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    description: Optional[str] = None
    icon: Optional[str] = None
    display_order: int
    created_at: datetime

