"""Candidate cause database model for potential root causes under evaluation."""

import uuid
from typing import TYPE_CHECKING, Optional
from sqlalchemy import Float, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.investigation import Investigation
    from app.models.diagnostic import DiagnosticCause


class CandidateCause(Base, UUIDMixin, TimestampMixin):
    """Represents a potential cause being tracked and evaluated for an investigation ('Possible causes')."""

    __tablename__ = "candidate_causes"

    investigation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("investigations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    diagnostic_cause_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("diagnostic_causes.id", ondelete="SET NULL"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )  # e.g., "DNS configuration issue", "Network settings issue"
    likelihood: Mapped[str] = mapped_column(
        String(20),
        default="Medium",
        nullable=False,
    )  # 'High', 'Medium', 'Low'
    status: Mapped[str] = mapped_column(
        String(30),
        default="suspected",
        nullable=False,
    )  # 'suspected', 'testing', 'confirmed', 'ruled_out'
    confidence_score: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
    )
    notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Relationships
    investigation: Mapped["Investigation"] = relationship(
        "Investigation",
        back_populates="candidate_causes",
    )
    diagnostic_cause: Mapped[Optional["DiagnosticCause"]] = relationship(
        "DiagnosticCause",
        back_populates="candidate_causes",
    )

