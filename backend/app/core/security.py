"""Security utilities for anonymous session management, headers, and rate limiting."""

import hashlib
import secrets
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

SESSION_HEADER_NAME = "X-Session-Token"
MAX_REQUEST_BODY_BYTES = 65536  # 64 KB maximum payload size


def generate_session_token() -> str:
    """Generate a high-entropy cryptographically secure random session token."""
    return f"clz_{secrets.token_urlsafe(32)}"


def hash_token(token: str) -> str:
    """Produce SHA-256 hash of a token for secure indexed lookup if needed."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_ip(ip_address: Optional[str]) -> Optional[str]:
    """Produce anonymized hash of user IP address for rate-limiting without storing PII."""
    if not ip_address:
        return None
    return hashlib.sha256(ip_address.encode("utf-8")).hexdigest()


class SlidingWindowRateLimiter:
    """In-memory sliding-window rate limiter for per-IP and per-session request protection."""

    def __init__(self, max_requests: int = 120, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._buckets: Dict[str, Deque[float]] = defaultdict(deque)

    def is_allowed(self, key: str) -> bool:
        """Return True if the key is within rate limit, False if exceeded."""
        now = time.monotonic()
        cutoff = now - self.window_seconds
        bucket = self._buckets[key]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= self.max_requests:
            return False
        bucket.append(now)
        return True

    def reset(self) -> None:
        """Clear rate limiter state (useful for test isolation)."""
        self._buckets.clear()


rate_limiter = SlidingWindowRateLimiter(max_requests=120, window_seconds=60)
