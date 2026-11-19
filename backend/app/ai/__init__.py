"""AI module package exposing Groq client, evidence extractor, and problem classifier."""

from app.ai.classifier import ProblemClassifier, problem_classifier
from app.ai.client import GroqClient, groq_client
from app.ai.exceptions import (
    GroqAIException,
    GroqRateLimitException,
    GroqServiceException,
    GroqTimeoutException,
    GroqValidationException,
)
from app.ai.extractor import EvidenceExtractor, evidence_extractor

__all__ = [
    "GroqClient",
    "groq_client",
    "EvidenceExtractor",
    "evidence_extractor",
    "ProblemClassifier",
    "problem_classifier",
    "GroqAIException",
    "GroqRateLimitException",
    "GroqTimeoutException",
    "GroqServiceException",
    "GroqValidationException",
]
