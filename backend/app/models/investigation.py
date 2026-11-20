"""Investigation database model."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional
from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.session import AnonymousSession
    from app.models.message import Message
    from app.models.evidence import Evidence
    from app.models.candidate_cause import CandidateCause
    from app.models.action import RecommendedAction
    from app.models.report import Report


class Investigation(Base, UUIDMixin, TimestampMixin):
    """Represents a troubleshooting diagnostic session initiated by a user."""

    __tablename__ = "investigations"

    reference_id: Mapped[str] = mapped_column(
        String(20),
        unique=True,
        index=True,
        nullable=False,
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        String(64),
        index=True,
        nullable=True,
    )
    session_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("anonymous_sessions.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    problem_description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    device_type: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    os_info: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    network_info: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(30),
        default="active",
        index=True,
        nullable=False,
    )  # active, in_progress, testing_solution, resolved, abandoned
    category: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )  # Network, OS, Software, Programming
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    session: Mapped[Optional["AnonymousSession"]] = relationship(
        "AnonymousSession",
        back_populates="investigations",
    )
    messages: Mapped[List["Message"]] = relationship(
        "Message",
        back_populates="investigation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )
    evidence: Mapped[List["Evidence"]] = relationship(
        "Evidence",
        back_populates="investigation",
        cascade="all, delete-orphan",
    )
    candidate_causes: Mapped[List["CandidateCause"]] = relationship(
        "CandidateCause",
        back_populates="investigation",
        cascade="all, delete-orphan",
    )
    recommended_actions: Mapped[List["RecommendedAction"]] = relationship(
        "RecommendedAction",
        back_populates="investigation",
        cascade="all, delete-orphan",
    )
    report: Mapped[Optional["Report"]] = relationship(
        "Report",
        back_populates="investigation",
        uselist=False,
        cascade="all, delete-orphan",
    )

