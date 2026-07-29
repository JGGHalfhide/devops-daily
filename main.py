import json
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from db import get_conn, init_db

load_dotenv()

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

EST = timezone(timedelta(hours=-5))
TOPICS = ["Python", "Bash", "AWS", "Ansible", "Kubernetes", "Linux", "Networking"]
DIFFICULTIES = ["easy", "medium", "hard"]
WEAKEST_MIN_ATTEMPTS = 10


@app.on_event("startup")
def startup():
    init_db()


# ── time helpers ─────────────────────────────────────────────────────────────

def _now_est() -> datetime:
    return datetime.now(EST)


def _today_est() -> date:
    return _now_est().date()


def _est_date(iso_ts: str) -> date:
    return datetime.fromisoformat(iso_ts).astimezone(EST).date()


def _seconds_until_midnight_est() -> int:
    now = _now_est()
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((tomorrow - now).total_seconds())


# ── attempt / stats helpers ──────────────────────────────────────────────────

def _all_attempts(conn) -> list:
    rows = conn.execute("SELECT * FROM attempts ORDER BY timestamp DESC").fetchall()
    return [dict(r) for r in rows]


def _todays_attempt(attempts: list) -> Optional[dict]:
    today = _today_est()
    for a in attempts:
        if _est_date(a["timestamp"]) == today:
            return a
    return None


def _compute_streak(attempts: list) -> int:
    dates = sorted({_est_date(a["timestamp"]) for a in attempts}, reverse=True)
    if not dates:
        return 0
    today = _today_est()
    if (today - dates[0]).days > 1:
        return 0
    streak = 1
    for i in range(1, len(dates)):
        if (dates[i - 1] - dates[i]).days == 1:
            streak += 1
        else:
            break
    return streak


def _pct(correct: int, total: int) -> Optional[float]:
    if not total:
        return None
    return round(100 * correct / total, 1)


def _group_stats(attempts: list, key: str) -> dict:
    groups: dict = {}
    for a in attempts:
        g = groups.setdefault(a[key], {"total": 0, "correct": 0})
        g["total"] += 1
        g["correct"] += int(a["correct"])
    return {
        name: {"total": g["total"], "correct": g["correct"], "pct": _pct(g["correct"], g["total"])}
        for name, g in groups.items()
    }


def _compute_stats(attempts: list) -> dict:
    total = len(attempts)
    correct = sum(a["correct"] for a in attempts)
    by_topic = _group_stats(attempts, "topic")
    weakest_eligible = total >= WEAKEST_MIN_ATTEMPTS
    weakest_topic = None
    if weakest_eligible and by_topic:
        weakest_topic = min(by_topic, key=lambda t: by_topic[t]["pct"])
    return {
        "total_attempts": total,
        "overall_pct": _pct(correct, total),
        "by_difficulty": _group_stats(attempts, "difficulty"),
        "by_topic": by_topic,
        "streak": _compute_streak(attempts),
        "weakest_eligible": weakest_eligible,
        "weakest_topic": weakest_topic,
    }


# ── question helpers ─────────────────────────────────────────────────────────

def _serialize_question(row: dict) -> dict:
    q = dict(row)
    if q.get("options"):
        q["options"] = json.loads(q["options"])
    q.pop("correct_answer", None)
    q.pop("explanation_correct", None)
    q.pop("explanation_incorrect", None)
    return q


def _resolve_incorrect_explanation(raw: Optional[str], user_answer: str) -> Optional[str]:
    if raw is None:
        return None
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return raw
    if isinstance(parsed, dict):
        return parsed.get(user_answer) or next(iter(parsed.values()), raw)
    return raw


def _explanation_for(q: dict, correct: bool, user_answer: str) -> Optional[str]:
    if correct:
        return q["explanation_correct"]
    return _resolve_incorrect_explanation(q["explanation_incorrect"], user_answer)


def _display_correct_answer(q: dict):
    if q["type"] in ("drag-and-drop", "dropdown-order"):
        return json.loads(q["correct_answer"])
    return q["correct_answer"]


# ── LLM grading (coding questions) ───────────────────────────────────────────

def _grade_coding(prompt: str, reference_solution: str, user_answer: str):
    client = anthropic.Anthropic()
    schema = {
        "type": "object",
        "properties": {
            "correct": {"type": "boolean"},
            "feedback": {"type": "string"},
        },
        "required": ["correct", "feedback"],
        "additionalProperties": False,
    }
    grading_prompt = f"""You are grading a DevOps practice exercise (bash/python coding question). \
Grade like an experienced human reviewer, not a strict linter: mark the answer correct if the \
core logic and approach are right, even if the syntax is inelegant or has minor issues that \
wouldn't affect the outcome.

Question:
{prompt}

Reference solution:
{reference_solution}

Student's answer:
{user_answer}

Respond with whether the student's answer is correct, and 2-3 sentences of specific feedback."""

    response = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=1024,
        output_config={"format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": grading_prompt}],
    )
    text = next(b.text for b in response.content if b.type == "text")
    data = json.loads(text)
    return bool(data["correct"]), data["feedback"]


