# Production Roadmap

Canonical source:

- `/Users/oleksandrkaiukov/Code/my-portfolio/.agents/skills/my-portfolio-cli/references/production-roadmap.md`

This roadmap tracks production hardening in the skill package.

## Step 1. Product Baseline

Status: completed in the skill docs.

Deliverables:

- `architecture.md`
- `api-contract.md`
- `operations.md`

Baseline scope:

- freeze supported transaction semantics
- freeze reporting `as_of_date` rules
- freeze DuckDB cached prices as read-path source of truth
- freeze TWR as the primary return metric

## Next Priorities

- Step 2: data integrity and deterministic valuation failures
- Status: documented and partially implemented
- Step 3: transaction engine normalization and validation
- Step 4: reporting consistency and shared snapshot adoption everywhere
- Step 5+: CLI polish, tests, packaging, observability, and safety
