# DevOps Daily

A small FastAPI web app for daily DevOps practice across topics like
Python, Bash, AWS, Ansible, Kubernetes, Linux, Networking, and
Terraform, with per-topic and per-difficulty stats and a day-streak
tracker. Two modes are available, switchable via tabs in the header:

- **QOTD** — one question a day (or unlimited, in practice mode)
- **Blitz** — answer as many questions as you can in 60 seconds

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

### QOTD vs. Blitz

The header tabs switch between the two modes. QOTD is the daily-lock
flow described below. Blitz is a standalone 60-second timed run
(see [Blitz mode](#blitz-mode)) — switching to it never touches the
QOTD daily lock, streak, or stats, and vice versa.

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

### Question recycling

Within a given difficulty/topic/type combination, questions are drawn
without repeats — each one is marked seen when you answer it and
excluded from that combination's pool going forward. Once every
question matching the combination you're currently using has been
seen, that specific pool is automatically reset (marked unseen again)
so it keeps cycling instead of running out. Recycling is tracked
per-question via `questions.last_seen_at`, separately from `attempts`,
so it doesn't affect stats or streak history.

### Blitz mode

Pick a difficulty, topic, and question type (same three-step selector
as QOTD, minus the daily lock), then hit **Start Blitz**. A 60-second
timer starts and questions are served one after another — each
answer is graded instantly and the next question loads immediately,
with no result screen in between. When the timer hits zero, you see
your score (count of correct answers) and whether it's a new
personal best.

Blitz is fully isolated from QOTD: answers are graded via
`/api/blitz/check` and never written to the `attempts` table, so they
never affect the daily lock, streak, or topic/difficulty stats. They
also don't mark `questions.last_seen_at`, so a Blitz run can't disturb
QOTD's recycling queue. Within a single run, the client tracks which
question ids it has already seen and excludes them from
`/api/blitz/question` so you don't immediately get repeats; if a
narrow filter combination's pool runs out mid-run, repeats are allowed
rather than ending the run early. Coding questions are excluded from
Blitz since LLM grading latency would eat into the 60 seconds.

Each run's score is recorded in the `blitz_runs` table, and your best
score ever (regardless of which filters you used) is shown as **Best
blitz score** in the stats panel and on the Blitz results screen.

### Reset progress

The stats panel has a "Reset progress…" control (two-step confirm)
that wipes all rows from `attempts` and clears every question's seen
state, returning the app to a first-run state. It never touches
question content (prompts, answers, explanations).

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
`correct_answer`, `explanation_correct`, `explanation_incorrect`, plus
`last_seen_at` (nullable timestamp used only for the recycling queue —
see [Question recycling](#question-recycling)).

**`attempts`** — one row per answered QOTD/practice question:
`question_id` (FK → `questions`), `timestamp`, `topic`, `difficulty`,
`type`, `user_answer`, `correct`, `llm_feedback` (coding questions
only). All QOTD stats, streaks, and the daily lock are computed live
from this table — see `db.py` for the full `CREATE TABLE` statements.
Blitz attempts are never inserted here (see [Blitz mode](#blitz-mode)).

**`blitz_runs`** — one row per completed Blitz run: `timestamp`,
`difficulty`, `topic`, `type` (the filters used), `score` (count of
correct answers), `total` (questions answered). `best_blitz_score` in
`/api/stats` is `MAX(score)` over this table.

## License

MIT.