# ── GET / ────────────────────────────────────────────────────────────────────

@app.get("/")
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request, "topics": TOPICS})


# ── GET /api/state ───────────────────────────────────────────────────────────

@app.get("/api/state")
def get_state():
    with get_conn() as conn:
        attempts = _all_attempts(conn)
        today_attempt = _todays_attempt(attempts)
        if not today_attempt:
            return {"locked": False}

        row = conn.execute(
            "SELECT * FROM questions WHERE id = ?", (today_attempt["question_id"],)
        ).fetchone()
        q = dict(row) if row else None

        today_info = {
            "topic": today_attempt["topic"],
            "difficulty": today_attempt["difficulty"],
            "type": today_attempt["type"],
            "prompt": q["prompt"] if q else None,
            "user_answer": today_attempt["user_answer"],
            "correct": bool(today_attempt["correct"]),
            "correct_answer": _display_correct_answer(q) if q else None,
            "explanation": (
                _explanation_for(q, bool(today_attempt["correct"]), today_attempt["user_answer"])
                if q else None
            ),
            "llm_feedback": today_attempt["llm_feedback"],
        }

        return {
            "locked": True,
            "seconds_until_reset": _seconds_until_midnight_est(),
            "today": today_info,
        }


# ── GET /api/stats ───────────────────────────────────────────────────────────

@app.get("/api/stats")
def get_stats():
    with get_conn() as conn:
        return _compute_stats(_all_attempts(conn))


# ── GET /api/question ────────────────────────────────────────────────────────

@app.get("/api/question")
def get_question(difficulty: str = "random", topic: str = "Random"):
    difficulty = difficulty.lower()
    if difficulty not in DIFFICULTIES + ["random"]:
        raise HTTPException(status_code=400, detail="Invalid difficulty")

    with get_conn() as conn:
        attempts = _all_attempts(conn)
        if _todays_attempt(attempts):
            raise HTTPException(status_code=409, detail="Already answered today")

        resolved_topic = None
        if topic == "Random":
            resolved_topic = None
        elif topic == "Weakest":
            stats = _compute_stats(attempts)
            if not stats["weakest_eligible"]:
                raise HTTPException(
                    status_code=400,
                    detail="Weakest topic isn't available yet (need 10+ total attempts)",
                )
            resolved_topic = stats["weakest_topic"]
        elif topic in TOPICS:
            resolved_topic = topic
        else:
            raise HTTPException(status_code=400, detail="Invalid topic")

        answered_ids = [a["question_id"] for a in attempts]

        query = "SELECT * FROM questions WHERE 1=1"
        params: list = []
        if answered_ids:
            placeholders = ",".join("?" * len(answered_ids))
            query += f" AND id NOT IN ({placeholders})"
            params += answered_ids
        if difficulty != "random":
            query += " AND difficulty = ?"
            params.append(difficulty)
        if resolved_topic:
            query += " AND topic = ?"
            params.append(resolved_topic)
        query += " ORDER BY RANDOM() LIMIT 1"

        row = conn.execute(query, params).fetchone()
        if not row:
            raise HTTPException(
                status_code=404,
                detail="No unanswered questions available for that combination — try different filters",
            )

        return _serialize_question(dict(row))


# ── POST /api/answer ─────────────────────────────────────────────────────────

class AnswerPayload(BaseModel):
    question_id: int
    user_answer: str


@app.post("/api/answer")
def post_answer(payload: AnswerPayload):
    with get_conn() as conn:
        attempts = _all_attempts(conn)
        if _todays_attempt(attempts):
            raise HTTPException(status_code=409, detail="Already answered today")

        row = conn.execute(
            "SELECT * FROM questions WHERE id = ?", (payload.question_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Question not found")
        q = dict(row)

        llm_feedback = None
        correct_answer_out = _display_correct_answer(q)

        if q["type"] == "coding":
            try:
                correct, llm_feedback = _grade_coding(
                    q["prompt"], q["correct_answer"], payload.user_answer
                )
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"LLM grading failed: {e}")
            explanation = _explanation_for(q, correct, payload.user_answer)

        elif q["type"] in ("drag-and-drop", "dropdown-order"):
            try:
                user_order = json.loads(payload.user_answer)
            except json.JSONDecodeError:
                user_order = None
            correct = user_order == json.loads(q["correct_answer"])
            explanation = _explanation_for(q, correct, payload.user_answer)

        else:  # mcq / fill-in-blank
            correct = payload.user_answer.strip().lower() == q["correct_answer"].strip().lower()
            explanation = _explanation_for(q, correct, payload.user_answer)

        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """INSERT INTO attempts
               (question_id, timestamp, topic, difficulty, type, user_answer, correct, llm_feedback)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                payload.question_id,
                now,
                q["topic"],
                q["difficulty"],
                q["type"],
                payload.user_answer,
                int(correct),
                llm_feedback,
            ),
        )

        return {
            "correct": correct,
            "explanation": explanation,
            "correct_answer": correct_answer_out,
            "llm_feedback": llm_feedback,
        }
