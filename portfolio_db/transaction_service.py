"""Add/edit/delete/exchange validation and writes."""

from datetime import datetime

from portfolio_db.domain import is_cash_like
from portfolio_db.price_cache_service import (
    PRICE_REFRESH_STATE_KEY,
    RECALC_STATE_KEY,
    STALE_DATA_STATE_KEY,
)
import portfolio_db.logger as log


class TransactionService:
    _REFRESH_STATE_KEYS = (
        PRICE_REFRESH_STATE_KEY,
        RECALC_STATE_KEY,
        STALE_DATA_STATE_KEY,
    )

    def __init__(self, db, recalc):
        self.db = db
        self.recalc = recalc

    def _capture_rollback_snapshot(self, *, from_date, is_full_recalc: bool, refresh_state=None) -> dict:
        """Capture derived state that recalc may mutate before failing."""
        refresh_state = refresh_state or self.db.get_all_service_state()
        daily_returns = (
            self.db.get_daily_returns()
            if is_full_recalc
            else self.db.get_daily_returns_from_date(from_date)
        )
        return {
            'from_date': from_date,
            'is_full_recalc': is_full_recalc,
            'daily_returns': daily_returns,
            'refresh_state': {
                key: refresh_state.get(key, {}).get('value')
                for key in self._REFRESH_STATE_KEYS
            },
        }

    def _restore_rollback_snapshot(self, snapshot: dict):
        """Restore derived state after a failed mutation recalc."""
        restore_start_date = None if snapshot['is_full_recalc'] else snapshot['from_date']
        self.db.replace_daily_returns(
            snapshot['daily_returns'],
            start_date=restore_start_date,
        )

        for key, value in snapshot['refresh_state'].items():
            self.db.set_service_state(key, value)

    def _validate_transaction_payload(self, *, asset: str, action: str, quantity: float, price: float = None, trade_actions, external_inflow_actions, external_outflow_actions, transfer_actions, income_actions, expense_actions, system_actions):
        """Validate transaction rules for supported actions."""
        _is_cash_like = is_cash_like(asset)

        if quantity == 0:
            raise ValueError("quantity must be non-zero")

        if action in trade_actions:
            if _is_cash_like:
                raise ValueError(f"{action} does not support cash assets")
            if price is None or price <= 0:
                raise ValueError(f"{action} requires a positive price")
            if quantity <= 0:
                raise ValueError(f"{action} requires a positive quantity")
            return

        if action in external_inflow_actions | transfer_actions | external_outflow_actions | income_actions | expense_actions:
            if not _is_cash_like:
                raise ValueError(f"{action} requires a cash asset")
            if price is not None:
                raise ValueError(f"{action} does not support price")
            if quantity <= 0:
                raise ValueError(f"{action} requires a positive quantity")
            return

        if action == 'EXCHANGE_FROM':
            if not _is_cash_like:
                raise ValueError("EXCHANGE_FROM requires a cash asset")
            if price is not None:
                raise ValueError("EXCHANGE_FROM does not support price")
            if quantity >= 0:
                raise ValueError("EXCHANGE_FROM requires a negative quantity")
            return

        if action == 'EXCHANGE_TO':
            if not _is_cash_like:
                raise ValueError("EXCHANGE_TO requires a cash asset")
            if price is not None:
                raise ValueError("EXCHANGE_TO does not support price")
            if quantity <= 0:
                raise ValueError("EXCHANGE_TO requires a positive quantity")

    def add_transaction(self, date_obj, asset: str, action: str, quantity: float, price: float, asset_type: str, currency: str, fees: float, exchange: str, data_source: str, account: str, validate_action_fn, derive_asset_type_fn, recalculate_fn, mark_price_data_stale_fn, trade_actions, external_inflow_actions, external_outflow_actions, transfer_actions, income_actions, expense_actions, system_actions) -> dict:
        """
        Add transaction and auto-trigger smart recalculation.

        Returns:
            {"status": "success", "recalc_type": "partial|full", "from_date": ..., "transaction_id": ...}
        """
        # Parse date if string
        if isinstance(date_obj, str):
            date_obj = datetime.strptime(date_obj, '%d-%m-%Y').date()
        action = validate_action_fn(action)
        self._validate_transaction_payload(
            asset=asset, action=action, quantity=float(quantity), price=price,
            trade_actions=trade_actions,
            external_inflow_actions=external_inflow_actions,
            external_outflow_actions=external_outflow_actions,
            transfer_actions=transfer_actions,
            income_actions=income_actions,
            expense_actions=expense_actions,
            system_actions=system_actions,
        )

        # Get last date BEFORE adding transaction
        last_date_before = self.db.get_last_transaction_date()

        # Detect asset_type if not provided
        if not asset_type and action not in system_actions:
            asset_type = derive_asset_type_fn(asset)

        # Add transaction to database
        trans_id, is_old = self.db.add_transaction(
            date_obj, asset, action, quantity,
            asset_type=asset_type, price=price,
            currency=currency, fees=fees,
            exchange=exchange, data_source=data_source, account=account,
        )

        # Determine recalculation scope based on date relative to previous last date
        if last_date_before is None:
            # First transaction ever
            is_full_recalc = True
            from_date = date_obj
        elif date_obj < last_date_before:
            # Old transaction - need full recalc from this date
            is_full_recalc = True
            from_date = date_obj
        else:
            # Recent transaction - partial recalc from this date
            is_full_recalc = False
            from_date = date_obj

        rollback_snapshot = self._capture_rollback_snapshot(
            from_date=from_date,
            is_full_recalc=is_full_recalc,
            refresh_state=self.db.get_all_service_state(),
        )
        mark_price_data_stale_fn()

        # Perform recalculation — roll back the insert if it fails
        try:
            recalculate_fn(from_date=from_date, force=False)
        except Exception:
            self.db.delete_transaction_by_id(trans_id)
            self._restore_rollback_snapshot(rollback_snapshot)
            raise

        recalc_type = 'full' if is_full_recalc else 'partial'
        log.transaction_add(trans_id, asset, action, float(quantity), date_obj, recalc_type)
        return {
            'status': 'success',
            'recalc_type': recalc_type,
            'from_date': str(from_date),
            'transaction_id': trans_id
        }

    def edit_transaction(self, transaction_id: int, changes: dict, validate_action_fn, derive_asset_type_fn, serialize_transaction_row_fn, recalculate_fn, mark_price_data_stale_fn, trade_actions, external_inflow_actions, external_outflow_actions, transfer_actions, income_actions, expense_actions, system_actions) -> dict:
        """Edit a transaction and recalculate from the earliest affected date."""
        existing = self.db.get_transaction_by_id(transaction_id)
        if not existing:
            raise ValueError(f"Transaction ID {transaction_id} not found")

        current = serialize_transaction_row_fn(existing)
        updated = current.copy()
        updated.update({key: value for key, value in changes.items() if value is not None})

        if isinstance(updated['date'], str):
            try:
                updated['date'] = datetime.strptime(updated['date'], '%d-%m-%Y').date()
            except ValueError:
                updated['date'] = datetime.strptime(updated['date'], '%Y-%m-%d').date()

        updated['action'] = validate_action_fn(updated['action'])

        if updated['action'] not in system_actions:
            updated['asset_type'] = derive_asset_type_fn(updated['asset'])
        self._validate_transaction_payload(
            asset=updated['asset'],
            action=updated['action'],
            quantity=float(updated['quantity']),
            price=updated.get('price'),
            trade_actions=trade_actions,
            external_inflow_actions=external_inflow_actions,
            external_outflow_actions=external_outflow_actions,
            transfer_actions=transfer_actions,
            income_actions=income_actions,
            expense_actions=expense_actions,
            system_actions=system_actions,
        )

        recalc_from = min(existing[1], updated['date'])
        updated_row = self.db.update_transaction(
            transaction_id,
            date=updated['date'],
            asset=updated['asset'],
            action=updated['action'],
            quantity=updated['quantity'],
            asset_type=updated.get('asset_type'),
            price=updated.get('price'),
            currency=updated.get('currency', 'USD'),
            fees=updated.get('fees'),
            exchange=updated.get('exchange', ''),
            data_source=updated.get('data_source', ''),
            account=updated.get('account'),
        )
        rollback_snapshot = self._capture_rollback_snapshot(
            from_date=recalc_from,
            is_full_recalc=True,
            refresh_state=self.db.get_all_service_state(),
        )
        mark_price_data_stale_fn()
        # Perform recalculation — restore original row if it fails
        try:
            recalc_result = recalculate_fn(from_date=recalc_from, force=True)
        except Exception:
            self.db.update_transaction(
                transaction_id,
                date=existing[1],
                asset=existing[2],
                action=existing[3],
                quantity=existing[4],
                asset_type=existing[5],
                price=existing[6],
                currency=existing[7] or 'USD',
                fees=existing[8],
                exchange=existing[9] or '',
                data_source=existing[10] or '',
                account=existing[11],
            )
            self._restore_rollback_snapshot(rollback_snapshot)
            raise
        changed_fields = [k for k, v in changes.items() if v is not None]
        log.transaction_edit(transaction_id, changed_fields, recalc_from, recalc_result.get('recalc_type', 'full'))
        return {
            'status': 'success',
            'recalc_type': recalc_result.get('recalc_type', 'full'),
            'from_date': str(recalc_from),
            'before': current,
            'transaction': serialize_transaction_row_fn(updated_row),
        }

    def delete_transaction(self, transaction_id: int, recalculate_fn, mark_price_data_stale_fn) -> dict:
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
        mark_price_data_stale_fn()

        # Delete daily returns from that date onwards
        self.db.delete_daily_returns_from_date(trans_date)

        # Recalculate from that date
        recalc_result = recalculate_fn(from_date=trans_date)
        log.transaction_delete(trans[0], trans[2], trans[3], trans[1], recalc_result.get('recalc_type', 'full'))

        return {
            'transaction_id': trans[0],
            'deleted_transaction': {
                'date': str(trans[1]),
                'asset': trans[2],
                'action': trans[3],
                'quantity': trans[4]
            },
            'recalc_type': recalc_result.get('recalc_type', 'none'),
            'from_date': str(trans_date),
            'rows_affected': recalc_result.get('rows_affected', 0)
        }

    def exchange_currency(self, date_obj, from_asset: str, to_asset: str, quantity: float, rate: float, recalculate_fn, mark_price_data_stale_fn) -> dict:
        """
        Exchange one currency for another.

        Creates two transactions:
        1. EXCHANGE_FROM: deducts from source currency
        2. EXCHANGE_TO: adds to target currency

        Returns:
            {"status": "success", "from_trans_id": ..., "to_trans_id": ..., "recalc_type": ..., "from_date": ...}
        """
        # Get last date BEFORE adding transaction
        last_date_before = self.db.get_last_transaction_date()

        target_amount = quantity * rate

        # Add EXCHANGE_FROM transaction (deduct from source)
        from_trans_id, _ = self.db.add_transaction(
            date_obj, from_asset, 'EXCHANGE_FROM', -quantity,
            asset_type=None, price=None, currency='', fees=None,
            exchange='', data_source=f'→ {to_asset} @ {rate}'
        )

        # Add EXCHANGE_TO transaction (add to target)
        to_trans_id, _ = self.db.add_transaction(
            date_obj, to_asset, 'EXCHANGE_TO', target_amount,
            asset_type=None, price=None, currency='', fees=None,
            exchange='', data_source=f'← {from_asset} @ {rate}'
        )

        # Determine recalculation scope
        if last_date_before is None:
            is_full_recalc = True
            from_date = date_obj
        elif date_obj < last_date_before:
            is_full_recalc = True
            from_date = date_obj
        else:
            is_full_recalc = False
            from_date = date_obj

        rollback_snapshot = self._capture_rollback_snapshot(
            from_date=from_date,
            is_full_recalc=is_full_recalc,
            refresh_state=self.db.get_all_service_state(),
        )
        mark_price_data_stale_fn()

        # Perform recalculation — roll back both inserts if it fails
        try:
            recalculate_fn(from_date=from_date, force=False)
        except Exception:
            self.db.delete_transaction_by_id(to_trans_id)
            self.db.delete_transaction_by_id(from_trans_id)
            self._restore_rollback_snapshot(rollback_snapshot)
            raise

        recalc_type = 'full' if is_full_recalc else 'partial'
        return {
            'status': 'success',
            'from_trans_id': from_trans_id,
            'to_trans_id': to_trans_id,
            'recalc_type': recalc_type,
            'from_date': str(from_date),
        }
