"""Snapshot, cash/position building, and reporting totals."""

from datetime import datetime

from portfolio_db.domain import (
    BASE_CURRENCY,
    CASH_BUCKET_DEFAULTS,
    get_asset_type,
    normalize_cash_asset,
)


class ReportingService:
    def __init__(self, db, price_cache):
        self.db = db
        self.price_cache = price_cache

    # ------------------------------------------------------------------ #
    # Helpers kept for backward compat with PortfolioService delegation   #
    # ------------------------------------------------------------------ #

    def _empty_reporting_snapshot(self) -> dict:
        """Return an empty reporting snapshot."""
        return {
            'as_of_date': None,
            'portfolio_value': 0.0,
            'positions': [],
            'cash_balances': [],
            'deposits': 0.0,
            'withdrawals': 0.0,
            'net_contributions': 0.0,
            'dividends': 0.0,
            'interest': 0.0,
            'fees': 0.0,
            'taxes': 0.0,
            'income': 0.0,
            'realized_gain': 0.0,
            'unrealized_gain': 0.0,
            'total_profit': 0.0,
            'time_weighted_return_pct': 0.0,
            'total_return_pct': 0.0,
            'total_invested': 0.0,
            'cagr': 0.0,
        }

    def _empty_cash_bucket(self) -> dict:
        """Return a new mutable cash bucket record."""
        return {
            'balance': 0.0,
            'deposits': 0.0,
            'transfers_in': 0.0,
            'withdrawals': 0.0,
            'spent': 0.0,
            'received': 0.0,
            'dividends': 0.0,
            'interest': 0.0,
            'fees': 0.0,
            'taxes': 0.0,
        }

    def _resolve_as_of_date(self, as_of_date, get_daily_returns_fn):
        """Resolve the canonical reporting date."""
        if as_of_date is not None:
            return as_of_date

        returns = get_daily_returns_fn()
        if returns:
            return datetime.strptime(returns[-1]['date'], '%Y-%m-%d').date()

        last_transaction_date = self.db.get_last_transaction_date()
        if last_transaction_date:
            return last_transaction_date

        return None

    def _get_transactions_up_to(self, as_of_date=None):
        """Return transactions up to and including as_of_date."""
        transactions = self.db.get_transactions()
        if as_of_date is None:
            return transactions
        return [trans for trans in transactions if trans[1] <= as_of_date]

    def _load_reporting_price_context(self, as_of_date, get_daily_returns_fn, discover_assets_fn, require_cached_fn) -> dict:
        """Fetch price context for one reporting date."""
        import pandas as pd

        transactions = self._get_transactions_up_to(as_of_date)
        if not transactions:
            return {
                'as_of_date': as_of_date,
                'valuation_ts': pd.Timestamp(as_of_date) if as_of_date else None,
                'transactions': [],
                'prices_dict': {},
                'returns': [],
            }

        min_date = transactions[0][1]
        require_cached_fn(transactions, as_of_date)
        discovered = discover_assets_fn()
        all_symbols = list(discovered['assets'])
        all_symbols.extend(discovered['fx_currencies'])
        prices_dict = self.db.get_price_series(all_symbols, start_date=min_date, end_date=as_of_date)

        returns = [
            row for row in get_daily_returns_fn()
            if datetime.strptime(row['date'], '%Y-%m-%d').date() <= as_of_date
        ]

        return {
            'as_of_date': as_of_date,
            'valuation_ts': pd.Timestamp(as_of_date),
            'transactions': transactions,
            'prices_dict': prices_dict,
            'returns': returns,
        }

    def _get_fx_conversion_series(self, cash_assets: set, min_date, max_date) -> dict:
        """Load cached FX series needed to convert cash flows into USD."""
        fx_assets = {asset for asset in cash_assets if asset not in {BASE_CURRENCY, 'CASH USD'}}
        if not fx_assets:
            return {}
        return self.db.get_price_series(sorted(fx_assets), start_date=min_date, end_date=max_date)

    def _convert_cash_amount_to_usd(self, asset: str, quantity: float, date_obj, fx_prices: dict, price_data_unavailable_error_cls) -> float:
        """Convert a cash amount in the original cash currency to USD."""
        asset_type = get_asset_type(asset)
        normalized_asset = normalize_cash_asset(asset, asset_type)
        if normalized_asset == BASE_CURRENCY:
            return float(quantity)

        fx_rate = self.price_cache._require_series_price_asof(
            fx_prices.get(normalized_asset),
            date_obj,
            symbol=normalized_asset,
            kind='FX rate',
            price_data_unavailable_error_cls=price_data_unavailable_error_cls,
        )
        return float(quantity) * fx_rate

    def _get_external_cash_flow_metrics(self, transactions, as_of_date, fx_prices, external_inflow_actions, transfer_actions, external_outflow_actions, validate_action_fn, price_data_unavailable_error_cls) -> dict:
        """Calculate cash-flow and cash-income metrics in USD."""
        if transactions is None:
            transactions = self._get_transactions_up_to(as_of_date)
        if not transactions:
            return {
                'deposits': 0.0,
                'withdrawals': 0.0,
                'net_contributions': 0.0,
                'dividends': 0.0,
                'interest': 0.0,
                'fees': 0.0,
                'taxes': 0.0,
                'income': 0.0,
                'cash_flow_events': [],
            }

        if fx_prices is None:
            cash_assets = set()
            min_date = transactions[0][1]
            max_date = transactions[-1][1]

            for trans in transactions:
                asset = trans[2]
                asset_type = get_asset_type(asset)
                if asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH'):
                    cash_assets.add(normalize_cash_asset(asset, asset_type))

            fx_prices = self._get_fx_conversion_series(cash_assets, min_date, max_date)

        deposits = 0.0
        transfers_in = 0.0
        withdrawals = 0.0
        dividends = 0.0
        interest = 0.0
        fees = 0.0
        taxes = 0.0
        cash_flow_events = []

        for trans in transactions:
            date_obj = trans[1]
            asset = trans[2]
            action = validate_action_fn(trans[3])
            quantity = float(trans[4])
            asset_type = get_asset_type(asset)
            is_cash_asset = asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')

            if not is_cash_asset:
                continue

            amount_usd = self._convert_cash_amount_to_usd(asset, quantity, date_obj, fx_prices, price_data_unavailable_error_cls)
            if action in external_inflow_actions:
                deposits += amount_usd
                cash_flow_events.append({'date': date_obj, 'amount': amount_usd})
            elif action in transfer_actions:
                # Internal transfer: adds to balance but not counted as external deposit
                transfers_in += amount_usd
            elif action in external_outflow_actions:
                withdrawals += amount_usd
                cash_flow_events.append({'date': date_obj, 'amount': -amount_usd})
            elif action == 'DIVIDEND':
                dividends += amount_usd
            elif action == 'INTEREST':
                interest += amount_usd
            elif action == 'FEE':
                fees += amount_usd
            elif action == 'TAX':
                taxes += amount_usd

        return {
            'deposits': deposits,
            'transfers_in': transfers_in,
            'withdrawals': withdrawals,
            'net_contributions': deposits - withdrawals,
            'dividends': dividends,
            'interest': interest,
            'fees': fees,
            'taxes': taxes,
            'income': dividends + interest,
            'cash_flow_events': cash_flow_events,
        }

    def get_actual_cash_balances(self, as_of_date, external_inflow_actions, transfer_actions, external_outflow_actions, income_actions, expense_actions, trade_actions) -> dict:
        """Single source of truth for raw cash balances up to as_of_date."""
        cash_balances = {
            symbol: values.copy()
            for symbol, values in CASH_BUCKET_DEFAULTS.items()
        }
        for row in self.db.get_cash_snapshot_rows(as_of_date):
            symbol = row[0]
            cash_balances[symbol] = {
                'balance': float(row[2] or 0.0),
                'deposits': float(row[7] or 0.0),
                'transfers_in': float(row[8] or 0.0),
                'withdrawals': float(row[9] or 0.0),
                'spent': float(row[10] or 0.0),
                'received': float(row[11] or 0.0),
                'dividends': float(row[12] or 0.0),
                'interest': float(row[13] or 0.0),
                'fees': float(row[14] or 0.0),
                'taxes': float(row[15] or 0.0),
            }
        return cash_balances

    def _build_cash_snapshot(self, as_of_date, price_context: dict, external_inflow_actions, transfer_actions, external_outflow_actions, income_actions, expense_actions, trade_actions, price_data_unavailable_error_cls) -> list:
        """Build valued cash balances for one reporting snapshot."""
        snapshot = []
        for row in self.db.get_cash_snapshot_rows(as_of_date):
            snapshot.append({
                'symbol': row[0],
                'currency': row[1],
                'balance': float(row[2] or 0.0),
                'market_value': float(row[3] or 0.0),
                'usd_value': float(row[4] or 0.0),
                'last_price': float(row[5] or 1.0),
                'fx_rate': float(row[6] or 1.0),
                'deposits': float(row[7] or 0.0),
                'transfers_in': float(row[8] or 0.0),
                'withdrawals': float(row[9] or 0.0),
                'spent': float(row[10] or 0.0),
                'received': float(row[11] or 0.0),
                'dividends': float(row[12] or 0.0),
                'interest': float(row[13] or 0.0),
                'fees': float(row[14] or 0.0),
                'taxes': float(row[15] or 0.0),
                'day_gain_pct': float(row[16] or 0.0),
                'day_gain_value': float(row[17] or 0.0),
            })
        return snapshot

    def _build_position_snapshot(self, as_of_date, price_context: dict, cash_snapshot: list, include_closed, trade_actions, price_data_unavailable_error_cls) -> list:
        """Build position-level reporting snapshot."""
        result = []
        for row in self.db.get_position_snapshot_rows(as_of_date, include_closed=include_closed):
            result.append({
                'symbol': row[0],
                'status': row[1],
                'shares': float(row[2] or 0.0),
                'last_price': float(row[3] or 0.0),
                'avg_cost_per_share': float(row[4] or 0.0),
                'total_cost': float(row[5] or 0.0),
                'market_value': float(row[6] or 0.0),
                'dividend_income': float(row[7] or 0.0),
                'day_gain_pct': float(row[8] or 0.0),
                'day_gain_value': float(row[9] or 0.0),
                'total_gain_pct': float(row[10] or 0.0),
                'total_gain_value': float(row[11] or 0.0),
                'realized_gain_value': float(row[12] or 0.0),
                'realized_gain_pct': float(row[13] or 0.0),
            })

        for cash in cash_snapshot:
            if cash['balance'] == 0 and not include_closed and cash['deposits'] == 0 and cash['withdrawals'] == 0:
                continue
            result.append({
                'symbol': cash['symbol'],
                'status': 'OPEN' if cash['balance'] != 0 else 'CLOSED',
                'shares': cash['balance'],
                'last_price': cash['last_price'],
                'avg_cost_per_share': 0.0,
                'total_cost': 0.0,
                'market_value': cash['market_value'],
                'dividend_income': 0.0,
                'day_gain_pct': cash['day_gain_pct'],
                'day_gain_value': cash['day_gain_value'],
                'total_gain_pct': 0.0,
                'total_gain_value': 0.0,
                'realized_gain_value': 0.0,
                'realized_gain_pct': 0.0,
            })

        result.sort(key=lambda item: item['market_value'], reverse=True)
        return result

    def _aggregate_reporting_totals(self, as_of_date, positions: list, transactions, fx_prices, external_inflow_actions, transfer_actions, external_outflow_actions, validate_action_fn, price_data_unavailable_error_cls) -> dict:
        """Aggregate totals for the snapshot."""
        totals = self.db.get_reporting_totals_sql(as_of_date)
        return {
            **totals,
            'total_return_pct': 0.0,
            'time_weighted_return_pct': 0.0,
            'total_invested': totals['net_contributions'],
            'cagr': 0.0,
        }

    def build_reporting_snapshot(self, as_of_date, include_closed, get_daily_returns_fn, discover_assets_fn, require_cached_fn, external_inflow_actions, transfer_actions, external_outflow_actions, income_actions, expense_actions, trade_actions, validate_action_fn, price_data_unavailable_error_cls) -> dict:
        """Build one deterministic reporting snapshot."""
        if as_of_date is None:
            return self._empty_reporting_snapshot()

        price_context = self._load_reporting_price_context(as_of_date, get_daily_returns_fn, discover_assets_fn, require_cached_fn)
        cash_snapshot = self._build_cash_snapshot(
            as_of_date, price_context,
            external_inflow_actions, transfer_actions, external_outflow_actions,
            income_actions, expense_actions, trade_actions,
            price_data_unavailable_error_cls,
        )
        positions = self._build_position_snapshot(as_of_date, price_context, cash_snapshot, include_closed, trade_actions, price_data_unavailable_error_cls)
        totals = self._aggregate_reporting_totals(
            as_of_date,
            positions,
            transactions=price_context['transactions'],
            fx_prices=price_context['prices_dict'],
            external_inflow_actions=external_inflow_actions,
            transfer_actions=transfer_actions,
            external_outflow_actions=external_outflow_actions,
            validate_action_fn=validate_action_fn,
            price_data_unavailable_error_cls=price_data_unavailable_error_cls,
        )

        snapshot = self._empty_reporting_snapshot()
        snapshot.update({
            'as_of_date': str(as_of_date),
            'portfolio_value': totals['portfolio_value'],
            'positions': positions,
            'cash_balances': cash_snapshot,
            'deposits': totals['deposits'],
            'transfers_in': totals['transfers_in'],
            'withdrawals': totals['withdrawals'],
            'net_contributions': totals['net_contributions'],
            'dividends': totals['dividends'],
            'interest': totals['interest'],
            'fees': totals['fees'],
            'taxes': totals['taxes'],
            'income': totals['income'],
            'realized_gain': totals['realized_gain'],
            'unrealized_gain': totals['unrealized_gain'],
            'total_profit': totals['total_profit'],
            'time_weighted_return_pct': totals['time_weighted_return_pct'],
            'total_return_pct': totals['total_return_pct'],
            'total_invested': totals['total_invested'],
            'cagr': totals['cagr'],
        })
        return snapshot

    def get_position_summary(self, include_closed, as_of_date, get_daily_returns_fn, discover_assets_fn, require_cached_fn, external_inflow_actions, transfer_actions, external_outflow_actions, income_actions, expense_actions, trade_actions, validate_action_fn, price_data_unavailable_error_cls):
        """Get position-level summary with gains/losses."""
        snapshot = self.build_reporting_snapshot(
            as_of_date=as_of_date,
            include_closed=include_closed,
            get_daily_returns_fn=get_daily_returns_fn,
            discover_assets_fn=discover_assets_fn,
            require_cached_fn=require_cached_fn,
            external_inflow_actions=external_inflow_actions,
            transfer_actions=transfer_actions,
            external_outflow_actions=external_outflow_actions,
            income_actions=income_actions,
            expense_actions=expense_actions,
            trade_actions=trade_actions,
            validate_action_fn=validate_action_fn,
            price_data_unavailable_error_cls=price_data_unavailable_error_cls,
        )
        return snapshot['positions']

    def get_allocation(self, allocation_type, as_of_date, get_daily_returns_fn, discover_assets_fn, require_cached_fn, external_inflow_actions, transfer_actions, external_outflow_actions, income_actions, expense_actions, trade_actions, validate_action_fn, price_data_unavailable_error_cls):
        """Get portfolio allocation breakdown from the snapshot."""
        allocation = self.db.get_allocation_rows(as_of_date, allocation_type=allocation_type)
        return {
            'as_of_date': str(as_of_date) if as_of_date is not None else None,
            'positions': [
                {
                    'symbol': row[0],
                    'type': row[1],
                    'value': float(row[2] or 0.0),
                    'percentage': float(row[3] or 0.0),
                    'original_currency_value': float(row[4]) if row[4] is not None else None,
                    'fx_rate': float(row[5]) if row[5] is not None else None,
                }
                for row in allocation['positions']
            ],
            'summary': [
                {
                    'symbol': row[0],
                    'type': row[1],
                    'value': float(row[2] or 0.0),
                    'percentage': float(row[3] or 0.0),
                }
                for row in allocation['summary']
            ],
            'total_value': float(allocation['total_value'] or 0.0),
        }
