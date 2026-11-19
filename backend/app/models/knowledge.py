"""Knowledge category database model."""

from datetime import datetime
from typing import TYPE_CHECKING, List, Optional
from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import UUIDMixin, utcnow

if TYPE_CHECKING:
    from app.models.diagnostic import DiagnosticCause, DiagnosticQuestion


class KnowledgeCategory(Base, UUIDMixin):
    """Represents a domain taxonomy category for troubleshooting (e.g. Network, OS, Software, Programming)."""

    __tablename__ = "knowledge_categories"

    name: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
    )
    slug: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        index=True,
        nullable=False,
    )
    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    icon: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
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
    diagnostic_causes: Mapped[List["DiagnosticCause"]] = relationship(
        "DiagnosticCause",
        back_populates="category",
        cascade="all, delete-orphan",
    )
    diagnostic_questions: Mapped[List["DiagnosticQuestion"]] = relationship(
        "DiagnosticQuestion",
        back_populates="category",
    )

