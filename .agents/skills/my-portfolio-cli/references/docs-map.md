# Docs Map

Canonical project docs live in:

- `/Users/oleksandrkaiukov/Code/my-portfolio/.agents/skills/my-portfolio-cli/references/architecture.md`
- `/Users/oleksandrkaiukov/Code/my-portfolio/.agents/skills/my-portfolio-cli/references/api-contract.md`
- `/Users/oleksandrkaiukov/Code/my-portfolio/.agents/skills/my-portfolio-cli/references/data-integrity.md`
- `/Users/oleksandrkaiukov/Code/my-portfolio/.agents/skills/my-portfolio-cli/references/operations.md`
- `/Users/oleksandrkaiukov/Code/my-portfolio/.agents/skills/my-portfolio-cli/references/cli-commands.md`
- `/Users/oleksandrkaiukov/Code/my-portfolio/.agents/skills/my-portfolio-cli/references/production-roadmap.md`

Use this map:

- Domain model, valuation semantics, and reporting invariants:
  Read `architecture.md`
- API and JSON contract changes:
  Read `api-contract.md`
- Price validation, cached coverage, repair flows, and refresh state:
  Read `data-integrity.md`
- Operator workflows and runbooks:
  Read `operations.md`
- Public CLI command names and usage expectations:
  Read `cli-commands.md`
- Production hardening, backlog, or roadmap work:
  Read `production-roadmap.md`

Canonical code paths:

- CLI entrypoints:
  `/Users/oleksandrkaiukov/Code/my-portfolio/portfolio_db/cli.py`
- Service/reporting logic:
  `/Users/oleksandrkaiukov/Code/my-portfolio/portfolio_db/portfolio_service.py`
- DB access and price cache:
  `/Users/oleksandrkaiukov/Code/my-portfolio/portfolio_db/database.py`
- Daily return calculator:
  `/Users/oleksandrkaiukov/Code/my-portfolio/portfolio_db/calculator.py`

Legacy planning notes still exist in `/Users/oleksandrkaiukov/Code/my-portfolio/docs/`, but the skill `references/` directory is the source of truth for agent guidance.
