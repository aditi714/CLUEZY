"""Groq AI SDK client configuration and resilient client wrapper."""

import json
import logging
from typing import Any, Dict, List, Optional, Type, TypeVar
from pydantic import BaseModel, ValidationError

from app.ai.exceptions import (
    GroqAIException,
    GroqRateLimitException,
    GroqServiceException,
    GroqTimeoutException,
    GroqValidationException,
)
from app.core.config import settings

logger = logging.getLogger(__name__)

try:
    from groq import (
        APIConnectionError,
        APIError,
        APITimeoutError,
        AsyncGroq,
        RateLimitError,
    )
    GROQ_AVAILABLE = True
except ImportError:
    GROQ_AVAILABLE = False
    AsyncGroq = None  # type: ignore
    APIConnectionError = Exception  # type: ignore
    APIError = Exception  # type: ignore
    APITimeoutError = Exception  # type: ignore
    RateLimitError = Exception  # type: ignore

T = TypeVar("T", bound=BaseModel)


def mask_key(key: Optional[str]) -> str:
    """Safely mask API key for logging without leaking secrets."""
    if not key:
        return "<not-set>"
    if len(key) <= 8:
        return "***"
    return f"{key[:4]}...{key[-4:]}"


class GroqClient:
    """Wrapper around official Groq Python SDK with resilient error handling and structured JSON output."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
    ):
        self.api_key = api_key if api_key is not None else settings.GROQ_API_KEY
        self.model = model or settings.GROQ_MODEL
        self.timeout = timeout if timeout is not None else settings.GROQ_TIMEOUT_SECONDS
        self.max_retries = max_retries if max_retries is not None else settings.GROQ_MAX_RETRIES
        self._async_client: Optional[Any] = None

    @property
    def is_configured(self) -> bool:
        """Check whether valid Groq API credentials are configured."""
        return bool(self.api_key and self.api_key.startswith("gsk_") and not any(p in self.api_key for p in ["[YOUR-", "your_"]))

    def get_async_client(self) -> Optional[Any]:
        """Lazy-load the AsyncGroq client."""
        if not GROQ_AVAILABLE:
            logger.warning("Official Groq SDK is not installed.")
            return None
        if not self.is_configured:
            logger.debug("Groq API key not configured or is a placeholder. Client in fallback mode.")
            return None
        if self._async_client is None:
            self._async_client = AsyncGroq(
                api_key=self.api_key,
                timeout=self.timeout,
                max_retries=self.max_retries,
            )
        return self._async_client

    def set_mock_client(self, mock_client: Any) -> None:
        """Inject a mock client for unit testing."""
        self._async_client = mock_client

    async def generate_chat_completion(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.1,
        max_tokens: int = 1500,
        response_format: Optional[Dict[str, str]] = None,
    ) -> Optional[str]:
        """Execute chat completion with robust timeout, rate-limit, and connection error handling."""
        client = self.get_async_client()
        if not client:
            return None

        kwargs: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if response_format:
            kwargs["response_format"] = response_format

        try:
            response = await client.chat.completions.create(**kwargs)
            return response.choices[0].message.content
        except RateLimitError as exc:
            logger.warning("Groq rate limit exceeded (HTTP 429).")
            raise GroqRateLimitException(
                message="Groq API rate limit exceeded. Please back off and retry.",
                original_error=exc,
            ) from exc
        except APITimeoutError as exc:
            logger.warning(f"Groq API request timed out after {self.timeout}s.")
            raise GroqTimeoutException(
                message=f"Groq request timed out after {self.timeout}s.",
                original_error=exc,
            ) from exc
        except APIConnectionError as exc:
            logger.error("Groq API network connection failure.")
            raise GroqServiceException(
                message="Failed to connect to Groq AI inference service.",
                original_error=exc,
            ) from exc
        except APIError as exc:
            logger.error(f"Groq API error encountered: {exc.message if hasattr(exc, 'message') else exc}")
            raise GroqServiceException(
                message="Groq inference service returned an error.",
                original_error=exc,
            ) from exc
        except Exception as exc:
            logger.error(f"Unexpected error communicating with Groq: {type(exc).__name__}")
            raise GroqServiceException(
                message=f"Unexpected Groq execution error: {type(exc).__name__}",
                original_error=exc,
            ) from exc

    async def generate_structured_json(
        self,
        messages: List[Dict[str, str]],
        response_model: Type[T],
        temperature: float = 0.1,
        max_tokens: int = 1500,
    ) -> Optional[T]:
        """Execute chat completion with JSON mode and validate against a target Pydantic schema."""
        raw_text = await self.generate_chat_completion(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        if not raw_text:
            return None

        try:
            # Parse and validate against the Pydantic schema
            return response_model.model_validate_json(raw_text.strip())
        except (ValidationError, json.JSONDecodeError) as exc:
            logger.error(f"Failed to validate Groq structured output against {response_model.__name__}: {exc}")
            raise GroqValidationException(
                message=f"Model output did not match required schema {response_model.__name__}",
                raw_output=raw_text,
            ) from exc


groq_client = GroqClient()
