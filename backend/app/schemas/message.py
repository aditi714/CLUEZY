"""Message schemas for investigation conversations."""

import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator


class TurnCheckItem(BaseModel):
    """A single structured check or diagnostic action in a turn."""
    title: str = Field(..., min_length=1, description="Short title of the check")
    detail: str = Field(..., min_length=1, description="Explanation or instruction for the check")
    command: Optional[str] = Field(default=None, description="Optional terminal command or URL to run")


class TurnQuestion(BaseModel):
    """The primary question and quick-reply options presented at the end of a turn."""
    text: str = Field(..., min_length=1, description="The diagnostic question asked to the user")
    options: List[str] = Field(default_factory=list, description="Quick-reply options")


class TurnPresentation(BaseModel):
    """Structured presentation model for voice and visual turn rendering."""
    spoken: str = Field(
        ...,
        min_length=1,
        description="<=40 words, plain conversational sentences, no markdown/lists/URLs",
    )
    summary: str = Field(
        ...,
        min_length=1,
        description="One-line summary, never truncated with '...'",
    )
    checks: List[TurnCheckItem] = Field(
        default_factory=list,
        max_length=3,
        description="Up to 3 structured verification checks",
    )
    question: TurnQuestion = Field(
        ...,
        description="Structured question and quick-reply options",
    )

    @field_validator("spoken")
    @classmethod
    def validate_spoken(cls, v: str) -> str:
        clean = v.strip()
        if not clean:
            raise ValueError("spoken cannot be empty")
        # Reject markdown formatting, bullet lists, or URLs
        if re.search(r"https?://\S+", clean):
            raise ValueError("spoken must not contain URLs")
        if re.search(r"(`|\*\*|##|^\s*[-*•]\s)", clean, re.MULTILINE):
            raise ValueError("spoken must not contain markdown or bullet lists")
        words = clean.split()
        if len(words) > 40:
            raise ValueError(f"spoken exceeds 40 words (got {len(words)} words)")
        return clean

    @field_validator("summary")
    @classmethod
    def validate_summary(cls, v: str) -> str:
        clean = " ".join(v.strip().splitlines()).strip()
        if not clean:
            raise ValueError("summary cannot be empty")
        if "..." in clean or "…" in clean:
            raise ValueError("summary must not be truncated with '...'")
        return clean

    @field_validator("checks")
    @classmethod
    def validate_checks_max_three(cls, v: List[TurnCheckItem]) -> List[TurnCheckItem]:
        if len(v) > 3:
            raise ValueError("checks cannot have more than 3 items")
        return v


def sanitize_spoken_sentence(text: str, max_words: int = 38) -> str:
    """Convert raw text into plain conversational speech without markdown, lists, or URLs (<= max_words)."""
    s = re.sub(r"```[\s\S]*?```", " ", text or "")
    s = re.sub(r"`[^`]*`", " ", s)
    s = re.sub(r"\[([^\]]+)\]\(https?://[^\)]+\)", r"\1", s)
    s = re.sub(r"https?://\S+", " ", s)
    s = re.sub(r"[*_#~`[\]<>•▪]", " ", s)
    s = re.sub(r"\.\.\.+|…", ".", s)
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        s = "Please review the diagnostic check on screen and let me know what happens."
    words = s.split()
    if len(words) > max_words:
        s = " ".join(words[:max_words]).rstrip(",;:-") + "."
    return s


def build_fallback_turn_presentation(
    raw_text: str,
    options: Optional[List[str]] = None,
    summary_hint: Optional[str] = None,
    checks: Optional[List[Dict[str, Any]]] = None,
) -> TurnPresentation:
    """Build a valid TurnPresentation from free text when LLM output is missing or invalid."""
    text = (raw_text or "").strip()
    opts = [str(o).strip() for o in (options or []) if str(o).strip()]

    # Extract sentences
    clean_lines = [
        re.sub(r"^[\s•*\-\d.]+", "", ln).strip()
        for ln in text.splitlines()
        if ln.strip()
    ]
    joined = " ".join(clean_lines)
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", joined) if s.strip()]

    # Find first question sentence for question.text
    question_sentences = [s for s in sentences if "?" in s]
    if question_sentences:
        q_text = re.sub(r"[*_`]", "", question_sentences[0]).strip()
    elif sentences:
        q_text = re.sub(r"[*_`]", "", sentences[-1]).strip()
    else:
        q_text = "What do you observe when testing this step?"

    # Build one-line summary without "..."
    if summary_hint and summary_hint.strip():
        sum_line = " ".join(summary_hint.strip().splitlines())
    elif sentences:
        sum_line = re.sub(r"[*_`]", "", sentences[0]).strip()
    else:
        sum_line = "Isolating the root cause of your technical issue."
    sum_line = sum_line.replace("...", "").replace("…", "").strip()
    if not sum_line:
        sum_line = "Isolating the root cause of your technical issue."

    # Build checks (max 3)
    check_items: List[TurnCheckItem] = []
    if checks:
        for c in checks[:3]:
            if isinstance(c, TurnCheckItem):
                check_items.append(c)
            elif isinstance(c, dict) and c.get("title") and c.get("detail"):
                check_items.append(
                    TurnCheckItem(
                        title=str(c["title"]).strip(),
                        detail=str(c["detail"]).strip(),
                        command=str(c["command"]).strip() if c.get("command") else None,
                    )
                )

    # Generate spoken from summary + question (<= 40 words, plain sentences)
    spoken_candidate = sanitize_spoken_sentence(f"{sum_line} {q_text}", max_words=36)

    return TurnPresentation(
        spoken=spoken_candidate,
        summary=sum_line,
        checks=check_items[:3],
        question=TurnQuestion(text=q_text, options=opts),
    )


class MessageCreateRequest(BaseModel):
    """Payload to submit a user message within an investigation."""
    content: str = Field(..., min_length=1, max_length=10000, description="Text content of the message")
    selected_option: Optional[str] = Field(default=None, description="Pre-selected quick reply option if clicked")


class MessageResponse(BaseModel):
    """Schema representing a chat message."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    investigation_id: uuid.UUID
    sender: str
    content: str
    suggested_responses: Optional[List[str]] = None
    extra_data: Optional[Dict[str, Any]] = None
    presentation: Optional[TurnPresentation] = None
    created_at: datetime

    @classmethod
    def from_orm_message(cls, m: Any) -> "MessageResponse":
        """Validate ORM Message and extract extra_data['presentation'] into top-level presentation field."""
        obj = cls.model_validate(m)
        if obj.extra_data and isinstance(obj.extra_data.get("presentation"), dict):
            try:
                obj.presentation = TurnPresentation.model_validate(obj.extra_data["presentation"])
            except Exception:
                obj.presentation = None
        return obj


