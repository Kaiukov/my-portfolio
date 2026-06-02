# Out of Scope

These items were explicitly **not** part of the migration. They may be pursued now that the migration is complete.

## Systems

- **API server** — No REST, GraphQL, or any HTTP API. The CLI is the only interface.
- **MCP server** — No Model Context Protocol server. Not yet.
- **Dashboard** — No web UI, no front-end framework, no visual reporting.
- **iOS widget** — No mobile or widget targets.
- **S3/object-storage backup** — No cloud backup integration (e.g., S3, R2, GCS).

## Engineering

- **Full CLI migration in one PR** — Each phase ships independently. No single PR that migrates all commands.
- **ORM** — No Prisma, Drizzle, TypeORM, or any database abstraction layer in Phases 1–2. Raw SQL only.
- **Web framework** — No Express, Hono, Elysia, Fastify, or any HTTP framework.
- **Monorepo** — No turborepo, nx, pnpm workspaces, or multi-package structure. A single `portfolio-ts/` directory.

## Features

- **New financial features** — No new transaction types, metrics, reports, benchmarks, or asset classes. Ship what Python already ships.
- **TypeScript reimplementation of PostgreSQL-owned calculations** — Do not reimplement PostgreSQL-owned financial calculations in TypeScript. Call the existing functions and views.

## Process

- **Refactoring Python code** — No Python behavior refactor during the transition. Python code was only changed for compatibility shims, entrypoint rename (Phase 4), or parity-test wiring.
- **Parallel implementations** — Two full implementations were not maintained longer than necessary. Phase 5 removed Python as soon as TypeScript matched behavior.

## Questions for Future (After Migration)

- Should the API or MCP server share code with the CLI or be independent?
- Should a dashboard use the same PostgreSQL connection or have its own read replica?
- Should S3 backup be a CLI command or a separate scheduled process?
