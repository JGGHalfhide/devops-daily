import sqlite3
import os

DB_PATH = os.environ.get("DB_PATH", "devops_daily.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS questions (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                topic                TEXT    NOT NULL,
                difficulty           TEXT    NOT NULL,
                type                 TEXT    NOT NULL,
                prompt               TEXT    NOT NULL,
                options              TEXT,
                correct_answer       TEXT    NOT NULL,
                explanation_correct  TEXT    NOT NULL,
                explanation_incorrect TEXT   NOT NULL
            );

            CREATE TABLE IF NOT EXISTS attempts (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                question_id  INTEGER NOT NULL REFERENCES questions(id),
                timestamp    TEXT    NOT NULL,
                topic        TEXT    NOT NULL,
                difficulty   TEXT    NOT NULL,
                type         TEXT    NOT NULL,
                user_answer  TEXT    NOT NULL,
                correct      INTEGER NOT NULL,
                llm_feedback TEXT
            );

            CREATE TABLE IF NOT EXISTS blitz_runs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp  TEXT    NOT NULL,
                difficulty TEXT    NOT NULL,
                topic      TEXT    NOT NULL,
                type       TEXT    NOT NULL,
                score      INTEGER NOT NULL,
                total      INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS take5_runs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp  TEXT    NOT NULL,
                difficulty TEXT    NOT NULL,
                topic      TEXT    NOT NULL,
                type       TEXT    NOT NULL,
                score      INTEGER NOT NULL,
                total      INTEGER NOT NULL
            );
        """)

        columns = {row["name"] for row in conn.execute("PRAGMA table_info(questions)").fetchall()}
        if "last_seen_at" not in columns:
            conn.execute("ALTER TABLE questions ADD COLUMN last_seen_at TEXT")
