"""Cache keys, recalc scope, and daily return calculation."""

import json
import hashlib
from datetime import date

from portfolio_db.calculator import DailyReturnCalculator
import portfolio_db.logger as log


class RecalculationService:
    def __init__(self, db, price_cache):
        self.db = db
        self.price_cache = price_cache

    def _generate_cache_key(self) -> str:
        """Generate cache key based on transaction state."""
        transactions = self.db.get_transactions()
        trans_count = len(transactions)

        # Create hash of transaction data for cache validation
        if transactions:
            trans_str = json.dumps([str(t) for t in transactions])
            trans_hash = hashlib.md5(trans_str.encode()).hexdigest()
        else:
            trans_hash = ""

        return f"portfolio_{trans_count}_{trans_hash}"

    def _check_cache(self, from_date=None) -> bool:
        """Check if recalculation is needed based on cache."""
        cache_key = self._generate_cache_key()
        cached = self.db.get_cache(cache_key)

        if not cached:
            return False  # No cache found, need to recalculate

        cached_date = cached[1]  # last_calc_date

        # Convert to date if needed
        if hasattr(cached_date, 'date'):
            cached_date = cached_date.date()
        if hasattr(from_date, 'date'):
            from_date = from_date.date()

        # If no from_date specified, cache is valid if it exists
        if from_date is None:
            return True

        # If from_date is provided, cache is only valid if calculated after from_date
        if cached_date > from_date:
            return True  # Cache is more recent than requested date

        return False

    def _update_cache(self):
        """Update cache after successful recalculation."""
        cache_key = self._generate_cache_key()
        trans_count = self.db.get_transaction_count()
        self.db.set_cache(cache_key, date.today(), trans_count)

    def _detect_recalc_scope(self, new_trans_date) -> tuple:
        """
        Determine recalculation scope based on transaction date.
        Returns: (from_date, is_full_recalc)
        """
        last_date = self.db.get_last_transaction_date()

        if last_date is None:
            # First transaction ever
            return (new_trans_date, True)

        if new_trans_date < last_date:
            # Old transaction - need full recalc from this date
            return (new_trans_date, True)
        else:
            # Recent transaction - partial recalc from this date
            return (new_trans_date, False)

    def _calculate_and_store_returns(self, transactions, all_symbols, min_date, max_date, require_cached_fn, set_stale_fn, price_data_unavailable_error_cls):
        """Calculate and store daily returns."""
        require_cached_fn(transactions, max_date)
        prices_dict = self.price_cache.load_calculation_prices(all_symbols, min_date, max_date)

        try:
            calculator = DailyReturnCalculator(transactions, prices_dict, min_date, max_date)
            results = calculator.calculate_all_returns()
        except ValueError as exc:
            set_stale_fn(True)
            raise price_data_unavailable_error_cls(str(exc)) from exc
        self.db.replace_daily_returns(results, start_date=min_date)

    def recalculate(self, from_date, force, discover_assets_fn, require_cached_fn, set_stale_fn, mark_recalc_success_fn, price_data_unavailable_error_cls):
        """
        Smart recalculation with optional date range and caching.

        Args:
            from_date: Start date for recalc (None = full recalc from beginning)
            force: If True, ignore optimization and recalc everything

        Returns:
            {"status": "success", "recalc_type": "partial|full", "rows_affected": ...}
        """
        transactions = self.db.get_transactions()
        if not transactions:
            return {'status': 'error', 'message': 'No transactions found'}

        # Check cache if not forcing recalc
        if not force and self._check_cache(from_date):
            log.price_refresh_skipped("cache_hit")
            return {
                'status': 'success',
                'recalc_type': 'cached',
                'message': 'Using cached results'
            }

        recalc_type_planned = 'full' if (force or from_date is None) else 'partial'
        log.recalc_start(from_date, recalc_type_planned, force)

        # Determine recalc scope
        calc_start_date = transactions[0][1]
        if force or from_date is None:
            # Full recalculation
            is_full_recalc = True
        else:
            # Partial recalculation still needs the full historical price context.
            # The calculator rebuilds holdings from the first transaction, so
            # fetching prices only from from_date breaks the retained rows'
            # prev_value / adjusted_base chain.
            is_full_recalc = False

        # Discover assets and currencies for price lookup
        discovered_assets = discover_assets_fn()
        assets = set(discovered_assets['assets'])
        fx_currencies = discovered_assets['fx_currencies']

        # Get date range - always extend to today
        min_trans_date = transactions[0][1]
        max_trans_date = transactions[-1][1]
        max_date = date.today()

        # Combine assets and FX currencies for cached price loading
        all_symbols = list(assets)
        all_symbols.extend(fx_currencies)

        require_cached_fn(transactions, max_date)
        prices_dict = self.price_cache.load_calculation_prices(all_symbols, calc_start_date, max_date)

        try:
            calculator = DailyReturnCalculator(transactions, prices_dict, min_trans_date, max_date)
            results = calculator.calculate_all_returns()
        except ValueError as exc:
            set_stale_fn(True)
            log.recalc_failure(str(exc), from_date)
            raise price_data_unavailable_error_cls(str(exc)) from exc

        # Filter results if partial recalc
        if not is_full_recalc and from_date:
            results = [r for r in results if r['date'] >= from_date]

        replace_start_date = None if is_full_recalc else from_date
        self.db.replace_daily_returns(results, start_date=replace_start_date)
        rows_affected = len(results)

        recalc_type = 'full' if is_full_recalc else 'partial'
        self.db.log_refresh(recalc_type, rows_affected)
        log.recalc_done(recalc_type, rows_affected, from_date)

        # Update cache after successful recalculation
        self._update_cache()
        mark_recalc_success_fn()

        return {
            'status': 'success',
            'recalc_type': recalc_type,
            'rows_affected': rows_affected
        }

    def discover_assets_and_currencies(self, base_currency) -> dict:
        """
        Discover all assets and required FX currencies from transactions.

        Returns:
            dict: Contains 'assets' and 'fx_currencies' lists
        """
        from portfolio_db.domain import get_asset_type

        # Get unique assets from database
        assets = set(self.db.get_unique_assets())

        # Get unique currencies from transactions
        currencies = set(self.db.get_unique_currencies())

        # Determine required FX pairs
        fx_currencies = set()

        # Based on explicit currencies field
        currency_to_fx = {
            'EUR': 'EURUSD=X', 'GBP': 'GBPUSD=X', 'UAH': 'UAHUSD=X',
            'JPY': 'JPYUSD=X', 'CHF': 'CHFUSD=X', 'CAD': 'CADUSD=X',
            'AUD': 'AUDUSD=X', 'HKD': 'HKDUSD=X', 'SGD': 'SGDUSD=X',
        }
        for currency in currencies:
            if currency and currency != base_currency:
                fx_ticker = currency_to_fx.get(currency)
                if fx_ticker:
                    fx_currencies.add(fx_ticker)

        # Check assets using get_asset_type for unified classification
        from portfolio_db.domain import ASSET_TYPE_TO_CASH

        for asset in assets:
            asset_type = get_asset_type(asset)

            # FX currencies that are needed
            if asset_type == 'cash_fx':
                # Asset itself is FX (e.g., EURUSD=X, GBPUSD=X)
                fx_currencies.add(asset)
            elif asset_type in ASSET_TYPE_TO_CASH:
                # Regional stocks need their FX rate
                fx_currencies.add(ASSET_TYPE_TO_CASH[asset_type])

            # Backwards compatibility: old CASH format
            if asset.startswith('CASH'):
                if asset == 'CASH EUR':
                    fx_currencies.add('EURUSD=X')
                elif asset == 'CASH GBP':
                    fx_currencies.add('GBPUSD=X')
                elif asset == 'CASH UAH':
                    fx_currencies.add('UAHUSD=X')

        return {
            'assets': list(assets),
            'fx_currencies': list(fx_currencies)
        }
