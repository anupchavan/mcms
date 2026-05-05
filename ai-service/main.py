import os
import re
from functools import lru_cache
from typing import List, Any, Dict
from fastapi import FastAPI  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from pydantic import BaseModel  # type: ignore
from dotenv import load_dotenv

load_dotenv()

app=FastAPI(title="MCMS AI Service", version="1.0.0")

ALLOWED_ORIGINS=os.getenv("ALLOWED_ORIGINS", "http://localhost:5001,http://localhost:5173,*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def add_process_time_header(request, call_next):
    print(f"DEBUG: Incoming {request.method} request to {request.url.path}", flush=True)
    response = await call_next(request)
    print(f"DEBUG: Completed {request.method} {request.url.path} with status {response.status_code}", flush=True)
    return response

app.middleware("http")(add_process_time_header)

LOCAL_SUMMARY_MODEL = os.getenv(
    "LOCAL_SUMMARY_MODEL", "knkarthick/meeting-summary-samsum"
)


def _normalize_openai_compat_base_url(url: str) -> str:
    """Groq's OpenAI-compatible API lives at /openai/v1, not /v1 (fixes 404 unknown_url)."""
    raw = (url or "").strip().rstrip("/")
    if not raw:
        return "https://api.x.ai/v1"
    if "api.groq.com" in raw.lower() and "/openai" not in raw.lower():
        return "https://api.groq.com/openai/v1"
    return url.strip() or "https://api.x.ai/v1"


# Groq (https://console.groq.com) — official `groq` Python SDK, api.groq.com
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

groq_client = None
try:
    if GROQ_API_KEY:
        from groq import Groq  # type: ignore

        # Ignore GROK_BASE_URL here: the Groq SDK falls back to it when base_url is omitted,
        # which breaks chat paths (e.g. base .../v1 + /openai/v1/chat/completions → 404).
        groq_client = Groq(api_key=GROQ_API_KEY, base_url="https://api.groq.com")
        print("Groq client successfully initialized.")
    else:
        print("Groq client not configured (GROQ_API_KEY missing).")
except ImportError:
    print("Groq module not found.")

# xAI Grok (https://api.x.ai) — OpenAI-compatible HTTP API via `openai` package
GROK_API_KEY = os.getenv("GROK_API_KEY")
_GROK_BASE_RAW = os.getenv("GROK_BASE_URL", "https://api.x.ai/v1")
GROK_BASE_URL = _normalize_openai_compat_base_url(_GROK_BASE_RAW)
if GROK_BASE_URL != _GROK_BASE_RAW.strip():
    print(
        "Adjusted GROK_BASE_URL for Groq OpenAI compatibility "
        f"(was {_GROK_BASE_RAW!r}, using {GROK_BASE_URL!r}).",
        flush=True,
    )
# AI_MODEL kept as a legacy alias for deployments that still set it
GROK_MODEL = os.getenv("GROK_MODEL") or os.getenv("AI_MODEL", "grok-2-latest")


def _openai_compat_chat_model_for_base(base_url: str, configured_model: str) -> str:
    """Groq does not host xAI Grok IDs; use GROQ_MODEL when base is Groq."""
    b = (base_url or "").lower()
    if "api.groq.com" not in b:
        return configured_model
    m = (configured_model or "").strip().lower()
    if m.startswith("grok"):
        return GROQ_MODEL
    return configured_model

grok_openai_client = None
try:
    if GROK_API_KEY:
        from openai import OpenAI  # type: ignore

        grok_openai_client = OpenAI(api_key=GROK_API_KEY, base_url=GROK_BASE_URL)
        print("Grok (xAI) client successfully initialized.")
    else:
        print("Grok client not configured (GROK_API_KEY missing).")
except ImportError:
    print("OpenAI module not found.")


def get_preferred_client(task="general"):
    """Returns (client, model). Prefer Groq for heavy extraction/summary if configured."""
    if task in ("extraction", "summary"):
        if groq_client:
            return groq_client, GROQ_MODEL
        if grok_openai_client:
            _m = _openai_compat_chat_model_for_base(GROK_BASE_URL, GROK_MODEL)
            return grok_openai_client, _m
    else:
        if grok_openai_client:
            _mg = _openai_compat_chat_model_for_base(GROK_BASE_URL, GROK_MODEL)
            return grok_openai_client, _mg
        if groq_client:
            return groq_client, GROQ_MODEL
    return None, None

last_ai_error = None

@app.get("/")
async def root():
    return {
        "status": "online",
        "groq_initialized": groq_client is not None,
        "grok_initialized": grok_openai_client is not None,
        "primary_model": get_preferred_client()[1],
        "last_error": last_ai_error
    }


class TranscriptSegment(BaseModel):
    text: str
    speaker: str="Unknown"
    agendaItemId: str | None=None


class AgendaItem(BaseModel):
    id: str
    title: str


class SummarizeRequest(BaseModel):
    segments: List[TranscriptSegment]
    agenda_items: List[AgendaItem]=[]


class MinutesItem(BaseModel):
    id: str | None=None
    title: str
    status: str="pending"
    notes: str=""
    duration: int | None=None


class ActionItemInput(BaseModel):
    title: str
    status: str="pending"
    assignee: str | None=None
    deadline: str | None=None
    category: str | None=None


class MeetingSummaryRequest(BaseModel):
    meeting_title: str | None=None
    segments: List[TranscriptSegment]
    agenda_items: List[AgendaItem]=[]
    minutes_items: List[MinutesItem]=[]
    action_items: List[ActionItemInput]=[]


class ExtractActionsRequest(BaseModel):  # type: ignore
    text: str
    minutes_items: List[Dict[str, Any]]=[]


class SentimentRequest(BaseModel):
    text: str


class ExtractTagsRequest(BaseModel):
    text: str



def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def pyre_slice(s: str, start: int, stop: int) -> str:
    """Helper to satisfy Pyre2 where standard slicing is restricted."""
    return "".join([s[i] for i in range(max(0, start), min(stop, len(s)))])


def should_call_llm(text: str) -> bool:
    text_lower=text.lower()
    triggers=["assign", "assigned", "complete", "finalize", "need to", "should", "must", "will", "can you", "could you", "please", "task"]

    if any(trigger in text_lower for trigger in triggers):
        # Basic regex check for capitalized names (e.g., John)
        if re.search(r'\b[A-Z][a-z]+\b', text):
            return True
        if "assign" in text_lower:
             return True
    return False


def chunk_text(text: str, max_words: int=700) -> List[str]:
    words=text.split()
    if not words:
        return []
    return [
        " ".join([words[i] for i in range(index, min(len(words), index + max_words))])
        for index in range(0, len(words), max_words)
    ]


@lru_cache(maxsize=1)
def get_local_summarizer():
    try:
        import importlib
        transformers=importlib.import_module("transformers")
        pipeline=transformers.pipeline

        return pipeline(
            "summarization",
            model=LOCAL_SUMMARY_MODEL,
            tokenizer=LOCAL_SUMMARY_MODEL,
            device=-1,
        )
    except Exception as exc:
        print(f"Local summarizer unavailable: {exc}")
        return None


def summarize_with_local_model(text: str) -> str | None:
    summarizer=get_local_summarizer()
    if not summarizer:
        return None

    chunks=chunk_text(normalize_whitespace(text))
    if not chunks:
        return None

    partial_summaries: List[str]=[]
    for chunk in chunks:
        min_length=max(40, min(90, len(chunk.split()) // 3))
        max_length=max(80, min(180, len(chunk.split()) // 2))
        result=summarizer(
            chunk,
            max_length=max_length,
            min_length=min_length,
            do_sample=False,
            truncation=True,
        )
        summary_text=normalize_whitespace(result[0]["summary_text"])
        if summary_text:
            partial_summaries.append(summary_text)

    if not partial_summaries:
        return None
    if len(partial_summaries) == 1:
        return partial_summaries[0]

    combined=" ".join(partial_summaries)
    if len(combined.split()) <= 220:
        return combined

    result=summarizer(
        combined,
        max_length=220,
        min_length=80,
        do_sample=False,
        truncation=True,
    )
    return normalize_whitespace(result[0]["summary_text"])


def dedupe_keep_order(items: List[str], limit: int=6) -> List[str]:
    seen=set()
    output=[]
    for item in items:
        cleaned=normalize_whitespace(item)
        key=cleaned.lower()
        if not cleaned or key in seen:
            continue
        seen.add(key)
        output.append(cleaned)
        if len(output) >= limit:
            break
    return output


def collect_decisions(segments: List[TranscriptSegment]) -> List[str]:
    decision_cues=(
        "decided",
        "agreed",
        "approved",
        "resolved",
        "finalized",
        "confirmed",
    )
    matches=[]
    for seg in segments:
        text=normalize_whitespace(seg.text)
        if any(cue in text.lower() for cue in decision_cues):
            matches.append(f"{seg.speaker}: {text}")
    return dedupe_keep_order(matches, limit=5)


def collect_discussion_points(
    segments: List[TranscriptSegment], minutes_items: List[MinutesItem]
) -> List[str]:
    minute_titles=[item.title for item in minutes_items if item.title]
    transcript_points=[
        f"{seg.speaker}: {normalize_whitespace(seg.text)}"
        for seg in segments
        if len(normalize_whitespace(seg.text).split()) >= 6
    ]
    return dedupe_keep_order(minute_titles + transcript_points, limit=6)


def build_meeting_context(req: MeetingSummaryRequest) -> str:
    lines=[]
    if req.meeting_title:
        lines.append(f"Meeting title: {req.meeting_title}")
    if req.agenda_items:
        lines.append("Agenda:")
        lines.extend(f"- {item.title}" for item in req.agenda_items)
    if req.minutes_items:
        lines.append("Minutes progress:")
        lines.extend(
            f"- {item.title} [{item.status}]"
            + (f" Notes: {normalize_whitespace(item.notes)}" if item.notes else "")
            for item in req.minutes_items
        )
    if req.action_items:
        lines.append("Action items:")
        lines.extend(
            f"- {item.title} [{item.status}]"
            + (f" Assignee: {item.assignee}." if item.assignee else "")
            + (f" Deadline: {item.deadline}." if item.deadline else "")
            for item in req.action_items
        )
    lines.append("Transcript:")
    lines.extend(
        f"{seg.speaker}: {normalize_whitespace(seg.text)}" for seg in req.segments if seg.text
    )
    return "\n".join(lines)


def heuristic_meeting_summary(req: MeetingSummaryRequest) -> Dict[str, Any]:
    completed_items=dedupe_keep_order(
        [
            item.title
            for item in req.minutes_items
            if item.status.lower() in {"completed", "done"}
        ]
        + [
            item.title
            for item in req.action_items
            if item.status.lower() == "completed"
        ],
        limit=8,
    )
    pending_items=dedupe_keep_order(
        [
            item.title
            for item in req.minutes_items
            if item.status.lower() not in {"completed", "done"}
        ]
        + [
            item.title
            for item in req.action_items
            if item.status.lower() != "completed"
        ],
        limit=8,
    )
    next_steps=dedupe_keep_order(
        [
            f"{item.title} ({item.assignee or 'Unassigned'})"
            if item.assignee
            else item.title
            for item in req.action_items
            if item.status.lower() != "completed"
        ],
        limit=6,
    )
    decisions=collect_decisions(req.segments)
    discussion_points=collect_discussion_points(req.segments, req.minutes_items)
    overview_parts=[
        f"The meeting covered {len(req.segments)} transcript segment(s)."
    ]
    if discussion_points:
        overview_parts.append(f"Main topics included {', '.join([discussion_points[i] for i in range(min(3, len(discussion_points)))])}.")
    if completed_items:
        overview_parts.append(
            f"Completed items: {', '.join([completed_items[i] for i in range(min(3, len(completed_items)))])}."
        )
    if pending_items:
        overview_parts.append(f"Still pending: {', '.join([pending_items[i] for i in range(min(3, len(pending_items)))])}.")

    return {
        "overview": " ".join(overview_parts),
        "discussion_points": discussion_points,
        "completed_items": completed_items,
        "pending_items": pending_items,
        "decisions": decisions,
        "next_steps": next_steps,
        "model": "heuristic-fallback",
    }


@app.post("/summarize")
async def summarize(req: SummarizeRequest):
    segments_by_agenda: Dict[str, List[str]]={}
    for seg in req.segments:
        key=seg.agendaItemId or "_unlinked"
        segments_by_agenda.setdefault(key, []).append(f"{seg.speaker}: {seg.text}")

    client, model = get_preferred_client("summary")
    if client and req.agenda_items:
        try:
            agenda_info="\n".join(
                f"- {item.id}: {item.title}" for item in req.agenda_items
            )
            transcript_text="\n".join(
                f"{seg.speaker}: {seg.text}" for seg in req.segments
            )
            response=client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a meeting summarizer. Given agenda items and transcript, "
                            "produce a JSON object mapping each agenda item ID to a concise "
                            "1-2 sentence summary of what was discussed. Use the exact agenda IDs as keys."
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Agenda items:\n{agenda_info}\n\nTranscript:\n{transcript_text}",
                    },
                ],
                response_format={"type": "json_object"},
                max_tokens=1000,
            )
            import json
            summaries=json.loads(response.choices[0].message.content)
            return {"summaries": summaries, "model": model}
        except Exception as e:
            global last_ai_error
            last_ai_error = str(e)
            print(f"AI summarize error: {e}")
            return {"summaries": {}, "error": str(e), "model": model}

    summaries={}
    # ... (rest of function)
    for item in req.agenda_items:
        texts=segments_by_agenda.get(item.id, [])
        if texts:
            speakers=set()
            for t in texts:
                sp=t.split(":")[0].strip()
                if sp:
                    speakers.add(sp)
            summaries[item.id]=(
                f"{len(texts)} segment(s) discussed. "
                f"Key speakers: {', '.join(speakers) if speakers else 'Unknown'}."
            )
        else:
            summaries[item.id]="No discussion recorded for this item."

    unlinked=segments_by_agenda.get("_unlinked", [])
    if unlinked:
        summaries["_unlinked"]=f"{len(unlinked)} unlinked segment(s)."

    return {"summaries": summaries}


@app.post("/meeting-summary")
async def meeting_summary(req: MeetingSummaryRequest):
    context_text=build_meeting_context(req)
    client, model = get_preferred_client("summary")

    if client:
        try:
            response=client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a meeting summarizer. Return JSON with keys: 'overview' "
                            "(a comprehensive summary paragraph that incorporates all main topics, context, and future meeting scheduling details), "
                            "'completed_items' (array of strings), 'pending_items' (array of strings), 'decisions' (array of strings), "
                            "'next_steps' (array of strings). Do NOT include a 'discussion_points' key, incorporate all that info into the overview instead. "
                            "Use only facts from the provided data."
                        ),
                    },
                    {"role": "user", "content": context_text},
                ],
                response_format={"type": "json_object"},
                max_tokens=1500,
                temperature=0.2,
            )
            import json

            summary=json.loads(response.choices[0].message.content)
            summary["model"]=model
            return {"summary": summary}
        except Exception as exc:
            global last_ai_error
            last_ai_error = str(exc)
            print(f"AI meeting-summary error: {exc}")
            # Use heuristic summary as a lightweight non-LLM fallback
            fallback=heuristic_meeting_summary(req)
            fallback["overview"]=f"AI Error: {exc}. {fallback['overview']}"
            fallback["model"]="error-fallback"
            return {"summary": fallback}

    return {"summary": heuristic_meeting_summary(req)}


