"""Diagnostic causes, questions, and rules models for the diagnostic engine."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, List, Optional
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import UUIDMixin, utcnow

if TYPE_CHECKING:
    from app.models.knowledge import KnowledgeCategory
    from app.models.candidate_cause import CandidateCause
    from app.models.action import RecommendedAction


class DiagnosticCause(Base, UUIDMixin):
    """Catalog of known technical root causes categorized by domain."""

    __tablename__ = "diagnostic_causes"

    category_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("knowledge_categories.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    slug: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        index=True,
        nullable=False,
    )
    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    typical_symptoms: Mapped[Optional[List[str]]] = mapped_column(
        JSON,
        nullable=True,
        default=list,
    )
    severity: Mapped[str] = mapped_column(
        String(20),
        default="Medium",
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    category: Mapped["KnowledgeCategory"] = relationship(
        "KnowledgeCategory",
        back_populates="diagnostic_causes",
    )
    diagnostic_questions: Mapped[List["DiagnosticQuestion"]] = relationship(
        "DiagnosticQuestion",
        back_populates="diagnostic_cause",
        cascade="all, delete-orphan",
    )
    candidate_causes: Mapped[List["CandidateCause"]] = relationship(
        "CandidateCause",
        back_populates="diagnostic_cause",
    )
    recommended_actions: Mapped[List["RecommendedAction"]] = relationship(
        "RecommendedAction",
        back_populates="diagnostic_cause",
    )


class DiagnosticQuestion(Base, UUIDMixin):
    """Targeted troubleshooting questions designed to isolate specific technical causes."""

    __tablename__ = "diagnostic_questions"

    cause_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("diagnostic_causes.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    category_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("knowledge_categories.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    question_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    purpose: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    expected_type: Mapped[str] = mapped_column(
        String(30),
        default="choice",
        nullable=False,
    )  # 'choice', 'boolean', 'command_output', 'text'
    options: Mapped[Optional[List[Any]]] = mapped_column(
        JSON,
        nullable=True,
        default=list,
    )
    display_order: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    diagnostic_cause: Mapped[Optional["DiagnosticCause"]] = relationship(
        "DiagnosticCause",
        back_populates="diagnostic_questions",
    )
    category: Mapped[Optional["KnowledgeCategory"]] = relationship(
        "KnowledgeCategory",
        back_populates="diagnostic_questions",
    )


class DiagnosticRule(Base, UUIDMixin):
    """Deterministic inference rules mapping observed evidence to candidate cause probabilities."""

    __tablename__ = "diagnostic_rules"

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    condition: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
    )  # e.g., {"evidence": {"ip_ping_ok": True, "dns_lookup_ok": False}}
    action: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
    )  # e.g., {"boost_cause": "dns_failure", "likelihood": "High"}
    priority: Mapped[int] = mapped_column(
        Integer,
        default=10,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=func.now(),
        nullable=False,
    )

