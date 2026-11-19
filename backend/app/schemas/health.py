"""Health check response schemas."""

from typing import Dict
from pydantic import BaseModel, Field


class HealthStatus(BaseModel):
    """System health check model."""
    status: str = Field(default="healthy", description="Application status: healthy or degraded")
    environment: str = Field(..., description="Active environment name")
    database_connected: bool = Field(..., description="Database connection health check result")
    services: Dict[str, str] = Field(default_factory=dict, description="Status of auxiliary services")
    version: str = Field(default="0.1.0", description="API version")