@app.post("/extract-actions")
async def extract_actions(req: ExtractActionsRequest):
    context_minutes=""
    if req.minutes_items:
        context_minutes="Ongoing Meeting Minutes:\n" + "\n".join(
            [f"- {m.get('title', '')}" for m in req.minutes_items if isinstance(m, dict) and m.get("title")]
        )

    actions: List[Dict[str, Any]]=[]
    client, model = get_preferred_client("extraction")

    if client:
        try:
            content=str(req.text)
            if context_minutes:
                content=f"{context_minutes}\n\nFull Meeting Transcript:\n{content}"

            response=client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are an expert meeting assistant. Your task is to process this entire meeting transcript at once. "
                            "First, construct an internal summary of the meeting's topics and context. "
                            "Then, based on your holistic understanding, extract the finalized action items assigned during the meeting. "
                            "Output ONLY a JSON object with a key 'actions' containing an array of objects with fields: "
                            "title (a complete, actionable, and coherent sentence describing the task, not a broken fragment), "
                            "assignee (the exact name of the person specifically assigned the task, or null), "
                            "deadline (string or null), "
                            "category (Technical/Administrative/Decision/Follow-up), and confidence (float). "
                            "Be extremely careful to correctly identify who is assigned each task based on the conversational context. "
                            "For example, if A says 'I assign B the task to do X', the assignee is B and the title is 'do X'."
                        ),
                    },
                    {"role": "user", "content": pyre_slice(content, 0, 100000)}, # Up to 100k chars for full meeting text
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )
            import json
            try:
                data=json.loads(response.choices[0].message.content)
                actions.extend(data.get("actions", []))
            except json.JSONDecodeError:
                pass
        except Exception as e:
            global last_ai_error
            last_ai_error = str(e)
            print(f"AI extract-actions error: {e}")

    # Deduplicate LLM-extracted actions
    if actions:
        seen=set()
        unique_actions: List[Dict[str, Any]]=[]
        for a in actions:
            assignee_key=a.get("assignee") or ""
            key=f"{a.get('title', '').lower()}|{assignee_key.lower()}"
            if key not in seen:
                seen.add(key)
                unique_actions.append(a)

        return {"actions": [unique_actions[i] for i in range(min(10, len(unique_actions)))]}

    # Fallback if no LLM client or extraction returned no actions
    action_patterns=[
        r"(?:assign|assigned)\s+(.+?)\s+to\s+(.+?)(?:\.|$)",
        r"(.+?),\s+(?:please|can you|could you)\s+(.+?)(?:\.|$)",
        r"^(?:please|can you|could you)\s+(.+?)(?:\.|$)",
        r"(?:need to|should|will|must|has to|going to)\s+(.+?)(?:\.|$)",
        r"(?:action item|todo|task)[:\s]+(.+?)(?:\.|$)",
    ]
    lines=req.text.split("\n")
    for raw_line in lines:
        speaker_match=re.match(r"^(\w[\w\s.]+?):\s*", raw_line)
        current_speaker=speaker_match.group(1).strip() if speaker_match else None

        # Strip speaker from raw_line for better sentence splitting
        if speaker_match:
            speaker_prefix_len = len(speaker_match.group(0))
            text_only = pyre_slice(raw_line, speaker_prefix_len, len(raw_line)).strip()
        else:
            text_only = raw_line.strip()

        sentences = re.split(r'(?<=[.!?])\s+', text_only)
        for line in sentences:
            for pattern in action_patterns:
                matches=re.findall(pattern, line, re.IGNORECASE)
                for match in matches:
                    if isinstance(match, tuple):
                        # The title is usually the last non-empty capture group in our patterns
                        m0=str(match[-1]) if len(match) > 0 else ""
                        title=m0.strip()
                    else:
                        title=str(match).strip()

                    if len(title) > 4 and len(title) < 200:
                        assignee=current_speaker

                        # Special handling for "assign X to Y"
                        assign_match=re.search(r"(?:assign|assigned)\s+(.+?)\s+to\s+(.+?)(?:\.|$)", line, re.IGNORECASE)
                        if assign_match:
                            assignee=assign_match.group(2).strip()

                        # Special handling for "User, please do X"
                        please_match=re.search(r"^(\w[\w\s.]+?),\s+(?:please|can you)\s+(.+?)(?:\.|$)", line, re.IGNORECASE)
                        if please_match:
                            assignee=please_match.group(1).strip()

                        # Find the relevant part of the sentence that matches pattern criteria
                        stripped_title_length=min(150, len(title))
                        final_title=pyre_slice(title, 0, stripped_title_length).strip()

                        if final_title:
                            actions.append(
                                {
                                    "title": final_title,
                                    "assignee": assignee,
                                    "deadline": None,
                                    "category": "Technical",
                                    "confidence": 0.5,
                                }
                            )

    seen=set()
    unique_actions: List[Dict[str, Any]]=[]
    for a in actions:
        key=a["title"].lower()
        if key not in seen:
            seen.add(key)
            unique_actions.append(a)

    return {"actions": [unique_actions[i] for i in range(min(10, len(unique_actions)))]}


