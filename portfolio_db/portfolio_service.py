"""High-level portfolio service API."""

import json
import os
from datetime import datetime, date

from portfolio_db.database import PortfolioDatabase
from portfolio_db.database import resolve_db_target
from portfolio_db.price_service import PriceService
from portfolio_db.domain import (
    CASH_FX_SYMBOLS as _CASH_FX_SYMBOLS,
    CASH_BUCKET_DEFAULTS as _CASH_BUCKET_DEFAULTS,
    CASH_DISPLAY_CURRENCY as _CASH_DISPLAY_CURRENCY,
    ALLOCATION_SUMMARY_LABELS as _ALLOCATION_SUMMARY_LABELS,
    EXTERNAL_INFLOW_ACTIONS as _EXTERNAL_INFLOW_ACTIONS,
    EXTERNAL_OUTFLOW_ACTIONS as _EXTERNAL_OUTFLOW_ACTIONS,
    TRANSFER_ACTIONS as _TRANSFER_ACTIONS,
    INCOME_ACTIONS as _INCOME_ACTIONS,
    EXPENSE_ACTIONS as _EXPENSE_ACTIONS,
    TRADE_ACTIONS as _TRADE_ACTIONS,
    SYSTEM_ACTIONS as _SYSTEM_ACTIONS,
    SUPPORTED_ACTIONS as _SUPPORTED_ACTIONS,
    get_asset_type,
    is_cash_like,
    normalize_cash_asset,
    get_cash_key_for_asset,
)
from portfolio_db.price_cache_service import PriceCacheService
from portfolio_db.reporting_service import ReportingService
from portfolio_db.recalculation_service import RecalculationService
from portfolio_db.transaction_service import TransactionService
from portfolio_db.performance_service import PerformanceService


class PriceDataUnavailableError(ValueError):
    """Raised when required price or FX data is unavailable for valuation."""
    pass


