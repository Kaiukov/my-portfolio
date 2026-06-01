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

## Manual Trigger

```bash
uv run portfolio recalculate
uv run portfolio recalculate --force
uv run portfolio recalculate --dry-run
```
