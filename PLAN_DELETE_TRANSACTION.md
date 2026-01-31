# Implementation Plan: Delete Transaction CLI Command

## Current State

### Schema
- **Transactions table**: Has `id` (PRIMARY KEY), `date`, `asset`, `action`, `quantity`, `price`, `currency`, `fees`, `exchange`, `data_source`, `asset_type`

### Services
- **PortfolioService**: High-level API for portfolio operations
- **PortfolioDatabase**: DuckDB database operations
- **CLI**: Click-based command interface

### Existing Commands
- `migrate`: Load from CSV
- `add`: Add transaction with auto-recalculation
- `transactions`: List all transactions
- `recalculate`: Manual recalculation
- `summary`: Position summary with gains/losses
- `allocation`: Portfolio allocation breakdown

---

## What Needs to Be Built

### Phase 1: Database Layer
**File**: `portfolio_db/database.py`

**Method**: `delete_transaction_by_id(transaction_id: int) → bool`
- Delete transaction from `transactions` table by ID
- Validate transaction exists before deletion
- Return boolean indicating success
- Raise exception if transaction ID not found

**Implementation details**:
```python
def delete_transaction_by_id(self, transaction_id: int) -> bool:
    """Delete a transaction by ID."""
    # Check if transaction exists
    result = self.con.execute(
        "SELECT id FROM transactions WHERE id = ?",
        [transaction_id]
    ).fetchone()

    if not result:
        raise ValueError(f"Transaction ID {transaction_id} not found")

    # Delete the transaction
    self.con.execute(
        "DELETE FROM transactions WHERE id = ?",
        [transaction_id]
    )
    self.con.commit()
    return True
```

---

### Phase 2: Service Layer
**File**: `portfolio_db/portfolio_service.py`

**Method**: `delete_transaction(transaction_id: int) → dict`

**Responsibilities**:
1. Fetch transaction details before deletion (for response)
2. Call database delete method
3. Determine recalculation scope (from transaction's date onwards)
4. Clear daily returns from that date
5. Trigger recalculation
6. Return result dict with:
   - `transaction_id`: Deleted transaction ID
   - `deleted_transaction`: Details of deleted transaction (date, asset, action, quantity)
   - `recalc_type`: Type of recalculation triggered (full, partial, cached)
   - `from_date`: Recalculation start date
   - `rows_affected`: Number of affected daily return rows

**Implementation details**:
```python
def delete_transaction(self, transaction_id: int) -> dict:
    """Delete transaction and auto-recalculate returns."""
    # Get transaction before deletion
    trans = self.db.con.execute(
        "SELECT id, date, asset, action, quantity FROM transactions WHERE id = ?",
        [transaction_id]
    ).fetchone()

    if not trans:
        raise ValueError(f"Transaction ID {transaction_id} not found")

    trans_date = trans[1]

    # Delete transaction
    self.db.delete_transaction_by_id(transaction_id)

    # Delete daily returns from that date onwards
    self.db.delete_daily_returns_from_date(trans_date)

    # Recalculate from that date
    recalc_result = self.recalculate(from_date=trans_date)

    return {
        'transaction_id': trans[0],
        'deleted_transaction': {
            'date': str(trans[1]),
            'asset': trans[2],
            'action': trans[3],
            'quantity': trans[4]
        },
        'recalc_type': recalc_result['recalc_type'],
        'from_date': str(trans_date),
        'rows_affected': recalc_result.get('rows_affected', 0)
    }
```

---

### Phase 3: CLI Layer
**File**: `portfolio_db/cli.py`

**Command**: `del`

**Options**:
- `--id` (required, integer): Transaction ID to delete
- `--confirm` (optional flag): Skip confirmation prompt
- `--db` (optional, default='portfolio.db'): Database path

**Workflow**:
1. Validate transaction ID is provided
2. Fetch transaction to display details
3. If `--confirm` flag NOT set, show details and ask for confirmation
4. Delete transaction via service
5. Display result with recalculation info

**Implementation details**:
```python
@cli.command()
@click.option('--id', required=True, type=int, help='Transaction ID to delete')
@click.option('--confirm', is_flag=True, help='Skip confirmation prompt')
@click.option('--db', default='portfolio.db', help='Path to database file')
def del(id, confirm, db):
    """Delete transaction by ID and auto-recalculate returns."""
    service = PortfolioService(db)

    try:
        # Get transaction to confirm
        trans = service.db.con.execute(
            "SELECT id, date, asset, action, quantity, price FROM transactions WHERE id = ?",
            [id]
        ).fetchone()

        if not trans:
            click.echo(f"Error: Transaction ID {id} not found", err=True)
            service.close()
            return

        # Show transaction details
        click.echo(f"\nTransaction to delete (ID: {trans[0]}):")
        click.echo(f"  Date:     {trans[1]}")
        click.echo(f"  Asset:    {trans[2]}")
        click.echo(f"  Action:   {trans[3]}")
        click.echo(f"  Quantity: {trans[4]}")
        click.echo(f"  Price:    {trans[5]}")

        # Ask for confirmation
        if not confirm:
            if not click.confirm("\nAre you sure you want to delete this transaction?"):
                click.echo("Cancelled")
                service.close()
                return

        # Delete and recalculate
        result = service.delete_transaction(id)

        click.echo(f"\n✓ Transaction deleted (ID: {result['transaction_id']})")
        click.echo(f"✓ {result['recalc_type'].upper()} recalculation triggered from {result['from_date']}")
        click.echo(f"✓ {result['rows_affected']} daily returns recalculated")

    except Exception as e:
        click.echo(f"Error: {str(e)}", err=True)
    finally:
        service.close()
```

---

## Command Usage

### Interactive (with confirmation)
```bash
uv run python -m portfolio_db.cli del --id 425
# Output:
# Transaction to delete (ID: 425):
#   Date:     2026-01-31
#   Asset:    PAXG-USD
#   Action:   BUY
#   Quantity: 0.1209
#   Price:    4962.4
#
# Are you sure you want to delete this transaction? [y/N]: y
# ✓ Transaction deleted (ID: 425)
# ✓ FULL recalculation triggered from 2026-01-31
# ✓ 1 daily returns recalculated
```

### Non-interactive (skip confirmation)
```bash
uv run python -m portfolio_db.cli del --id 425 --confirm
```

---

## Edge Cases to Handle

| Case | Handling |
|------|----------|
| Transaction ID doesn't exist | Show error message: "Transaction ID X not found" |
| Delete first transaction | Trigger full recalculation |
| Delete middle transaction | Partial recalculation from that date onwards |
| Deleting affected portfolio positions | Calculator already handles this (recalculates positions) |
| Negative cash impact | Recalculation handles all scenarios |

---

## Files to Modify

| File | Changes |
|------|---------|
| `portfolio_db/database.py` | Add `delete_transaction_by_id()` method |
| `portfolio_db/portfolio_service.py` | Add `delete_transaction()` method |
| `portfolio_db/cli.py` | Add `del` command |

---

## Testing Scenarios

1. **Delete non-existent transaction**: `del --id 9999` → Error message
2. **Delete with confirmation**: `del --id 425` → Shows details, asks confirmation, deletes
3. **Delete with auto-confirm**: `del --id 425 --confirm` → Deletes without prompt
4. **Verify recalculation**: Run `status` after deletion to verify daily returns updated
5. **Verify position changes**: Run `summary` to confirm position updated

---

## Implementation Order

1. Add database delete method
2. Add service delete method with recalculation
3. Add CLI del command
4. Test with transaction ID 425 (PAXG-USD purchase)
5. Verify daily returns recalculated correctly
