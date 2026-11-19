"""Pydantic schemas for AI-powered structured intelligence, evidence extraction, and problem classification."""

from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class ExtractedEvidenceItem(BaseModel):
    """A single structured observation or confirmed fact parsed from user text or logs."""
    model_config = ConfigDict(extra="ignore")

    category: str = Field(
        ...,
        description="Evidence category (e.g., 'device', 'os', 'network', 'software', 'error_code', 'symptom', 'user_action')",
        examples=["device", "network", "error_code"],
    )
    key: str = Field(
        ...,
        description="Evidence attribute name (e.g., 'Device', 'Operating System', 'Network State', 'Error Code')",
        examples=["Device", "Network State", "Error Code"],
    )
    value: str = Field(
        ...,
        description="Factual value or observed state",
        examples=["Laptop (Windows)", "Connected to Wi-Fi", "DNS_PROBE_FINISHED_NXDOMAIN"],
    )
    confidence: float = Field(
        default=0.9,
        ge=0.0,
        le=1.0,
        description="Confidence score for this specific piece of evidence (0.0 to 1.0)",
    )
    source: str = Field(
        default="user_text",
        description="Source of this observation: 'user_text', 'log_extract', or 'inferred'",
    )


class EvidenceExtractionResult(BaseModel):
    """Complete structured evidence extraction result with missing information analysis."""
    model_config = ConfigDict(extra="ignore")

    problem_summary: str = Field(
        ...,
        description="Concise, objective summary of the reported technical issue",
        examples=["Laptop connected to Wi-Fi cannot resolve websites while phone works on same network."],
    )
    evidence: List[ExtractedEvidenceItem] = Field(
        default_factory=list,
        description="List of structured evidence items extracted from user input and logs",
    )
    confidence: float = Field(
        default=0.85,
        ge=0.0,
        le=1.0,
        description="Overall confidence in the completeness and accuracy of the extraction (0.0 to 1.0)",
    )
    missing_information: List[str] = Field(
        default_factory=list,
        description="Specific technical details missing that are required to isolate the root cause",
        examples=[
            "Whether direct IP access (e.g., 1.1.1.1) works in browser",
            "Output of 'ping 8.8.8.8' and 'nslookup google.com'",
        ],
    )
    raw_symptoms: List[str] = Field(
        default_factory=list,
        description="Direct observable symptoms extracted from the report",
        examples=["Websites fail to open", "Browser shows connection error"],
    )


class ProblemClassificationResult(BaseModel):
    """Structured classification result determining domain category and technical scenario."""
    model_config = ConfigDict(extra="ignore")

    category: str = Field(
        ...,
        description="Top-level category: 'Network', 'OS', 'Software', 'Programming', 'Hardware'",
        examples=["Network", "Software", "OS"],
    )
    scenario: str = Field(
        ...,
        description="Specific identified technical scenario / failure pattern",
        examples=["DNS Resolution Failure", "Package / Module Import Error", "Wi-Fi Gateway Authentication"],
    )
    confidence: float = Field(
        default=0.9,
        ge=0.0,
        le=1.0,
        description="Classification confidence score (0.0 to 1.0)",
    )
    urgency: str = Field(
        default="Medium",
        description="Estimated user urgency level ('Low', 'Medium', 'High', 'Critical')",
    )
    reasoning: str = Field(
        ...,
        description="Technical justification for the chosen category and scenario",
        examples=["Symptoms of Wi-Fi connection with inability to resolve domains points directly to DNS resolution failure."],
    )

