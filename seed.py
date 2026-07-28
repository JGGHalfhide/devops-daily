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
        "explanation_incorrect": {
            "count()": "count() counts occurrences of a specific value within a sequence, not the sequence's length.",
            "size()": "size() is not a built-in Python function (it's a NumPy/pandas method).",
            "length()": "Python has no built-in length() function — len() is the correct name.",
        },
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
    {
        "topic": "Python",
        "difficulty": "hard",
        "type": "coding",
        "prompt": (
            "Write a Python function `is_palindrome(s)` that returns True if the string `s` "
            "is a palindrome, ignoring case and any non-alphanumeric characters (e.g. "
            "\"A man, a plan, a canal: Panama\" should return True)."
        ),
        "options": None,
        "correct_answer": (
            "def is_palindrome(s):\n"
            "    cleaned = [c.lower() for c in s if c.isalnum()]\n"
            "    return cleaned == cleaned[::-1]"
        ),
        "explanation_correct": (
            "Filter to alphanumeric characters, normalize case, and compare the result to its "
            "reverse. Using a two-pointer walk from both ends is equally valid."
        ),
        "explanation_incorrect": (
            "A correct solution must strip non-alphanumeric characters and ignore case before "
            "comparing the string to its reverse."
        ),
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
        "explanation_incorrect": {
            "head -20 app.log": "head shows the first N lines of a file, not the last.",
            "tail -n +20 app.log": "The +N form of tail -n means 'start at line N and print to EOF', not 'last N lines'.",
            "cat -20 app.log": "cat has no line-count flag; it simply prints the whole file.",
        },
    },
    {
        "topic": "Bash",
        "difficulty": "hard",
        "type": "coding",
        "prompt": (
            "Write a bash command (or short script) that counts the number of files with a "
            ".log extension in the current directory, not including subdirectories."
        ),
        "options": None,
        "correct_answer": 'find . -maxdepth 1 -type f -name "*.log" | wc -l',
        "explanation_correct": (
            "find with -maxdepth 1 restricts the search to the current directory, -type f "
            "excludes directories, and wc -l counts the matching lines. `ls *.log | wc -l` is "
            "also acceptable, though it can misbehave with zero matches or filenames containing newlines."
        ),
        "explanation_incorrect": (
            "The command should scope to the current directory only (non-recursive), match the "
            ".log extension, and produce a count of matching files."
        ),
    },
    # ── AWS ───────────────────────────────────────────────────────────────────
    {
        "topic": "AWS",
        "difficulty": "easy",
        "type": "mcq",
        "prompt": "Which AWS service provides durable object storage accessed over HTTP(S)?",
        "options": ["EBS", "S3", "EFS", "RDS"],
        "correct_answer": "S3",
        "explanation_correct": "S3 (Simple Storage Service) is AWS's object storage, accessed via a REST/HTTP API.",
        "explanation_incorrect": {
            "EBS": "EBS is block storage attached to a single EC2 instance, not object storage.",
            "EFS": "EFS is a managed NFS file system, not object storage.",
            "RDS": "RDS is a managed relational database service, not a storage-object service.",
        },
    },
    {
        "topic": "AWS",
        "difficulty": "medium",
        "type": "fill-in-blank",
        "prompt": "Complete the AWS CLI command to upload a local file to S3:\n  aws s3 _____ ./report.csv s3://my-bucket/report.csv",
        "options": None,
        "correct_answer": "cp",
        "explanation_correct": "aws s3 cp copies files to/from S3, mirroring the local `cp` command.",
        "explanation_incorrect": "The correct subcommand is 'cp'. 'put' and 'upload' are not valid `aws s3` subcommands.",
    },
    # ── Ansible ───────────────────────────────────────────────────────────────
    {
        "topic": "Ansible",
        "difficulty": "medium",
        "type": "fill-in-blank",
        "prompt": "Complete the command to run a playbook against only hosts in the 'web' inventory group:\n  ansible-playbook site.yml --_____ web",
        "options": None,
        "correct_answer": "limit",
        "explanation_correct": "--limit restricts execution to a subset of the inventory, here the 'web' group.",
        "explanation_incorrect": "The correct flag is --limit. --hosts and --group are not valid ansible-playbook flags.",
    },
    {
        "topic": "Ansible",
        "difficulty": "easy",
        "type": "mcq",
        "prompt": "Which Ansible module is idempotent-safe for ensuring a package is installed on a Debian/Ubuntu host?",
        "options": ["apt", "shell", "command", "raw"],
        "correct_answer": "apt",
        "explanation_correct": "The apt module manages package state declaratively and is idempotent — re-running it is a no-op if the package is already installed.",
        "explanation_incorrect": {
            "shell": "shell just runs an arbitrary shell command; it has no built-in concept of package state and isn't idempotent by default.",
            "command": "command runs a single command without a shell, same idempotency problem as shell.",
            "raw": "raw bypasses Ansible's module system entirely and is meant for hosts without Python installed.",
        },
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
        "explanation_incorrect": {
            "SIGTERM": "SIGTERM (15) requests graceful shutdown and can be caught/ignored by the process.",
            "SIGHUP": "SIGHUP (1) traditionally signals terminal disconnect or a reload request.",
            "SIGINT": "SIGINT (2) is sent by Ctrl-C and can be caught by the process.",
        },
    },
    {
        "topic": "Linux",
        "difficulty": "medium",
        "type": "drag-and-drop",
        "prompt": "Arrange the stages of a typical Linux boot process in the order they occur.",
        "options": ["Kernel initialization", "BIOS/UEFI firmware", "init/systemd", "Bootloader (e.g. GRUB)", "Login prompt"],
        "correct_answer": json.dumps(
            ["BIOS/UEFI firmware", "Bootloader (e.g. GRUB)", "Kernel initialization", "init/systemd", "Login prompt"]
        ),
        "explanation_correct": (
            "Firmware (BIOS/UEFI) runs first and hands off to the bootloader, which loads the "
            "kernel; the kernel then starts init/systemd as PID 1, which brings the system to a "
            "login prompt."
        ),
        "explanation_incorrect": "Firmware must run before the bootloader, which must load the kernel before init/systemd starts, ending at the login prompt.",
    },
    # ── Networking ────────────────────────────────────────────────────────────
    {
        "topic": "Networking",
        "difficulty": "easy",
        "type": "mcq",
        "prompt": "Which protocol operates at OSI Layer 3 (Network layer)?",
        "options": ["TCP", "IP", "HTTP", "Ethernet"],
        "correct_answer": "IP",
        "explanation_correct": "IP handles logical addressing and routing between networks — Layer 3.",
        "explanation_incorrect": {
            "TCP": "TCP is a Layer 4 (Transport) protocol, responsible for reliable delivery between endpoints.",
            "HTTP": "HTTP is a Layer 7 (Application) protocol.",
            "Ethernet": "Ethernet operates at Layer 2 (Data Link), handling addressing within a local segment.",
        },
    },
    {
        "topic": "Networking",
        "difficulty": "medium",
        "type": "drag-and-drop",
        "prompt": "Arrange the steps of the TCP three-way handshake in the order they occur.",
        "options": ["ACK", "SYN-ACK", "SYN"],
        "correct_answer": json.dumps(["SYN", "SYN-ACK", "ACK"]),
        "explanation_correct": "The client sends SYN, the server replies SYN-ACK, and the client completes the handshake with ACK.",
        "explanation_incorrect": "The handshake always starts with the client's SYN, then the server's SYN-ACK, then the client's final ACK.",
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
        print(f"Inserted {len(QUESTIONS)} questions.")


if __name__ == "__main__":
    seed()
