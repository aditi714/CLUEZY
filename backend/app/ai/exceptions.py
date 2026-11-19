"""Custom exceptions for Groq AI interactions."""

from typing import Optional


class GroqAIException(Exception):
    """Base exception for Groq AI operations."""

    def __init__(self, message: str, code: str = "GROQ_ERROR", original_error: Optional[Exception] = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.original_error = original_error

    def __str__(self) -> str:
        return f"[{self.code}] {self.message}"


class GroqRateLimitException(GroqAIException):
    """Raised when Groq API rate limits (HTTP 429) are encountered."""

    def __init__(self, message: str = "Groq API rate limit exceeded. Please retry shortly.", retry_after: Optional[float] = None, original_error: Optional[Exception] = None):
        super().__init__(message=message, code="RATE_LIMIT_EXCEEDED", original_error=original_error)
        self.retry_after = retry_after


class GroqTimeoutException(GroqAIException):
    """Raised when Groq API request times out."""

    def __init__(self, message: str = "Groq API request timed out.", original_error: Optional[Exception] = None):
        super().__init__(message=message, code="TIMEOUT", original_error=original_error)


class GroqServiceException(GroqAIException):
    """Raised when an internal or upstream Groq API error occurs."""

    def __init__(self, message: str, original_error: Optional[Exception] = None):
        super().__init__(message=message, code="SERVICE_ERROR", original_error=original_error)


class GroqValidationException(GroqAIException):
    """Raised when the Groq response fails Pydantic schema validation."""

    def __init__(self, message: str, raw_output: Optional[str] = None):
        super().__init__(message=message, code="VALIDATION_FAILED")
        self.raw_output = raw_output