@app.post("/extract-tags")
async def extract_tags(req: ExtractTagsRequest):
    client, model = get_preferred_client("summary")
    default_tags = ["Meeting", "Discussion", "General"]

    if client:
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a meeting assistant. Given a meeting transcript, extract 3 to 5 high-level, "
                            "semantic tags that describe the meeting's topics, domain, or outcome (e.g., 'Strategic Planning', "
                            "'Code Review', 'Urgent', 'Budget', 'Brainstorming'). "
                            "Return a JSON object with a single key 'tags' mapping to an array of strings."
                        ),
                    },
                    {"role": "user", "content": pyre_slice(str(req.text), 0, 15000)},
                ],
                response_format={"type": "json_object"},
                max_tokens=150,
                temperature=0.3,
            )
            import json
            data = json.loads(response.choices[0].message.content)
            tags = data.get("tags", default_tags)
            if not isinstance(tags, list):
                tags = default_tags
            return {"tags": [str(t).strip() for t in tags[:5]]}
        except Exception as e:
            global last_ai_error
            last_ai_error = str(e)
            print(f"AI extract-tags error: {e}")
            return {"tags": default_tags}
    return {"tags": default_tags}


@app.post("/sentiment")
async def sentiment(req: SentimentRequest):
    client, model = get_preferred_client("sentiment")
    if client:
        try:
            response=client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Classify the sentiment of the following text as exactly one of: "
                            "positive, neutral, negative. Return JSON with key 'score'."
                        ),
                    },
                    {"role": "user", "content": pyre_slice(str(req.text), 0, 500)},
                ],
                response_format={"type": "json_object"},
                max_tokens=50,
            )
            import json
            data=json.loads(response.choices[0].message.content)
            return {"score": data.get("score", "neutral")}
        except Exception as e:
            global last_ai_error
            last_ai_error = str(e)
            print(f"AI sentiment error: {e}")

    text_lower=req.text.lower()
    positive_words={"great", "good", "excellent", "happy", "thanks", "agree", "perfect", "wonderful", "love"}
    negative_words={"bad", "wrong", "fail", "issue", "problem", "concern", "disagree", "terrible", "hate"}

    pos_count=sum(1 for w in positive_words if w in text_lower)
    neg_count=sum(1 for w in negative_words if w in text_lower)

    if pos_count > neg_count:
        return {"score": "positive"}
    elif neg_count > pos_count:
        return {"score": "negative"}
    return {"score": "neutral"}
