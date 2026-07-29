import json
from db import get_conn, init_db
from content.python_easy import PYTHON_EASY_QUESTIONS
from content.python_medium import PYTHON_MEDIUM_QUESTIONS
from content.python_hard import PYTHON_HARD_QUESTIONS

QUESTIONS = PYTHON_EASY_QUESTIONS + PYTHON_MEDIUM_QUESTIONS + PYTHON_HARD_QUESTIONS


def seed():
    init_db()
    with get_conn() as conn:
        existing = {
            (r["topic"], r["difficulty"], r["type"], r["prompt"])
            for r in conn.execute("SELECT topic, difficulty, type, prompt FROM questions").fetchall()
        }

        inserted = 0
        for q in QUESTIONS:
            if (q["topic"], q["difficulty"], q["type"], q["prompt"]) in existing:
                continue

            explanation_incorrect = q["explanation_incorrect"]
            if isinstance(explanation_incorrect, dict):
                explanation_incorrect = json.dumps(explanation_incorrect)

            conn.execute(
                """INSERT INTO questions
                   (topic, difficulty, type, prompt, options, correct_answer,
                    explanation_correct, explanation_incorrect)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    q["topic"],
                    q["difficulty"],
                    q["type"],
                    q["prompt"],
                    json.dumps(q["options"]) if q["options"] else None,
                    q["correct_answer"],
                    q["explanation_correct"],
                    explanation_incorrect,
                ),
            )
            inserted += 1
        print(f"Inserted {inserted} new question(s); {len(QUESTIONS) - inserted} already present.")


if __name__ == "__main__":
    seed()
