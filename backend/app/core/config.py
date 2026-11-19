"""Application settings and configuration management."""

import json
from typing import List, Union
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # Application
    APP_ENV: str = Field(default="development", description="Environment: development, staging, production")
    DEBUG: bool = Field(default=True, description="Debug mode flag")
    PROJECT_NAME: str = Field(default="CLUEZY Backend API", description="Project Name")
    API_V1_PREFIX: str = Field(default="/api/v1", description="API V1 route prefix")

    # CORS
    CORS_ORIGINS: Union[List[str], str] = Field(
        default=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"],
        description="Allowed CORS origins",
    )

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            if v.strip().startswith("[") and v.strip().endswith("]"):
                try:
                    return json.loads(v)
                except Exception:
                    pass
            return [i.strip() for i in v.split(",") if i.strip()]
        return v

    # Database Settings (Supabase PostgreSQL / Local Fallback)
    DATABASE_URL: str = Field(
        default="sqlite+aiosqlite:///./cluezy.db",
        description="Async database connection URL (PostgreSQL + asyncpg or SQLite for tests)",
    )
    DATABASE_URL_SYNC: str = Field(
        default="",
        description="Sync database connection URL for Alembic migrations",
    )
    DB_POOL_SIZE: int = Field(default=10, description="Database connection pool size")
    DB_MAX_OVERFLOW: int = Field(default=20, description="Max overflow connections")
    DB_POOL_TIMEOUT: int = Field(default=30, description="Pool checkout timeout in seconds")

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def assemble_async_db_url(cls, v: str) -> str:
        if not v or not v.strip():
            return "sqlite+aiosqlite:///./cluezy.db"
        v = v.strip()
        # Convert standard postgresql / postgres URLs to postgresql+asyncpg
        if v.startswith("postgres://"):
            v = "postgresql+asyncpg://" + v[len("postgres://"):]
        elif v.startswith("postgresql://") and not v.startswith("postgresql+"):
            v = "postgresql+asyncpg://" + v[len("postgresql://"):]
        return v

    # Groq AI Model Configuration
    # Primary model required: openai/gpt-oss-120b
    GROQ_API_KEY: str = Field(default="", description="Groq API key")
    GROQ_MODEL: str = Field(default="openai/gpt-oss-120b", description="Default primary Groq model")
    GROQ_TIMEOUT_SECONDS: float = Field(default=30.0, description="Groq API client timeout in seconds")
    GROQ_MAX_RETRIES: int = Field(default=2, description="Max retries for transient Groq errors")

    # Anonymous Session Configuration
    ANONYMOUS_SESSION_TTL_HOURS: int = Field(default=720, description="Session lifespan in hours (default 30 days)")
    DAILY_TOKEN_LIMIT: int = Field(default=200000, description="Daily anonymous token allowance")


settings = Settings()

