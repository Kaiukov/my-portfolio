# cli
- Use `cmux` for split-pane terminal management with Claude Code agents. Confidence: 0.85
- Use `cmd` (Command Code CLI) to delegate tasks to worker agents in cmux split panes. Confidence: 0.80
- Use `--model deepseek-v4-pro` for intelligent/reasoning tasks and `--model deepseek-v4-flash` for dirty/mechanical tasks. Confidence: 0.85
- Act as orchestrator: monitor agents via cmux, steer them, and close idle agents. Do not use `bash sleep` for delays, use monitoring notifications. Confidence: 0.85
- Use `uv run` prefix for all Python, pytest, and ruff commands. Confidence: 0.70

# security
- Never print passwords, DSN credentials, or connection strings in command output. Confidence: 0.80

# debugging
- When aggregate values diverge but all visible sub-fields match, investigate category-level transactions (EXCHANGE, TRANSFER) that affect the aggregate without appearing in the main sub-field breakdowns. Confidence: 0.70

# testing
- When no live PostgreSQL DB is available, skip DB tests with `-k 'not (postgres or db or database or supabase)'`. Confidence: 0.70

# git
- Make one commit per fix/blocker with descriptive commit messages. Confidence: 0.70
