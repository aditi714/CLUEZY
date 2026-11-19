"""Recommended action and action outcome database models."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import UUIDMixin, utcnow

if TYPE_CHECKING:
    from app.models.investigation import Investigation
    from app.models.diagnostic import DiagnosticCause


class RecommendedAction(Base, UUIDMixin):
    """Specific remediation steps recommended to resolve or verify a candidate cause."""

    __tablename__ = "recommended_actions"

    investigation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("investigations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    cause_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("diagnostic_causes.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )  # e.g., "Change DNS to a reliable one"
    step_number: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )
    total_steps: Mapped[int] = mapped_column(
        Integer,
        default=3,
        nullable=False,
    )
    steps: Mapped[Optional[List[str]]] = mapped_column(
        JSON,
        nullable=True,
        default=list,
    )  # e.g., ["Open Network Settings", "Go to Wi-Fi properties", "Set DNS to 8.8.8.8"]
    expected_result: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(30),
        default="pending",
        nullable=False,
    )  # 'pending', 'testing', 'succeeded', 'failed', 'skipped'
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    investigation: Mapped["Investigation"] = relationship(
        "Investigation",
        back_populates="recommended_actions",
    )
    diagnostic_cause: Mapped[Optional["DiagnosticCause"]] = relationship(
        "DiagnosticCause",
        back_populates="recommended_actions",
    )
    outcomes: Mapped[List["ActionOutcome"]] = relationship(
        "ActionOutcome",
        back_populates="recommended_action",
        cascade="all, delete-orphan",
    )


class ActionOutcome(Base, UUIDMixin):
    """User-reported feedback or diagnostic verification on an applied recommended action."""

    __tablename__ = "action_outcomes"

    recommended_action_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recommended_actions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    investigation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("investigations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    outcome: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )  # 'working', 'not_working', 'need_help', 'partial'
    user_feedback: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    recommended_action: Mapped["RecommendedAction"] = relationship(
        "RecommendedAction",
        back_populates="outcomes",
    )
    investigation: Mapped["Investigation"] = relationship(
        "Investigation",
    )

