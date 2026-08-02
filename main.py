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
TOPICS = ["Python", "Bash", "AWS", "Ansible", "Kubernetes", "Linux", "Networking", "Terraform"]
DIFFICULTIES = ["easy", "medium", "hard"]
QUESTION_TYPES = ["mcq", "fill-in-blank", "drag-and-drop", "dropdown-order", "coding"]
QUESTION_TYPES_BLITZ = [t for t in QUESTION_TYPES if t != "coding"]
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
    q.pop("last_seen_at", None)
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


def _resolve_topic(topic: str, attempts: list) -> Optional[str]:
    if topic == "Random":
        return None
    if topic == "Weakest":
        stats = _compute_stats(attempts)
        if not stats["weakest_eligible"]:
            raise HTTPException(
                status_code=400,
                detail="Weakest topic isn't available yet (need 10+ total attempts)",
            )
        return stats["weakest_topic"]
    if topic in TOPICS:
        return topic
    raise HTTPException(status_code=400, detail="Invalid topic")


def _grade_non_coding(q: dict, user_answer: str) -> bool:
    if q["type"] in ("drag-and-drop", "dropdown-order"):
        try:
            user_order = json.loads(user_answer)
        except json.JSONDecodeError:
            user_order = None
        return user_order == json.loads(q["correct_answer"])
    return user_answer.strip().lower() == q["correct_answer"].strip().lower()


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
def get_state(practice: bool = False):
    with get_conn() as conn:
        attempts = _all_attempts(conn)
        today_attempt = _todays_attempt(attempts)
        if not today_attempt or practice:
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
        stats = _compute_stats(_all_attempts(conn))
        stats["best_blitz_score"] = conn.execute(
            "SELECT MAX(score) AS best FROM blitz_runs"
        ).fetchone()["best"]
        return stats


# ── GET /api/question ────────────────────────────────────────────────────────

@app.get("/api/question")
def get_question(
    difficulty: str = "random", topic: str = "Random", qtype: str = "Random", practice: bool = False
):
    difficulty = difficulty.lower()
    if difficulty not in DIFFICULTIES + ["random"]:
        raise HTTPException(status_code=400, detail="Invalid difficulty")
    if qtype != "Random" and qtype not in QUESTION_TYPES:
        raise HTTPException(status_code=400, detail="Invalid question type")

    with get_conn() as conn:
        attempts = _all_attempts(conn)
        if _todays_attempt(attempts) and not practice:
            raise HTTPException(status_code=409, detail="Already answered today")

        resolved_topic = _resolve_topic(topic, attempts)

        pool_query = "SELECT id FROM questions WHERE 1=1"
        pool_params: list = []
        if difficulty != "random":
            pool_query += " AND difficulty = ?"
            pool_params.append(difficulty)
        if resolved_topic:
            pool_query += " AND topic = ?"
            pool_params.append(resolved_topic)
        if qtype != "Random":
            pool_query += " AND type = ?"
            pool_params.append(qtype)

        def pick_unseen():
            return conn.execute(
                f"SELECT * FROM questions WHERE id IN ({pool_query}) "
                "AND last_seen_at IS NULL ORDER BY RANDOM() LIMIT 1",
                pool_params,
            ).fetchone()

        row = pick_unseen()
        if not row:
            # Every question matching this combination has already been seen (or
            # there are none at all) — recycle the whole matching pool and retry.
            conn.execute(f"UPDATE questions SET last_seen_at = NULL WHERE id IN ({pool_query})", pool_params)
            row = pick_unseen()

        if not row:
            raise HTTPException(
                status_code=404,
                detail="No questions available for that combination — try different filters",
            )

        return _serialize_question(dict(row))


# ── POST /api/answer ─────────────────────────────────────────────────────────

class AnswerPayload(BaseModel):
    question_id: int
    user_answer: str
    practice: bool = False


@app.post("/api/answer")
def post_answer(payload: AnswerPayload):
    with get_conn() as conn:
        attempts = _all_attempts(conn)
        if _todays_attempt(attempts) and not payload.practice:
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

        else:  # mcq / fill-in-blank / drag-and-drop / dropdown-order
            correct = _grade_non_coding(q, payload.user_answer)
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
        conn.execute(
            "UPDATE questions SET last_seen_at = ? WHERE id = ?", (now, payload.question_id)
        )

        return {
            "correct": correct,
            "explanation": explanation,
            "correct_answer": correct_answer_out,
            "llm_feedback": llm_feedback,
        }


