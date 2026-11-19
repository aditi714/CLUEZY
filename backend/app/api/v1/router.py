"""Aggregated API router for version 1 endpoints."""

from fastapi import APIRouter
from app.api.v1.endpoints import health, investigations, sessions

api_router = APIRouter()

api_router.include_router(health.router, tags=["Health"])
api_router.include_router(sessions.router, prefix="/sessions", tags=["Anonymous Sessions"])
api_router.include_router(investigations.router, prefix="/investigations", tags=["Investigations"])

