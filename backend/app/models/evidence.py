"""Evidence database model for confirmed facts and technical observations."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import DateTime, Float, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import UUIDMixin, utcnow

if TYPE_CHECKING:
    from app.models.investigation import Investigation


class Evidence(Base, UUIDMixin):
    """Represents a piece of verified or stated evidence collected during investigation ('What we know')."""

    __tablename__ = "evidence"

    investigation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("investigations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    category: Mapped[str] = mapped_column(
        String(50),
        default="general",
        nullable=False,
    )  # device, issue, network, other_devices, symptom, observation
    key: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )  # e.g., "Device", "Network", "Other devices"
    value: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )  # e.g., "Laptop (Windows)", "Connected to Wi-Fi", "Working (phone)"
    confidence: Mapped[float] = mapped_column(
        Float,
        default=1.0,
        nullable=False,
    )
    source: Mapped[str] = mapped_column(
        String(50),
        default="user_stated",
        nullable=False,
    )  # user_stated, test_verified, diagnostic_inference
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    investigation: Mapped["Investigation"] = relationship(
        "Investigation",
        back_populates="evidence",
    )

