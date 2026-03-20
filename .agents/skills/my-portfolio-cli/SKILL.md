---
name: my-portfolio-cli
description: Use when working on the `my-portfolio` project CLI, JSON response contract, portfolio reporting semantics, transaction actions, price repair flows, or operator workflows. Trigger this skill for tasks involving `portfolio_db/cli.py`, `portfolio_db/portfolio_service.py`, `portfolio_db/database.py`, `portfolio_db/calculator.py`, CLI command design, API response standardization, or production-readiness planning for the portfolio app.
---

# My Portfolio CLI

Use this skill when changing or reasoning about the `my-portfolio` app CLI and reporting model.

## Workflow

1. Read the canonical docs map in [references/docs-map.md](references/docs-map.md).
2. If the task is about valuation rules, transaction semantics, or reporting invariants, read [references/architecture.md](references/architecture.md).
3. If the task is about JSON response shapes, pagination, command payloads, or error envelopes, read [references/api-contract.md](references/api-contract.md).
4. If the task is about price validation, coverage, repair, or deterministic valuation failures, read [references/data-integrity.md](references/data-integrity.md).
5. If the task is about available commands or how to invoke them, read [references/cli-commands.md](references/cli-commands.md).
6. If the task is about roadmap or hardening the app for production, read [references/production-roadmap.md](references/production-roadmap.md).
7. Treat `/Users/oleksandrkaiukov/Code/my-portfolio/.agents/skills/my-portfolio-cli/` as the canonical documentation source. Update the relevant files in `references/` when behavior changes.

## Rules

- Keep CLI output pure JSON.
- Preserve the shared response envelope and existing machine-readable error structure.
- Prefer DuckDB cached prices as the read-path source of truth.
- Do not introduce silent fallback FX rates or hidden valuation approximations.
- Keep `status`, `cash`, `summary`, `allocation`, and `performance` aligned to one reporting snapshot and one `as_of_date`.
- When changing actions or accounting semantics, update both CLI-facing behavior and the underlying calculator/service logic.
- When changing commands, verify the Click command name matches the documented public name.

## Validation

- Run targeted compile checks for edited Python files.
- Run CLI smoke checks for affected commands.
- When changing accounting, reporting, or price-repair logic, run pytest using:
  `PYTHONPATH=/Users/oleksandrkaiukov/Code/my-portfolio /Users/oleksandrkaiukov/Code/.venv/bin/python -m pytest -q`
- Keep imports pinned to the local workspace package, not the sibling `/Users/oleksandrkaiukov/Code/portfolio_db`.