# ── POST /api/reset ──────────────────────────────────────────────────────────

class ResetPayload(BaseModel):
    confirm: bool = False


@app.post("/api/reset")
def reset_progress(payload: ResetPayload):
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="Confirmation required")
    with get_conn() as conn:
        conn.execute("DELETE FROM attempts")
        conn.execute("UPDATE questions SET last_seen_at = NULL")
    return {"reset": True}


# ── Blitz mode ───────────────────────────────────────────────────────────────
#
# Blitz is a 60-second timed run through as many questions as you can answer.
# It's intentionally isolated from QOTD: it never touches `attempts` (so it
# can't affect the daily lock, streak, or topic/difficulty stats) and never
# marks `questions.last_seen_at` (so it can't disturb the QOTD recycling
# queue). Instead, the client tracks which question ids it has already seen
# during the current run and passes them as `exclude` so a fast player
# doesn't immediately get repeats; once a small pool is exhausted mid-run,
# repeats are allowed rather than erroring out. Coding questions are excluded
# since LLM grading latency would eat into the timer.

@app.get("/api/blitz/question")
def get_blitz_question(
    difficulty: str = "random", topic: str = "Random", qtype: str = "Random", exclude: str = ""
):
    difficulty = difficulty.lower()
    if difficulty not in DIFFICULTIES + ["random"]:
        raise HTTPException(status_code=400, detail="Invalid difficulty")
    if qtype != "Random" and qtype not in QUESTION_TYPES_BLITZ:
        raise HTTPException(status_code=400, detail="Invalid question type")

    exclude_ids = [int(x) for x in exclude.split(",") if x.strip().isdigit()]

    with get_conn() as conn:
        resolved_topic = _resolve_topic(topic, _all_attempts(conn))

        pool_query = "SELECT id FROM questions WHERE type != 'coding'"
        pool_params: list = []
        if difficulty != "random":
            pool_query += " AND difficulty = ?"
            pool_params.append(difficulty)
        if resolved_topic:
            pool_query += " AND topic = ?"
            pool_params.append(resolved_topic)
        if qtype != "Random":
            pool_query += " AND type = ?"
            pool_params.append(qtype)

        def pick(ids_to_exclude):
            query = f"SELECT * FROM questions WHERE id IN ({pool_query})"
            params = list(pool_params)
            if ids_to_exclude:
                query += f" AND id NOT IN ({','.join('?' * len(ids_to_exclude))})"
                params += ids_to_exclude
            query += " ORDER BY RANDOM() LIMIT 1"
            return conn.execute(query, params).fetchone()

        row = pick(exclude_ids) or pick([])
        if not row:
            raise HTTPException(
                status_code=404,
                detail="No questions available for that combination — try different filters",
            )

        return _serialize_question(dict(row))


class BlitzCheckPayload(BaseModel):
    question_id: int
    user_answer: str


@app.post("/api/blitz/check")
def post_blitz_check(payload: BlitzCheckPayload):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM questions WHERE id = ?", (payload.question_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Question not found")
        q = dict(row)
        if q["type"] == "coding":
            raise HTTPException(status_code=400, detail="Coding questions aren't available in Blitz mode")

        correct = _grade_non_coding(q, payload.user_answer)
        return {
            "correct": correct,
            "correct_answer": _display_correct_answer(q),
            "explanation": _explanation_for(q, correct, payload.user_answer),
        }


class BlitzFinishPayload(BaseModel):
    difficulty: str
    topic: str
    qtype: str
    score: int
    total: int


@app.post("/api/blitz/finish")
def post_blitz_finish(payload: BlitzFinishPayload):
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO blitz_runs (timestamp, difficulty, topic, type, score, total)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (now, payload.difficulty, payload.topic, payload.qtype, payload.score, payload.total),
        )
        best = conn.execute("SELECT MAX(score) AS best FROM blitz_runs").fetchone()["best"]
    return {"best_score": best, "is_new_best": payload.score == best}
