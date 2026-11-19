"""Diagnostic causes, questions, and rules schemas."""

import uuid
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict


class DiagnosticCauseItem(BaseModel):
    """Schema representing a diagnostic catalog cause."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category_id: uuid.UUID
    title: str
    slug: str
    description: str
    typical_symptoms: Optional[List[str]] = None
    severity: str


class DiagnosticQuestionItem(BaseModel):
    """Schema representing an interactive diagnostic troubleshooting question."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    cause_id: Optional[uuid.UUID] = None
    category_id: Optional[uuid.UUID] = None
    question_text: str
    purpose: Optional[str] = None
    expected_type: str
    options: Optional[List[Any]] = None
    display_order: int


class DiagnosticRuleItem(BaseModel):
    """Schema representing an inference rule."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    condition: Dict[str, Any]
    action: Dict[str, Any]
    priority: int
    is_active: bool

