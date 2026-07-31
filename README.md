# DevOps Daily

A small FastAPI web app for daily DevOps practice: one question a day
(or unlimited, in practice mode) across topics like Python, Bash, AWS,
Ansible, Kubernetes, Linux, Networking, and Terraform, with per-topic
and per-difficulty stats and a day-streak tracker.

## Setup

**Dependencies** (see `requirements.txt`):

- `fastapi`, `uvicorn` — web server
- `jinja2` — templating
- `anthropic` — LLM grading of free-form coding answers
- `python-dotenv` — loads `.env`

Install into the project's venv:

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**Environment variables** — create a `.env` file in the repo root:

```
ANTHROPIC_API_KEY=sk-...
```

This is required for grading `coding`-type questions — free-form
answers that exist across most topics (Bash, Python, Terraform, AWS,
Ansible, Linux, Kubernetes, Networking), not just Bash/Python.
`main.py` calls the Anthropic API via `anthropic.Anthropic()` with
model `claude-haiku-4-5` to judge these. All other question types
(mcq, fill-in-blank, drag-and-drop, dropdown-order) are graded locally
without an API call.

**Database**: SQLite, path controlled by the `DB_PATH` env var
(defaults to `devops_daily.db` in the repo root — see `db.py`). The
schema is created automatically on startup.

**Run locally**:

```bash
source venv/bin/activate
uvicorn main:app --reload
```

Then open `http://127.0.0.1:8000`.

**Seed the question bank** (only needed once, or after adding new
content — `seed.py` skips questions it's already inserted):

```bash
python seed.py
```

## Usage

### Daily question flow

On load, the app checks whether you've already answered today (EST).
If not, you're taken through a three-step selection screen:

1. **Difficulty** — Easy / Medium / Hard / Random
2. **Topic** — a specific topic, Random (any topic), or Weakest
   (your lowest-scoring topic — only offered once you have 10+ total
   attempts)
3. **Question type** — mcq, fill-in-blank, drag-and-drop,
   dropdown-order, coding, or Random (any type available for the
   difficulty/topic already chosen)

Answering submits to `/api/answer`, records the attempt, and shows the
correct answer plus an explanation (or LLM feedback, for coding
questions).

### Lock / countdown

Once you've answered, the app locks further questions until the next
calendar day in US Eastern time and shows a live countdown to the
reset. This is derived entirely from the `attempts` table (see
`_todays_attempt` / `_seconds_until_midnight_est` in `main.py`) — there's
no separate "answered today" flag.

### Practice mode

A "Practice Mode" toggle in the header bypasses the daily lock so you
can answer back-to-back without waiting — each answer still gets
recorded normally in `attempts`, so stats and streak logic reflect
practice attempts too.

### Reset progress

The stats panel has a "Reset progress…" control (two-step confirm)
that wipes all rows from `attempts`, returning the app to a first-run
state. It never touches the `questions` table.

## Question bank

Questions are pre-written, not generated at runtime. They live as
Python literals in `content/<topic>_<difficulty>.py` (e.g.
`content/python_easy.py`), each tagged with `topic`, `difficulty`, and
`type`. `seed.py` imports all of these batches and inserts any that
aren't already present in the `questions` table (dedup key: topic +
difficulty + type + prompt), so it's safe to re-run after adding new
content files.

## Schema

**`questions`** — the content bank: `topic`, `difficulty`, `type`,
`prompt`, `options` (JSON, for mcq/drag-and-drop/dropdown-order),
`correct_answer`, `explanation_correct`, `explanation_incorrect`.

**`attempts`** — one row per answered question: `question_id` (FK →
`questions`), `timestamp`, `topic`, `difficulty`, `type`,
`user_answer`, `correct`, `llm_feedback` (coding questions only). All
stats, streaks, and the daily lock are computed live from this table —
see `db.py` for the full `CREATE TABLE` statements.

## License

MIT.