class PortfolioService:
    """High-level API for portfolio operations."""

    RISK_FREE_RATE_ANNUAL = 0.02
    BASE_CURRENCY = 'USD'
    BENCHMARK_TICKERS = [
        t.strip()
        for t in os.getenv('PORTFOLIO_BENCHMARK_TICKERS', 'SPY').split(',')
        if t.strip()
    ]
    EXTERNAL_INFLOW_ACTIONS = _EXTERNAL_INFLOW_ACTIONS
    EXTERNAL_OUTFLOW_ACTIONS = _EXTERNAL_OUTFLOW_ACTIONS
    TRANSFER_ACTIONS = _TRANSFER_ACTIONS
    INCOME_ACTIONS = _INCOME_ACTIONS
    EXPENSE_ACTIONS = _EXPENSE_ACTIONS
    TRADE_ACTIONS = _TRADE_ACTIONS
    SYSTEM_ACTIONS = _SYSTEM_ACTIONS
    SUPPORTED_ACTIONS = _SUPPORTED_ACTIONS
    CASH_FX_SYMBOLS = _CASH_FX_SYMBOLS
    CASH_BUCKET_DEFAULTS = _CASH_BUCKET_DEFAULTS
    CASH_DISPLAY_CURRENCY = _CASH_DISPLAY_CURRENCY
    ALLOCATION_SUMMARY_LABELS = _ALLOCATION_SUMMARY_LABELS
    PRICE_REFRESH_STATE_KEY = 'last_successful_price_refresh'
    RECALC_STATE_KEY = 'last_successful_recalc'
    STALE_DATA_STATE_KEY = 'stale_data'

    def __init__(self, read_only: bool = False):
        """Initialize service.

        Args:
            read_only: Enforce read-only mode.

        Raises:
            RuntimeError: If PORTFOLIO_DB_URL env var is not set.
        """
        self.db_target = resolve_db_target()
        self.db = PortfolioDatabase(self.db_target, read_only=read_only)
        self.price_service = PriceService()
        self._price_cache = PriceCacheService(self.db, self.price_service)
        self._reporting = ReportingService(self.db, self._price_cache)
        self._recalc = RecalculationService(self.db, self._price_cache)
        self._transactions = TransactionService(self.db, self._recalc)
        self._performance = PerformanceService(self.db, self._reporting)

    # ------------------------------------------------------------------ #
    # Internal helpers (kept for backward compat / delegation wiring)     #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _price_issue_message(issue: dict, kind: str = 'Price data') -> str:
        ticker = issue['ticker']
        issue_flags = ", ".join(issue['issues'])
        return f"{kind} unavailable for {ticker}: {issue_flags}."

    def _set_stale_data(self, is_stale: bool):
        """Persist stale-data state."""
        self._price_cache._set_stale_data(is_stale)

    def _mark_price_data_stale(self):
        """Mark cached state stale after a mutating write."""
        self._price_cache._mark_price_data_stale()

    def _mark_recalc_success(self):
        """Persist successful recalc state."""
        self._price_cache._mark_recalc_success()

    def _mark_price_refresh_success(self):
        """Persist successful price refresh state."""
        self._price_cache._mark_price_refresh_success()

    @staticmethod
    def _is_cash_like(asset: str) -> bool:
        """Return True for cash / FX assets."""
        return is_cash_like(asset)

    @staticmethod
    def _normalize_cash_asset(asset: str, asset_type: str) -> str:
        """Map cash-like assets to a canonical ticker."""
        return normalize_cash_asset(asset, asset_type)

    @staticmethod
    def _get_cash_key_for_asset(asset: str, asset_type: str) -> str:
        """Return canonical cash bucket for an asset or currency."""
        return get_cash_key_for_asset(asset, asset_type)

    def _require_cached_price_requirements(self, transactions, required_end):
        """Raise on missing cached coverage and set stale state."""
        return self._price_cache._require_cached_price_requirements(
            transactions, required_end,
            is_cash_like_fn=self._is_cash_like,
            normalize_cash_asset_fn=self._normalize_cash_asset,
            base_currency=self.BASE_CURRENCY,
            validate_action_fn=self.validate_action,
            trade_actions=self.TRADE_ACTIONS,
            price_issue_message_fn=self._price_issue_message,
            price_data_unavailable_error_cls=PriceDataUnavailableError,
        )

    def _validate_cached_price_requirements(self, transactions, required_end) -> dict:
        """Validate that cached prices cover all required valuation checkpoints."""
        return self._price_cache._validate_cached_price_requirements(
            transactions, required_end,
            is_cash_like_fn=self._is_cash_like,
            normalize_cash_asset_fn=self._normalize_cash_asset,
            base_currency=self.BASE_CURRENCY,
            validate_action_fn=self.validate_action,
            trade_actions=self.TRADE_ACTIONS,
        )

    def _extract_scalar_price(self, value):
        """Extract scalar from Series/DataFrame cell-like objects."""
        return self._price_cache._extract_scalar_price(value)

    def _get_series_price_asof(self, price_series, valuation_ts):
        """Read price using asof semantics at or before valuation_ts."""
        return self._price_cache._get_series_price_asof(price_series, valuation_ts)

    def _require_series_price_asof(self, price_series, valuation_ts, *, symbol: str, kind: str) -> float:
        """Read mandatory price/FX data or raise a user-facing retry error."""
        return self._price_cache._require_series_price_asof(
            price_series, valuation_ts, symbol=symbol, kind=kind,
            price_data_unavailable_error_cls=PriceDataUnavailableError,
        )

    def _refresh_cached_prices(self, tickers: list, start_date, end_date) -> dict:
        """Fetch prices explicitly and persist them into the cache."""
        return self._price_cache._refresh_cached_prices(tickers, start_date, end_date)

    def _persist_prices_to_db(self, prices_dict: dict):
        """Store fetched prices to database for caching."""
        self._price_cache._persist_prices_to_db(prices_dict)

    def _load_calculation_prices(self, symbols: list, start_date, end_date) -> dict:
        """Load cached prices for calculation."""
        return self._price_cache.load_calculation_prices(symbols, start_date, end_date)

    def _get_transactions_up_to(self, as_of_date=None):
        """Return transactions up to and including as_of_date."""
        return self._reporting._get_transactions_up_to(as_of_date)

    def _empty_reporting_snapshot(self) -> dict:
        """Return an empty reporting snapshot."""
        return self._reporting._empty_reporting_snapshot()

    @classmethod
    def _empty_cash_bucket(cls) -> dict:
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

    def _resolve_as_of_date(self, as_of_date=None):
        """Resolve the canonical reporting date."""
        return self._reporting._resolve_as_of_date(as_of_date, self.get_daily_returns)

    def _get_fx_conversion_series(self, cash_assets: set, min_date, max_date) -> dict:
        """Load cached FX series needed to convert cash flows into USD."""
        return self._reporting._get_fx_conversion_series(cash_assets, min_date, max_date)

    def _convert_cash_amount_to_usd(self, asset: str, quantity: float, date_obj, fx_prices: dict) -> float:
        """Convert a cash amount in the original cash currency to USD."""
        return self._reporting._convert_cash_amount_to_usd(asset, quantity, date_obj, fx_prices, PriceDataUnavailableError)

    def _get_external_cash_flow_metrics(self, transactions=None, as_of_date=None, fx_prices=None) -> dict:
        """Calculate cash-flow and cash-income metrics in USD."""
        return self._reporting._get_external_cash_flow_metrics(
            transactions=transactions,
            as_of_date=as_of_date,
            fx_prices=fx_prices,
            external_inflow_actions=self.EXTERNAL_INFLOW_ACTIONS,
            transfer_actions=self.TRANSFER_ACTIONS,
            external_outflow_actions=self.EXTERNAL_OUTFLOW_ACTIONS,
            validate_action_fn=self.validate_action,
            price_data_unavailable_error_cls=PriceDataUnavailableError,
        )

    def _get_profit_components(self, positions=None) -> dict:
        """Split PnL into realized and unrealized components."""
        if positions is None:
            positions = self.get_position_summary(include_closed=True)

        realized = 0.0
        unrealized = 0.0

        for position in positions:
            asset_type = get_asset_type(position['symbol'])
            if asset_type in ('cash_base', 'cash_fx') or position['symbol'].startswith('CASH'):
                continue
            realized += float(position.get('realized_gain_value') or 0.0)
            unrealized += float(position.get('total_gain_value') or 0.0)

        return {
            'realized': realized,
            'unrealized': unrealized,
            'total_profit': realized + unrealized,
        }

    def _load_reporting_price_context(self, as_of_date) -> dict:
        """Fetch price context for one reporting date."""
        return self._reporting._load_reporting_price_context(
            as_of_date,
            get_daily_returns_fn=self.get_daily_returns,
            discover_assets_fn=self.discover_assets_and_currencies,
            require_cached_fn=self._require_cached_price_requirements,
        )

    def _build_cash_snapshot(self, as_of_date, price_context: dict) -> list:
        """Build valued cash balances for one reporting snapshot."""
        return self._reporting._build_cash_snapshot(
            as_of_date, price_context,
            external_inflow_actions=self.EXTERNAL_INFLOW_ACTIONS,
            transfer_actions=self.TRANSFER_ACTIONS,
            external_outflow_actions=self.EXTERNAL_OUTFLOW_ACTIONS,
            income_actions=self.INCOME_ACTIONS,
            expense_actions=self.EXPENSE_ACTIONS,
            trade_actions=self.TRADE_ACTIONS,
            price_data_unavailable_error_cls=PriceDataUnavailableError,
        )

    def _build_position_snapshot(self, as_of_date, price_context: dict, cash_snapshot: list, include_closed=True) -> list:
        """Build position-level reporting snapshot."""
        return self._reporting._build_position_snapshot(
            as_of_date, price_context, cash_snapshot, include_closed,
            trade_actions=self.TRADE_ACTIONS,
            price_data_unavailable_error_cls=PriceDataUnavailableError,
        )

    def _aggregate_reporting_totals(self, as_of_date, positions: list, transactions=None, fx_prices=None) -> dict:
        """Aggregate totals for the snapshot."""
        return self._reporting._aggregate_reporting_totals(
            as_of_date, positions, transactions, fx_prices,
            external_inflow_actions=self.EXTERNAL_INFLOW_ACTIONS,
            transfer_actions=self.TRANSFER_ACTIONS,
            external_outflow_actions=self.EXTERNAL_OUTFLOW_ACTIONS,
            validate_action_fn=self.validate_action,
            price_data_unavailable_error_cls=PriceDataUnavailableError,
        )

    def _validate_transaction_payload(self, *, asset: str, action: str, quantity: float, price: float = None):
        """Validate transaction rules for supported actions."""
        self._transactions._validate_transaction_payload(
            asset=asset, action=action, quantity=quantity, price=price,
            trade_actions=self.TRADE_ACTIONS,
            external_inflow_actions=self.EXTERNAL_INFLOW_ACTIONS,
            external_outflow_actions=self.EXTERNAL_OUTFLOW_ACTIONS,
            transfer_actions=self.TRANSFER_ACTIONS,
            income_actions=self.INCOME_ACTIONS,
            expense_actions=self.EXPENSE_ACTIONS,
            system_actions=self.SYSTEM_ACTIONS,
        )

    def _required_price_checkpoints(self, transactions, required_end) -> dict:
        """Build per-ticker required dates for strict cached coverage checks."""
        return self._price_cache._required_price_checkpoints(
            transactions, required_end,
            is_cash_like_fn=self._is_cash_like,
            normalize_cash_asset_fn=self._normalize_cash_asset,
            base_currency=self.BASE_CURRENCY,
            validate_action_fn=self.validate_action,
            trade_actions=self.TRADE_ACTIONS,
        )

    def _generate_cache_key(self) -> str:
        """Generate cache key based on transaction state."""
        return self._recalc._generate_cache_key()

    def _check_cache(self, from_date=None) -> bool:
        """Check if recalculation is needed based on cache."""
        return self._recalc._check_cache(from_date)

    def _update_cache(self):
        """Update cache after successful recalculation."""
        self._recalc._update_cache()

    def _detect_recalc_scope(self, new_trans_date) -> tuple:
        """
        Determine recalculation scope based on transaction date.
        Returns: (from_date, is_full_recalc)
        """
        return self._recalc._detect_recalc_scope(new_trans_date)

    def _calculate_and_store_returns(self):
        """Rebuild daily returns using the PostgreSQL recalculation path."""
        self.recalculate(force=True)

    @staticmethod
    def _serialize_transaction_row(trans) -> dict:
        """Convert a DB transaction tuple into the standard response shape."""
        col_names = [
            'id', 'date', 'asset', 'action', 'quantity',
            'asset_type', 'price', 'currency', 'fees', 'fee_currency', 'exchange', 'data_source',
            'account', 'created_at', 'updated_at',
        ]
        return {
            name: (str(value) if name in ('date', 'created_at', 'updated_at') and value is not None else value)
            for name, value in zip(col_names, trans)
        }

    @classmethod
    def validate_action(cls, action: str) -> str:
        """Normalize and validate a transaction action."""
        normalized = action.upper()
        if normalized not in cls.SUPPORTED_ACTIONS:
            supported = ", ".join(cls.SUPPORTED_ACTIONS)
            raise ValueError(f"Unsupported action {action!r}. Supported actions: {supported}")
        return normalized

    @staticmethod
    def derive_asset_type(asset: str) -> str:
        """Classify assets using the app's internal ticker rules."""
        return get_asset_type(asset)

    # ------------------------------------------------------------------ #
    # Public API                                                          #
    # ------------------------------------------------------------------ #

    def setup_from_csv(self, csv_path: str):
        """Complete setup workflow from CSV."""
        # Clear existing data
        self.db.clear_transactions()
        self.db.clear_daily_returns()

        # Migrate CSV
        self.db.migrate_from_csv(csv_path)

        # Fetch prices
        self._fetch_and_cache_prices()

        # Calculate returns
        self.recalculate(force=True)

    def _fetch_and_cache_prices(self):
        """Fetch prices for all assets."""
        transactions = self.db.get_transactions()
        if not transactions:
            self._set_stale_data(False)
            return

        discovered_assets = self.discover_assets_and_currencies()
        all_symbols = sorted(set(discovered_assets['assets']) | set(discovered_assets['fx_currencies']))
        min_date = transactions[0][1]
        max_date = max(transactions[-1][1], date.today())
        self._refresh_cached_prices(all_symbols, min_date, max_date)

    def get_refresh_state(self) -> dict:
        """Return explicit refresh/recalc state."""
        return self._price_cache.get_refresh_state()

    def get_daily_returns(self) -> list:
        """Get all daily returns as list of dicts with separated metrics."""
        returns = self.db.get_daily_returns()
        return [
            {
                'date': str(ret[0]),
                'portfolio_value': float(ret[1]),
                'portfolio_daily_return': float(ret[2]) if ret[2] is not None else 0.0,
                'investment_return': float(ret[3]) if ret[3] is not None else 0.0,
                'cash_flow_impact': float(ret[4]) if ret[4] is not None else 0.0,
                'adjusted_base': float(ret[5]) if ret[5] is not None else 0.0
            }
            for ret in returns
        ]

    def get_daily_returns_paginated(self, limit: int = 50, offset: int = 0, start_date=None, end_date=None):
        """Get paginated daily returns with optional date filter."""
        rows, total = self.db.get_daily_returns_paginated(limit, offset, start_date, end_date)
        data = [
            {
                'date': str(ret[0]),
                'portfolio_value': float(ret[1]),
                'portfolio_daily_return': float(ret[2]) if ret[2] is not None else 0.0,
                'investment_return': float(ret[3]) if ret[3] is not None else 0.0,
                'cash_flow_impact': float(ret[4]) if ret[4] is not None else 0.0,
                'adjusted_base': float(ret[5]) if ret[5] is not None else 0.0,
            }
            for ret in rows
        ]
        return data, total

    def get_transactions(self) -> list:
        """Get all transactions as list of dicts."""
        transactions = self.db.get_transactions()

        col_names = [
            'id', 'date', 'asset', 'action', 'quantity',
            'asset_type', 'price', 'currency', 'fees', 'exchange', 'data_source',
            'account', 'created_at', 'updated_at',
        ]

        return [
            {col_names[i]: (
                str(trans[i]) if i == 1 else trans[i]
            ) for i in range(len(col_names))}
            for trans in transactions
        ]

    def get_transactions_paginated(self, limit: int = 50, offset: int = 0, start_date=None, end_date=None):
        """Get paginated transactions with optional date filter."""
        col_names = [
            'id', 'date', 'asset', 'action', 'quantity',
            'asset_type', 'price', 'currency', 'fees', 'exchange', 'data_source',
            'account', 'created_at', 'updated_at',
        ]
        rows, total = self.db.get_transactions_paginated(limit, offset, start_date, end_date)
        data = [
            {col_names[i]: (str(trans[i]) if i == 1 else trans[i]) for i in range(len(col_names))}
            for trans in rows
        ]
        return data, total

    def export_returns_json(self, output_path: str):
        """Export daily returns to JSON."""
        returns = self.get_daily_returns()
        with open(output_path, 'w') as f:
            json.dump(returns, f, indent=2)

    def export_transactions_json(self, output_path: str):
        """Export transactions to JSON."""
        transactions = self.get_transactions()
        with open(output_path, 'w') as f:
            json.dump(transactions, f, indent=2)

    def get_performance_stats(self, as_of_date=None, benchmark_ticker=None) -> dict:
        """Get portfolio performance statistics with separated return metrics."""
        return self._performance.get_performance_stats(
            as_of_date=as_of_date,
            get_daily_returns_fn=self.get_daily_returns,
            build_snapshot_fn=self.build_reporting_snapshot,
            risk_free_rate_annual=self.RISK_FREE_RATE_ANNUAL,
            benchmark_ticker=benchmark_ticker or self.BENCHMARK_TICKERS[0],
        )

    def evaluate_metric(self, metric_name: str, value: float) -> str:
        """Evaluate metric and return assessment comment (no emojis for JSON)."""
        return self._performance.evaluate_metric(metric_name, value)

    def get_concentration_metrics(self, as_of_date=None) -> dict:
        """Calculate portfolio concentration metrics."""
        as_of_date = self._resolve_as_of_date(as_of_date)
        return self._performance.get_concentration_metrics(
            as_of_date=as_of_date,
            get_allocation_fn=self.get_allocation,
        )

    def get_mwr_irr(self, as_of_date=None) -> float:
        """Calculate Money-Weighted Return (IRR/XIRR) as annual decimal.

        Uses dated cash flow events (deposits and withdrawals) plus
        the terminal portfolio value to solve for the internal rate of return.
        Returns 0.0 if not enough data.
        """
        snapshot = self.build_reporting_snapshot(as_of_date=as_of_date)
        as_of = snapshot['as_of_date']
        if not as_of:
            return 0.0
        from datetime import datetime as _dt
        as_of_d = _dt.strptime(as_of, '%Y-%m-%d').date() if isinstance(as_of, str) else as_of
        return self.db.calculate_xirr_sql(as_of_d, snapshot['portfolio_value'])

    def get_contribution_by_position(self, as_of_date=None) -> list:
        """Return per-position contribution to total portfolio gain."""
        as_of_date = self._resolve_as_of_date(as_of_date)
        return self._performance.get_contribution_by_position(
            as_of_date=as_of_date,
            build_snapshot_fn=self.build_reporting_snapshot,
        )

    def add_transaction(self, date_obj, asset: str, action: str, quantity: float, price: float = None, asset_type: str = None, currency: str = 'USD', fees: float = None, fee_currency: str = '', exchange: str = '', data_source: str = '', account: str = None) -> dict:
        """
        Add transaction and auto-trigger smart recalculation.

        Args:
            date_obj: Transaction date (date object or string DD-MM-YYYY)
            asset: Asset symbol
            action: BUY, SELL, DEPOSIT, WITHDRAW, or FEE
            quantity: Transaction quantity
            price: Asset price (optional, will be detected for unknown assets)
            asset_type: Asset type (optional, will be detected if not provided)
            currency: Currency code (default USD)
            fees: Transaction fees (optional)
            exchange: Exchange name (optional)
            data_source: Data source (optional)

        Returns:
            {"status": "success", "recalc_type": "partial|full", "from_date": ..., "transaction_id": ...}
        """
        normalized_action = action.upper() if action else action
        if normalized_action == 'TRANSFER' and not account:
            raise ValueError("TRANSFER requires an account label (use --account)")
        return self._transactions.add_transaction(
            date_obj, asset, action, quantity, price, asset_type, currency, fees, fee_currency, exchange, data_source, account,
            validate_action_fn=self.validate_action,
            derive_asset_type_fn=self.derive_asset_type,
            recalculate_fn=self.recalculate,
            mark_price_data_stale_fn=self._mark_price_data_stale,
            trade_actions=self.TRADE_ACTIONS,
            external_inflow_actions=self.EXTERNAL_INFLOW_ACTIONS,
            external_outflow_actions=self.EXTERNAL_OUTFLOW_ACTIONS,
            transfer_actions=self.TRANSFER_ACTIONS,
            income_actions=self.INCOME_ACTIONS,
            expense_actions=self.EXPENSE_ACTIONS,
            system_actions=self.SYSTEM_ACTIONS,
        )

    def preview_edit_transaction(self, transaction_id: int, **changes) -> dict:
        """Validate and preview an edit without mutating state."""
        existing = self.db.get_transaction_by_id(transaction_id)
        if not existing:
            raise ValueError(f"Transaction ID {transaction_id} not found")

        current = self._serialize_transaction_row(existing)
        updated = current.copy()
        updated.update({key: value for key, value in changes.items() if value is not None})

        if isinstance(updated['date'], str):
            try:
                updated['date'] = datetime.strptime(updated['date'], '%d-%m-%Y').date()
            except ValueError:
                updated['date'] = datetime.strptime(updated['date'], '%Y-%m-%d').date()

        new_action = changes.get('action')
        effective_action = (new_action.upper() if new_action else current['action']).upper()
        if effective_action == 'TRANSFER':
            new_account = changes.get('account')
            resolved_account = new_account if new_account is not None else current['account']
            if not resolved_account:
                raise ValueError("TRANSFER requires an account label (use --account)")

        updated['action'] = self.validate_action(updated['action'])
        if updated['action'] not in self.SYSTEM_ACTIONS:
            updated['asset_type'] = self.derive_asset_type(updated['asset'])
        self._transactions._validate_transaction_payload(
            asset=updated['asset'],
            action=updated['action'],
            quantity=float(updated['quantity']),
            price=updated.get('price'),
            trade_actions=self.TRADE_ACTIONS,
            external_inflow_actions=self.EXTERNAL_INFLOW_ACTIONS,
            external_outflow_actions=self.EXTERNAL_OUTFLOW_ACTIONS,
            transfer_actions=self.TRANSFER_ACTIONS,
            income_actions=self.INCOME_ACTIONS,
            expense_actions=self.EXPENSE_ACTIONS,
            system_actions=self.SYSTEM_ACTIONS,
        )
        return {
            'current': current,
            'updated': updated,
        }

    def edit_transaction(self, transaction_id: int, **changes) -> dict:
        """Edit a transaction and recalculate from the earliest affected date."""
        self.preview_edit_transaction(transaction_id, **changes)
        return self._transactions.edit_transaction(
            transaction_id, changes,
            validate_action_fn=self.validate_action,
            derive_asset_type_fn=self.derive_asset_type,
            serialize_transaction_row_fn=self._serialize_transaction_row,
            recalculate_fn=self.recalculate,
            mark_price_data_stale_fn=self._mark_price_data_stale,
            trade_actions=self.TRADE_ACTIONS,
            external_inflow_actions=self.EXTERNAL_INFLOW_ACTIONS,
            external_outflow_actions=self.EXTERNAL_OUTFLOW_ACTIONS,
            transfer_actions=self.TRANSFER_ACTIONS,
            income_actions=self.INCOME_ACTIONS,
            expense_actions=self.EXPENSE_ACTIONS,
            system_actions=self.SYSTEM_ACTIONS,
        )

    def exchange_currency(self, date_obj, from_asset: str, to_asset: str, quantity: float, rate: float) -> dict:
        """
        Exchange one currency for another.

        Creates two transactions:
        1. EXCHANGE_FROM: deducts from source currency
        2. EXCHANGE_TO: adds to target currency

        Args:
            date_obj: Transaction date
            from_asset: Source asset/currency (e.g., USD, EURUSD=X)
            to_asset: Target asset/currency (e.g., USD, EURUSD=X)
            quantity: Amount to exchange (in source currency)
            rate: Exchange rate (amount of target per 1 unit of source)

        Returns:
            {"status": "success", "from_trans_id": ..., "to_trans_id": ..., "recalc_type": ..., "from_date": ...}
        """
        return self._transactions.exchange_currency(
            date_obj, from_asset, to_asset, quantity, rate,
            recalculate_fn=self.recalculate,
            mark_price_data_stale_fn=self._mark_price_data_stale,
        )

    def recalculate(self, from_date=None, force=False):
        """
        Smart recalculation with optional date range and caching.

        Args:
            from_date: Start date for recalc (None = full recalc from beginning)
            force: If True, ignore optimization and recalc everything

        Returns:
            {"status": "success", "recalc_type": "partial|full", "rows_affected": ...}
        """
        return self._recalc.recalculate(
            from_date=from_date,
            force=force,
            discover_assets_fn=self.discover_assets_and_currencies,
            require_cached_fn=self._require_cached_price_requirements,
            set_stale_fn=self._set_stale_data,
            mark_recalc_success_fn=self._mark_recalc_success,
            price_data_unavailable_error_cls=PriceDataUnavailableError,
        )

    def discover_assets_and_currencies(self):
        """
        Discover all assets and required FX currencies from transactions.

        Returns:
            dict: Contains 'assets' and 'fx_currencies' lists
        """
        return self._recalc.discover_assets_and_currencies(self.BASE_CURRENCY)

    def analyze_price_coverage(self, start_date=None, end_date=None) -> dict:
        """Inspect cached price coverage for all required tickers."""
        transactions = self.db.get_transactions()
        if not transactions:
            return {
                'required_range': {'start': None, 'end': None},
                'required_tickers': [],
                'coverage': [],
                'issues': [],
            }

        required_end = end_date or self._resolve_as_of_date() or transactions[-1][1]
        return self._price_cache.analyze_price_coverage(
            transactions, required_end,
            is_cash_like_fn=self._is_cash_like,
            normalize_cash_asset_fn=self._normalize_cash_asset,
            base_currency=self.BASE_CURRENCY,
            validate_action_fn=self.validate_action,
            trade_actions=self.TRADE_ACTIONS,
        )

    def repair_prices(self, tickers=None, start_date=None, end_date=None) -> dict:
        """Fetch and persist cached prices for missing or requested tickers."""
        coverage = self.analyze_price_coverage(start_date=start_date, end_date=end_date)
        required_start = start_date or (
            datetime.strptime(coverage['required_range']['start'], '%Y-%m-%d').date()
            if coverage['required_range']['start'] else None
        )
        # Always extend to today so the daily cron keeps prices current.
        # Without this, repair_prices only validates up to the last recalc date
        # and never fetches prices for the current day.
        required_end = end_date or date.today()

        # Always refresh ALL portfolio tickers (not just ones with gaps) so
        # that the daily cron proactively refreshes every position to today.
        effective_tickers = tickers
        if effective_tickers is None:
            all_portfolio_tickers = [item['ticker'] for item in coverage['coverage']]
            effective_tickers = sorted(set(all_portfolio_tickers) | set(self.BENCHMARK_TICKERS))

        repair_result = self._price_cache.repair_prices(coverage, required_start, required_end, tickers=effective_tickers)
        if repair_result.get('status') in ('skipped', 'up_to_date'):
            return repair_result

        target_tickers = repair_result['target_tickers']
        rows_loaded = repair_result['rows_loaded']
        refreshed_coverage = self.analyze_price_coverage(start_date=start_date, end_date=end_date)
        self._set_stale_data(bool(refreshed_coverage['issues']))
        return {
            'status': 'success',
            'tickers': target_tickers,
            'rows_loaded': rows_loaded,
            'range': {'start': str(required_start), 'end': str(required_end)},
            'coverage': refreshed_coverage,
        }

    def verify_prices_storage(self) -> dict:
        """Verify and report on prices table structure and optimization."""
        coverage = self.analyze_price_coverage()
        refresh_state = self.get_refresh_state()
        return self._price_cache.verify_prices_storage(coverage, refresh_state)

    def get_actual_cash_balances(self, as_of_date=None) -> dict:
        """Single source of truth for raw cash balances up to as_of_date."""
        return self._reporting.get_actual_cash_balances(
            as_of_date,
            external_inflow_actions=self.EXTERNAL_INFLOW_ACTIONS,
            transfer_actions=self.TRANSFER_ACTIONS,
            external_outflow_actions=self.EXTERNAL_OUTFLOW_ACTIONS,
            income_actions=self.INCOME_ACTIONS,
            expense_actions=self.EXPENSE_ACTIONS,
            trade_actions=self.TRADE_ACTIONS,
        )

    def build_reporting_snapshot(self, as_of_date=None, include_closed=True) -> dict:
        """Build one deterministic reporting snapshot."""
        as_of_date = self._resolve_as_of_date(as_of_date)
        return self._reporting.build_reporting_snapshot(
            as_of_date=as_of_date,
            include_closed=include_closed,
            get_daily_returns_fn=self.get_daily_returns,
            discover_assets_fn=self.discover_assets_and_currencies,
            require_cached_fn=self._require_cached_price_requirements,
            external_inflow_actions=self.EXTERNAL_INFLOW_ACTIONS,
            transfer_actions=self.TRANSFER_ACTIONS,
            external_outflow_actions=self.EXTERNAL_OUTFLOW_ACTIONS,
            income_actions=self.INCOME_ACTIONS,
            expense_actions=self.EXPENSE_ACTIONS,
            trade_actions=self.TRADE_ACTIONS,
            validate_action_fn=self.validate_action,
            price_data_unavailable_error_cls=PriceDataUnavailableError,
        )

    def get_position_summary(self, include_closed=True, as_of_date=None):
        """Get position-level summary with gains/losses."""
        snapshot = self.build_reporting_snapshot(as_of_date=as_of_date, include_closed=include_closed)
        return snapshot['positions']

    def get_allocation(self, allocation_type='all', as_of_date=None):
        """Get portfolio allocation breakdown from the snapshot."""
        as_of_date = self._resolve_as_of_date(as_of_date)
        return self._reporting.get_allocation(
            allocation_type=allocation_type,
            as_of_date=as_of_date,
            get_daily_returns_fn=self.get_daily_returns,
            discover_assets_fn=self.discover_assets_and_currencies,
            require_cached_fn=self._require_cached_price_requirements,
            external_inflow_actions=self.EXTERNAL_INFLOW_ACTIONS,
            transfer_actions=self.TRANSFER_ACTIONS,
            external_outflow_actions=self.EXTERNAL_OUTFLOW_ACTIONS,
            income_actions=self.INCOME_ACTIONS,
            expense_actions=self.EXPENSE_ACTIONS,
            trade_actions=self.TRADE_ACTIONS,
            validate_action_fn=self.validate_action,
            price_data_unavailable_error_cls=PriceDataUnavailableError,
        )

    def delete_transaction(self, transaction_id: int) -> dict:
        """Delete transaction and auto-recalculate returns."""
        return self._transactions.delete_transaction(
            transaction_id,
            recalculate_fn=self.recalculate,
            mark_price_data_stale_fn=self._mark_price_data_stale,
        )

    # ── use-case delegation (keeps CLI free of db internals) ────────────── #

    def get_transaction_count(self) -> int:
        return self.db.get_transaction_count()

    def get_transaction_by_id(self, transaction_id: int) -> dict | None:
        row = self.db.get_transaction_by_id(transaction_id)
        return self._serialize_transaction_row(row) if row else None

    def preview_delete_transaction(self, transaction_id: int) -> dict | None:
        row = self.db.get_transaction_by_id(transaction_id)
        if not row:
            return None
        return {
            "transaction_id": row[0],
            "date": str(row[1]),
            "asset": row[2],
            "action": row[3],
            "quantity": row[4],
        }

    def sql_backup(self, dst) -> None:
        self.db.dump_sql_backup(dst)

    def close(self):
        """Close database connection."""
        self.db.close()
