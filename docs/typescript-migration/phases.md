# Migration Phases

Six phases: Phase 0 (documentation) through Phase 5 (Python removal).

## Phase 0: Documentation

**Scope**  
Create the migration plan (this wiki). No code changes.

**Acceptance criteria**  
- All six documentation pages exist.
- Architecture, phases, stack, decisions, and out-of-scope are clear.
- Reviewed and agreed upon.

**Must not do**  
- Write any TypeScript or Python code.
- Create folder structures or config files.

---

## Phase 1: TypeScript Read-Only CLI Slice

**Scope**  
Implement `portfolio-ts status` and `portfolio-ts transactions` in TypeScript/Bun. Both commands read from PostgreSQL and emit the same JSON envelope as the existing Python CLI.

**Acceptance criteria**  
- `portfolio-ts status` output matches `portfolio status` (JSON-parity tested).
- `portfolio-ts transactions` output matches `portfolio transactions` (JSON-parity tested).
- No write path or network fetch is implemented.
- `portfolio-ts --help` works.
- JSON envelope matches `{"ok": true, "command": "...", "data": ..., "meta": {...}}`.

**Must not do**  
- Implement `add`, `edit`, `delete`, `exchange`, or any write command.
- Hit any external network endpoint.
- Modify the existing Python codebase.
- Introduce an ORM or web framework.
- Touch PostgreSQL functions, views, or schema.

---

## Phase 2: Write Commands

**Scope**  
Implement `portfolio-ts add`, `edit`, `delete`, `exchange` in TypeScript. These commands mutate PostgreSQL state through the same SQL interface the Python CLI uses.

**Acceptance criteria**  
- Each write command produces the same side effects as its Python counterpart.
- Transaction validation rules match Python behavior (SELL validation, exchange currency validation, etc.).
- `--dry-run` support is preserved.
- Auto-recalculation after mutation works.

**Must not do**  
- Introduce new transaction types or validation rules.
- Rewrite PostgreSQL-owned financial logic in TypeScript.

---

## Phase 3: Maintenance Commands

**Scope**  
Implement `portfolio-ts sync`, `recalculate`, `repair_prices` in TypeScript. These commands involve network access (price fetching) and multi-step orchestration.

**Acceptance criteria**  
- `sync` populates price cache identically to Python version.
- `recalculate` runs the same PostgreSQL recalculation procedure.
- `repair_prices` fetches and caches prices with the same error handling.
- Stale-state and error conditions match Python behavior.

**Must not do**  
- Change price-provider semantics without a dedicated decision record.
  The TypeScript provider must match Python behavior as closely as practical and be covered by mocked parity tests.
- Introduce new maintenance commands.

---

## Phase 4: Cutover

**Scope**  
Rename commands so `portfolio` points to the TypeScript binary. Python `portfolio` remains available as `portfolio-py` for fallback and parity comparison.

**Acceptance criteria**  
- `portfolio status` runs TypeScript code.
- `portfolio transactions` runs TypeScript code.
- All Phase 1-3 commands have `portfolio` as the default entry point.
- `portfolio-py` still works for parity verification.
- CI runs both `portfolio` (TypeScript) and `portfolio-py` (Python) and compares JSON output for all migrated commands.

**Must not do**  
- Remove Python source yet.
- Disable the `portfolio-py` entry point.

---

## Phase 5: Remove Python

**Scope**  
Delete the Python CLI source, service layer code, and dependencies. Keep only SQL schema files and migration scripts.

**Acceptance criteria**  
- `portfolio-py` no longer exists.
- Python dependencies (`pyproject.toml` etc.) are removed from the repository.
- All CI and documentation references to Python are updated.
- PostgreSQL schema and functions remain as the financial source of truth.

**Must not do**  
- Keep orphaned Python files. Remove everything that is not needed by TypeScript or PostgreSQL.
