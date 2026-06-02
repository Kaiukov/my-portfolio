# Recalculation

After any write operation (add, edit, delete, exchange), the system recalculates daily returns.

## Flow

1. Determine the earliest affected date: `min(old_date, new_date)`
2. Delete daily returns from that date onward
3. Recompute daily returns from that date to today
4. Set `stale_data = true` before recalc, `false` after success

## Partial vs Full

- **Partial**: new transaction appended at latest date — only that date forward
- **Full**: backdated transaction — all dates from transaction date forward

## Stale Data

`stale_data` flag in `state` table. True before recalc starts, false after success.

## Mutation Safety

If recalculation fails during add/edit/delete/exchange, state is restored to before the mutation.

## needs_recalc / recalc_warning

After `repair_prices` or a price refresh adds new price data without automatically recalculating, the system enters a stale-recalc state. Read-only snapshot commands (`status`, `summary`, `cash`, `allocation`, `performance`, `mwr`) surface this state in their JSON `meta` envelope:

- `meta.needs_recalc` (`boolean`): `true` when prices were refreshed but daily returns are not yet recalculated.
- `meta.recalc_warning` (`string`, present only when `needs_recalc` is `true`): `"Prices were refreshed but daily returns are not recalculated — snapshot commands (status/summary/allocation/cash) and performance may report different values for this date. Run 'recalculate' to sync."`

This allows callers to detect a stale-recalc state without running a mutation. Running `recalculate` clears the flag: `needs_recalc` becomes `false` and `recalc_warning` disappears from subsequent responses.

See [CLI Reference](cli-reference.md) for the full freshness meta field table.

## Manual Trigger

```bash
uv run portfolio recalculate
uv run portfolio recalculate --force
uv run portfolio recalculate --dry-run
```
