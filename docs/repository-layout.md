# Repository layout

## Source-controlled (committed)

| Path | Purpose |
|------|---------|
| `portfolio-ts/` | Active TypeScript/Bun application and CLI (runtime). Source in `src/`, tests in `tests/`, config via `.env`. |
| `portfolio_db/sql/` | Financial source of truth — PostgreSQL schema, functions, procedures, views, triggers. **Do not edit casually.** |
| `portfolio-plugin/` | **Canonical** Claude Code plugin in `.claude-plugin/` format. Contains agent skills for setup, deploy, add-transaction, status, dashboard, and develop (navigation guide). |
| `portfolio-dashboard/` | Single-file dashboard served by a Cloudflare Worker. |
| `docs/` | Documentation — wiki, transaction spec, platform adapters, API response plan, migration notes, and this layout doc. |
| `AGENTS.md` | Top-level agent instructions: architecture, invariants, command classification. |
| `CLAUDE.md` | Agent instructions loaded by Claude Code. |
| `scripts/` | Helper scripts for deployment, monitoring, CI. |
| `bin/` | Standalone executables and shell wrappers. |
| `examples/` | Sample configs, usage patterns, reference files. |

## Generated / local-only (gitignored, never committed)

`node_modules/`, `.venv/`, `venv/`, `env/`, `__pycache__/`, `*.py[cod]`,
`.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `.coverage*`, `htmlcov/`,
`*.egg-info/`, `dist/`, `build/`, `*.db`, `*.sqlite`, `*.log`, `logs/`,
`.env*` (except `.env.example`), `.wrangler/`, `dashboard-preview/`,
`.vscode/`, `.idea/`, `data/cache/`, `.portfolio_cache/`, `reports/`,
`session-ses_*.md`,
`.opencode/`, `scripts/.claude/`, root `.claude-plugin/`.

## Ownership rule

There is exactly **one canonical agent home**: `portfolio-plugin/`. Local runtime
and orchestration state (`.opencode/`, `scripts/.claude/`, root `.claude-plugin/`)
stay in `.gitignore` and are never committed.
