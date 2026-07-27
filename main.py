import json
import random
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from db import get_conn, init_db

app = FastAPI()

EST = timezone(timedelta(hours=-5))


@app.on_event("startup")
def startup():
    init_db()


def _today_est() -> str:
    return datetime.now(EST).strftime("%Y-%m-%d")


# ── GET /api/today ─────────────────────────────────────────────────────────────

@app.get("/api/today")
def get_today():
    today = _today_est()

    with get_conn() as conn:
        # Check if already answered today
        row = conn.execute(
            "SELECT * FROM attempts WHERE DATE(timestamp) = ? LIMIT 1",
            (today,),
        ).fetchone()

        if row:
            q = conn.execute(
                "SELECT id, topic, difficulty, type, prompt FROM questions WHERE id = ?",
                (row["question_id"],),
            ).fetchone()
            return {
                "answered": True,
                "question_id": row["question_id"],
                "topic": q["topic"] if q else None,
                "correct": bool(row["correct"]),
            }

        # Pick a random unanswered question
        answered_ids = [
            r["question_id"]
            for r in conn.execute("SELECT DISTINCT question_id FROM attempts").fetchall()
        ]

        if answered_ids:
            placeholders = ",".join("?" * len(answered_ids))
            row = conn.execute(
                f"SELECT * FROM questions WHERE id NOT IN ({placeholders}) ORDER BY RANDOM() LIMIT 1",
                answered_ids,
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM questions ORDER BY RANDOM() LIMIT 1"
            ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="No questions available")

        question = dict(row)
        if question.get("options"):
            question["options"] = json.loads(question["options"])

        # Don't leak the answer
        question.pop("correct_answer", None)
        question.pop("explanation_correct", None)
        question.pop("explanation_incorrect", None)

        return {"answered": False, "question": question}


# ── POST /api/answer ───────────────────────────────────────────────────────────

class AnswerPayload(BaseModel):
    question_id: int
    user_answer: str


@app.post("/api/answer")
def post_answer(payload: AnswerPayload):
    today = _today_est()

    with get_conn() as conn:
        already = conn.execute(
            "SELECT id FROM attempts WHERE question_id = ? AND DATE(timestamp) = ?",
            (payload.question_id, today),
        ).fetchone()
        if already:
            raise HTTPException(status_code=409, detail="Already answered today")

        q = conn.execute(
            "SELECT * FROM questions WHERE id = ?", (payload.question_id,)
        ).fetchone()
        if not q:
            raise HTTPException(status_code=404, detail="Question not found")

        correct = payload.user_answer.strip().lower() == q["correct_answer"].strip().lower()
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
                None,
            ),
        )

        return {
            "correct": correct,
            "explanation": q["explanation_correct"] if correct else q["explanation_incorrect"],
            "correct_answer": q["correct_answer"],
        }
