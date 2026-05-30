# Stack

## Runtime & Language

- **Bun** — JavaScript/TypeScript runtime, package manager, test runner
- **TypeScript** — strict mode enabled, target `ESNext`
- **Bun-only** — Bun is the only supported runtime for this migration

## Testing & Type Checking

- **Bun test** (`bun test`) — test runner
- **TypeScript compiler** (`tsc --noEmit`) — type checking only (no emit)
- **No Jest, Vitest, or other test framework** — Bun's built-in test runner is sufficient

## Database

- **Bun SQL** (`Bun.sql`) or a thin PostgreSQL client (e.g., `postgres.js`)
- **No ORM** — raw SQL queries wrapped in typed functions
- Connection string from `PORTFOLIO_DB_URL` environment variable

## What We Are Not Using

- No web framework (Express, Hono, Elysia, etc.)
- No monorepo tooling (turbo, nx, etc.)
- No code generation
- No dependency injection containers

## Folder Structure

```
portfolio-ts/
  src/
    cli.ts              # Entry point, argument parsing
    db.ts               # PostgreSQL connection, query helpers
    response.ts         # JSON envelope, error formatting
    commands/
      status.ts         # portfolio-ts status implementation
      transactions.ts   # portfolio-ts transactions implementation
  tests/
    status.test.ts      # JSON parity tests for status
    transactions.test.ts # JSON parity tests for transactions
  package.json
  tsconfig.json
```

As more commands are added, they follow the same pattern: a file per command in `src/commands/`, a corresponding test in `tests/`.

## Conventions

- No classes — prefer typed functions and plain objects.
- No barrel files — import directly from the module.
- SQL queries live in `db.ts` or in the command file if they are specific to one command.
- JSON envelope follows the same contract as the Python CLI: `{"ok": true, "command": "...", "data": ..., "meta": {...}}`.
