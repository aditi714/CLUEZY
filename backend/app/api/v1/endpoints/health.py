"""Health check API endpoints."""

import logging
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.config import settings
from app.schemas.common import APIResponse
from app.schemas.health import HealthStatus
from app.ai.client import groq_client

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get(
    "/health",
    response_model=APIResponse[HealthStatus],
    summary="Application Health Check",
    description="Check the operational health of the FastAPI application, database connectivity, and configured AI services.",
)
async def get_health(db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(text("SELECT 1"))
        db_ok = result.scalar() == 1
    except Exception as exc:
        logger.error(f"Database connectivity check failed: {exc}")
        db_ok = False
    status_str = "healthy" if db_ok else "degraded"

    services = {
        "database": "connected" if db_ok else "unreachable",
        "groq_ai": "configured" if groq_client.is_configured else "fallback_mode",
    }

    return APIResponse(
        success=db_ok,
        data=HealthStatus(
            status=status_str,
            environment=settings.APP_ENV,
            database_connected=db_ok,
            services=services,
            version="0.1.0",
        ),
        message="Service is operational" if db_ok else "Database connectivity issue detected",
    )

