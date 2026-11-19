"""Anonymous session database model."""

from datetime import datetime
from typing import TYPE_CHECKING, List, Optional
from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.investigation import Investigation


class AnonymousSession(Base, UUIDMixin, TimestampMixin):
    """Represents a temporary, non-authenticated user session with rate-limiting & token usage quotas."""

    __tablename__ = "anonymous_sessions"

    session_token: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        index=True,
        nullable=False,
    )
    user_identifier: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        default="Anonymous Explorer",
    )
    daily_token_limit: Mapped[int] = mapped_column(
        Integer,
        default=200000,
        nullable=False,
    )
    tokens_used: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    ip_hash: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )
    user_agent: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    # Relationships
    investigations: Mapped[List["Investigation"]] = relationship(
        "Investigation",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="desc(Investigation.created_at)",
    )

    @property
    def remaining_tokens(self) -> int:
        return max(0, self.daily_token_limit - self.tokens_used)

    @property
    def remaining_percentage(self) -> float:
        if self.daily_token_limit <= 0:
            return 0.0
        return round((self.remaining_tokens / self.daily_token_limit) * 100, 1)

