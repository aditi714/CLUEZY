"""CLUEZY Backend FastAPI Application."""

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.endpoints.health import router as health_router
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import check_db_connectivity, engine, init_db
from app.core.errors import register_exception_handlers
from app.core.security import (
    MAX_REQUEST_BODY_BYTES,
    SESSION_HEADER_NAME,
    hash_ip,
    rate_limiter,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager handling startup and shutdown hooks."""
    # Startup: initialize database tables if SQLite/local dev
    if settings.DATABASE_URL.startswith("sqlite"):
        await init_db()
    await check_db_connectivity()
    yield
    # Shutdown: dispose database connection pool
    await engine.dispose()


def create_application() -> FastAPI:
    """FastAPI application factory."""
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version="0.1.0",
        description="CLUEZY - AI-Powered Technical Problem Solving Backend API with Supabase PostgreSQL and Groq LLM integration.",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    # Configure Cross-Origin Resource Sharing (CORS)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Session-Token"],
    )

    @app.middleware("http")
    async def security_and_rate_limit_middleware(request: Request, call_next):
        """Enforce request size limits and per-IP / per-session sliding-window rate limits."""
        # 1. Check Content-Length header if present
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > MAX_REQUEST_BODY_BYTES:
                    return JSONResponse(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        content={
                            "success": False,
                            "error": {
                                "code": "PAYLOAD_TOO_LARGE",
                                "message": f"Request payload exceeds maximum limit of {MAX_REQUEST_BODY_BYTES} bytes.",
                                "details": None,
                            },
                        },
                    )
            except ValueError:
                pass

        # 2. Enforce per-IP and per-session rate limiting on API endpoints
        if request.url.path.startswith(settings.API_V1_PREFIX):
            client_ip = request.client.host if request.client else "unknown"
            ip_key = f"ip:{hash_ip(client_ip) or client_ip}"
            if not rate_limiter.is_allowed(ip_key):
                return JSONResponse(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    content={
                        "success": False,
                        "error": {
                            "code": "RATE_LIMIT_EXCEEDED",
                            "message": "Too many requests from this IP address. Please wait a moment and try again.",
                            "details": None,
                        },
                    },
                )

            session_token = request.headers.get(SESSION_HEADER_NAME)
            if session_token:
                sess_key = f"sess:{session_token[:32]}"
                if not rate_limiter.is_allowed(sess_key):
                    return JSONResponse(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        content={
                            "success": False,
                            "error": {
                                "code": "RATE_LIMIT_EXCEEDED",
                                "message": "Session request rate limit exceeded. Please wait before submitting again.",
                                "details": None,
                            },
                        },
                    )

        return await call_next(request)

    # Register centralized exception handlers
    register_exception_handlers(app)

    # Top-level health endpoint (e.g. for Vercel / container health probes)
    app.include_router(health_router, prefix="", tags=["Health"])

    # Include versioned API endpoints
    app.include_router(api_router, prefix=settings.API_V1_PREFIX)

    @app.get("/", tags=["Root"])
    async def root():
        return {
            "name": settings.PROJECT_NAME,
            "version": "0.1.0",
            "status": "online",
            "docs": "/docs",
            "health": "/health",
        }

    return app


app = create_application()
