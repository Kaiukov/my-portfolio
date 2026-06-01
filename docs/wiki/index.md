# Wiki Library

> Project is mid-migration from Python to TypeScript/Bun. TypeScript is the target runtime, and the app runs via Docker.

Live deploys, KV writes, and DB migrations are orchestrator-only; delegated agents work on mocks.

## Wiki Pages

- [Index](index.md) - master map for the wiki library.
- [Getting Started](getting-started.md) - setup, database configuration, and the first CLI run.
- [CLI Reference](cli-reference.md) - command surface, flags, JSON envelopes, and date rules.
- [Transactions](transactions.md) - supported actions and validation.
- [Performance Metrics](performance-metrics.md) - TWR, MWR, risk, and benchmark metric definitions.
- [Architecture](architecture.md) - three-layer design and data flow.
- [Schema](schema.md) - database tables, columns, and service state.
- [Recalculation](recalculation.md) - how mutations trigger daily return recomputation.
- [Prices](prices.md) - price cache, verification, and repair behavior.
- [Exchange and Cash](exchange-and-cash.md) - currency exchange and cash alias normalization.
- [Environments](environments.md) - dev vs prod runtime, deployment, and storage boundaries.

## Migration

- [TypeScript/Bun Migration](../typescript-migration/README.md) - migration plan and target-runtime notes.

## Audit

- [Financial Correctness Audit](../audit/2026-05-31-financial-correctness.md) - 2026-05-31 audit record for financial correctness.

## Core Specs

- [Transaction Specification](../transaction-spec.md) - action semantics, validation, and recalc behavior.
- [Crontab Schedule](../crontab-schedule.md) - OS-cron and refresh scheduling.
- [pg_cron](../pg-cron.md) - SQL-only scheduled jobs inside PostgreSQL.
- [API Response Standardization Plan](../api-response-standardization-plan.md) - JSON envelope and pagination plan.
- [Platform Adapters](../platform-adapters.md) - adapter surface and shared contract notes.
- [Widget Contract](../widget-contract.md) - read-only widget JSON shape.
- [Production Ready Plan](../production-ready-plan.md) - readiness checklist and completed scope.
