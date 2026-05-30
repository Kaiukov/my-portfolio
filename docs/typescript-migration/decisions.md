# Decision Log

## Decision: Replace Python with TypeScript/Bun

Status: Accepted

Context:
- Python CLI is stable but has growing maintenance overhead.
- Team is more productive in TypeScript.
- Python dependency chain (uv, hatchling, psycopg) adds complexity vs Bun's single binary.

Decision:
- Python will be fully replaced by TypeScript/Bun over time.
- The process is phased, not a big-bang rewrite.
- PostgreSQL stays as the financial source of truth throughout.

Consequences:
- Positive: Simplified runtime, single-language stack, faster iteration.
- Positive: Bun's built-in test runner, package manager, and TypeScript support reduce tooling surface.
- Neutral: Existing Python code must be maintained until cutover.
- Negative: Team must maintain two runtimes during transition.

---

## Decision: PostgreSQL Remains the Financial Source of Truth

Status: Accepted

Context:
- PostgreSQL already owns key financial calculations via SQL functions and views.
- SQL functions are tested and proven correct.
- Porting them to TypeScript would duplicate logic and risk introducing bugs.

Decision:
- PostgreSQL functions, views, and persisted state are the single source of truth.
- TypeScript issues SQL queries and calls existing functions; it does not reimplement financial calculations.
- If logic lives only in Python and is needed in TypeScript, the default path is to push it into PostgreSQL SQL, not to port it to TypeScript.

Consequences:
- Positive: No risk of calculation drift between implementations.
- Positive: PostgreSQL can still be queried directly by other tools (API, dashboard, etc.).
- Negative: Some calculations must stay in SQL, which may be less familiar to TypeScript developers.
- Negative: Adding logic to PostgreSQL requires migration scripts and careful review.

---

## Decision: Phase 1 Starts with Read-Only CLI Commands Only

Status: Accepted

Context:
- Read-only commands are lower risk — they do not mutate state.
- They provide immediate value by proving the TypeScript → PostgreSQL connection works.
- They establish the test infrastructure and JSON parity verification framework.

Decision:
- Phase 1 implements only `status` and `transactions`.
- Write commands (add, edit, delete, exchange) are Phase 2.

Consequences:
- Positive: Faster time to first working TypeScript command.
- Positive: Write path design benefits from lessons learned in read-only phase.
- Neutral: Write commands ship later, but the Python CLI remains operational.

---

## Decision: No API/MCP/Dashboard/Widget/S3 Backup in This Migration

Status: Accepted

Context:
- Each of these targets has different requirements, stakeholders, and risk profiles.
- Building them alongside the migration adds scope and delays completion.
- The migration goal is a like-for-like platform replacement, not an expansion.

Decision:
- API, MCP server, dashboard, iOS widget, and S3/object-storage backup are out of scope.
- See [out-of-scope.md](out-of-scope.md) for the full list.

Consequences:
- Positive: Focused scope, faster migration.
- Positive: New targets can be built on top of the TypeScript CLI afterward.
- Neutral: External consumers of the CLI (if any) continue through the Python CLI until cutover.

---

## Decision: No ORM for the First Migration Phase

Status: Accepted

Context:
- The existing Python codebase uses raw SQL via psycopg.
- An ORM would add a new abstraction layer, learning curve, and potential for generating inefficient queries.
- TypeScript ORMs for PostgreSQL (Prisma, Drizzle) are evolving rapidly; choosing one now risks future regret.

Decision:
- No ORM in Phase 1 or Phase 2.
- Use `Bun.sql` or a thin PostgreSQL client with raw SQL queries.
- Future phases can revisit if the pattern of raw queries becomes painful.

Consequences:
- Positive: Direct control over SQL, zero ORM overhead.
- Positive: SQL queries are directly portable from Python psycopg calls.
- Negative: No migration tooling, schema validation, or type-safe query building.
- Negative: More boilerplate for complex queries.

---

## Decision: Python Remains as Parity Reference Until TypeScript Matches Behavior

Status: Accepted

Context:
- The Python CLI is the definition of correct behavior for all commands.
- Removing Python before TypeScript reaches full parity would leave users without a fallback.

Decision:
- Python stays in the repository as a parity reference until Phase 5.
- CI runs both implementations and compares JSON output for migrated commands.
- `portfolio-py` entry point is maintained for manual verification.

Consequences:
- Positive: Safety net during migration — TypeScript can be validated against Python at any time.
- Positive: Users experience no disruption — `portfolio` keeps working.
- Negative: Two runtimes to maintain, two sets of dependencies.
- Negative: CI time increases due to dual execution.
