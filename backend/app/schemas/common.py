"""Common response wrappers and pagination schemas."""

from typing import Generic, List, Optional, TypeVar
from pydantic import BaseModel, Field

T = TypeVar("T")


class APIResponse(BaseModel, Generic[T]):
    """Standard unified API response wrapper."""
    success: bool = Field(default=True, description="Indicates request success status")
    data: Optional[T] = Field(default=None, description="Response payload")
    message: Optional[str] = Field(default=None, description="User or developer message")


class PaginatedResponse(BaseModel, Generic[T]):
    """Unified paginated list response schema."""
    items: List[T] = Field(default_factory=list, description="Page items")
    total: int = Field(default=0, description="Total count")
    page: int = Field(default=1, description="Current page number")
    page_size: int = Field(default=20, description="Number of items per page")
    has_more: bool = Field(default=False, description="Whether more records exist")

