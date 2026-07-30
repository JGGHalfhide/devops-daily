import json
from db import get_conn, init_db
from content.python_easy import PYTHON_EASY_QUESTIONS
from content.python_medium import PYTHON_MEDIUM_QUESTIONS
from content.python_hard import PYTHON_HARD_QUESTIONS
from content.terraform_easy import TERRAFORM_EASY_QUESTIONS
from content.terraform_medium import TERRAFORM_MEDIUM_QUESTIONS
from content.terraform_hard import TERRAFORM_HARD_QUESTIONS
from content.bash_easy import BASH_EASY_QUESTIONS
from content.bash_medium import BASH_MEDIUM_QUESTIONS
from content.bash_hard import BASH_HARD_QUESTIONS
from content.aws_easy import AWS_EASY_QUESTIONS
from content.aws_medium import AWS_MEDIUM_QUESTIONS
from content.aws_hard import AWS_HARD_QUESTIONS

QUESTIONS = (
    PYTHON_EASY_QUESTIONS + PYTHON_MEDIUM_QUESTIONS + PYTHON_HARD_QUESTIONS
    + TERRAFORM_EASY_QUESTIONS + TERRAFORM_MEDIUM_QUESTIONS + TERRAFORM_HARD_QUESTIONS
    + BASH_EASY_QUESTIONS + BASH_MEDIUM_QUESTIONS + BASH_HARD_QUESTIONS
    + AWS_EASY_QUESTIONS + AWS_MEDIUM_QUESTIONS + AWS_HARD_QUESTIONS
)


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
