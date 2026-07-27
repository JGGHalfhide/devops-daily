import json
from db import get_conn, init_db

QUESTIONS = [
    # ── Python ────────────────────────────────────────────────────────────────
    {
        "topic": "Python",
        "difficulty": "easy",
        "type": "mcq",
        "prompt": "Which built-in Python function returns the number of items in a list?",
        "options": ["count()", "size()", "len()", "length()"],
        "correct_answer": "len()",
        "explanation_correct": "len() is the standard built-in for measuring sequence length.",
        "explanation_incorrect": "count() counts occurrences of a value; size() and length() don't exist as built-ins.",
    },
    {
        "topic": "Python",
        "difficulty": "medium",
        "type": "fill-in-blank",
        "prompt": "Complete the list comprehension that squares every even number from 0 to 9:\n  result = [x**2 for x in range(10) if x _____ 2 == 0]",
        "options": None,
        "correct_answer": "%",
        "explanation_correct": "The modulo operator % gives the remainder; x % 2 == 0 is True for even numbers.",
        "explanation_incorrect": "The correct operator is % (modulo). // is floor division; & is bitwise AND.",
    },
    # ── Bash ──────────────────────────────────────────────────────────────────
    {
        "topic": "Bash",
        "difficulty": "easy",
        "type": "mcq",
        "prompt": "Which command shows the last 20 lines of a file called app.log?",
        "options": ["head -20 app.log", "tail -20 app.log", "tail -n +20 app.log", "cat -20 app.log"],
        "correct_answer": "tail -20 app.log",
        "explanation_correct": "tail -N prints the last N lines. -20 is shorthand for -n 20.",
        "explanation_incorrect": "head shows the first lines. tail -n +20 shows FROM line 20 to EOF. cat has no line-count flag.",
    },
    # ── Kubernetes ────────────────────────────────────────────────────────────
    {
        "topic": "Kubernetes",
        "difficulty": "medium",
        "type": "fill-in-blank",
        "prompt": "To scale a Deployment named 'api' to 5 replicas, you run:\n  kubectl _____ deployment api --replicas=5",
        "options": None,
        "correct_answer": "scale",
        "explanation_correct": "kubectl scale adjusts the replica count of a Deployment, ReplicaSet, or StatefulSet.",
        "explanation_incorrect": "The correct subcommand is 'scale'. 'resize' and 'update' are not valid kubectl subcommands for this purpose.",
    },
    # ── Linux ─────────────────────────────────────────────────────────────────
    {
        "topic": "Linux",
        "difficulty": "easy",
        "type": "mcq",
        "prompt": "Which signal does `kill -9 <pid>` send to a process?",
        "options": ["SIGTERM", "SIGHUP", "SIGKILL", "SIGINT"],
        "correct_answer": "SIGKILL",
        "explanation_correct": "Signal 9 is SIGKILL — it forcefully terminates the process immediately and cannot be caught or ignored.",
        "explanation_incorrect": "SIGTERM (15) requests graceful shutdown. SIGHUP (1) reloads config. SIGINT (2) is Ctrl-C.",
    },
]


def seed():
    init_db()
    with get_conn() as conn:
        existing = conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
        if existing:
            print(f"Already seeded ({existing} questions). Skipping.")
            return

        for q in QUESTIONS:
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
                    q["explanation_incorrect"],
                ),
            )
        print(f"Inserted {len(QUESTIONS)} questions.")


if __name__ == "__main__":
    seed()
