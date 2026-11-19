"""Database configuration, engine creation, and session management using SQLAlchemy 2.x."""

import logging
import os
from typing import AsyncGenerator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Base declarative class for all SQLAlchemy models."""
    pass


# Engine arguments and dialect-specific parameters
engine_kwargs = {
    "echo": settings.DEBUG and settings.APP_ENV == "development",
    "pool_pre_ping": True,
    "pool_recycle": 300,
}

# Driver specific customizations (Supabase PostgreSQL / SQLite fallback)
if settings.DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    # PostgreSQL with asyncpg (Supabase PgBouncer Session/Transaction Pooler compatibility)
    # Statement cache must be disabled when connecting via Supabase pooler
    engine_kwargs["connect_args"] = {
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
    }
    if os.getenv("VERCEL"):
        # Serverless environments delegate pooling to Supabase PgBouncer
        engine_kwargs["poolclass"] = NullPool
    else:
        engine_kwargs["pool_size"] = settings.DB_POOL_SIZE
        engine_kwargs["max_overflow"] = settings.DB_MAX_OVERFLOW
        engine_kwargs["pool_timeout"] = settings.DB_POOL_TIMEOUT

engine = create_async_engine(settings.DATABASE_URL, **engine_kwargs)

async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency that provides an asynchronous database session per request."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def check_db_connectivity() -> bool:
    """Check database health by running a simple ping query."""
    try:
        async with async_session_factory() as session:
            result = await session.execute(text("SELECT 1"))
            return result.scalar() == 1
    except Exception as exc:
        logger.error(f"Database connectivity check failed: {exc}")
        return False


async def init_db() -> None:
    """Initialize database tables (used for test environments or lightweight dev)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
