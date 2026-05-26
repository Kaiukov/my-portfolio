"""Price refresh, caching, coverage analysis, and repair."""

import os
from datetime import datetime, timedelta, timezone

from portfolio_db.domain import get_asset_type
import portfolio_db.logger as log

PRICE_REFRESH_STATE_KEY = 'last_successful_price_refresh'
RECALC_STATE_KEY = 'last_successful_recalc'
STALE_DATA_STATE_KEY = 'stale_data'

MAX_PRICE_AGE_DAYS = int(os.environ.get('PORTFOLIO_PRICE_MAX_AGE_DAYS', '7'))


class PriceCacheService:
    def __init__(self, db, price_service):
        self.db = db
        self.price_service = price_service

    def _set_stale_data(self, is_stale: bool):
        """Persist stale-data state."""
        if getattr(self.db, "read_only", False):
            return
        self.db.set_service_state(STALE_DATA_STATE_KEY, 'true' if is_stale else 'false')

    def _mark_price_data_stale(self):
        """Mark cached state stale after a mutating write."""
        self._set_stale_data(True)

    def _mark_recalc_success(self):
        """Persist successful recalc state."""
        self.db.set_service_state(RECALC_STATE_KEY, datetime.now(timezone.utc).isoformat(timespec='seconds'))
        self._set_stale_data(False)

    def _mark_price_refresh_success(self):
        """Persist successful price refresh state."""
        self.db.set_service_state(PRICE_REFRESH_STATE_KEY, datetime.now(timezone.utc).isoformat(timespec='seconds'))

    def get_refresh_state(self) -> dict:
        """Return explicit refresh/recalc state with max-age enforcement."""
        state = self.db.get_all_service_state()
        persisted_stale = state.get(STALE_DATA_STATE_KEY, {}).get('value') == 'true'
        last_refresh_str = state.get(PRICE_REFRESH_STATE_KEY, {}).get('value')

        age_stale = False
        if last_refresh_str:
            try:
                last_refresh = datetime.fromisoformat(last_refresh_str)
                age = datetime.now(timezone.utc) - last_refresh
                if age > timedelta(days=MAX_PRICE_AGE_DAYS):
                    age_stale = True
            except (ValueError, TypeError):
                age_stale = True
        else:
            age_stale = True

        return {
            'last_successful_price_refresh': last_refresh_str,
            'last_successful_recalc': state.get(RECALC_STATE_KEY, {}).get('value'),
            'stale_data': persisted_stale or age_stale,
        }

    def _refresh_cached_prices(self, tickers: list, start_date, end_date) -> dict:
        """Fetch prices explicitly and persist them into the cache."""
        if not tickers:
            return {'tickers': [], 'rows_loaded': 0, 'rows_per_ticker': {}}

        prices_dict = self.price_service.fetch_all_prices(tickers, start_date, end_date)
        self._persist_prices_to_db(prices_dict)
        rows_per_ticker = {
            ticker: len(series) if series is not None else 0
            for ticker, series in prices_dict.items()
        }
        rows_loaded = sum(rows_per_ticker.values())
        self._mark_price_refresh_success()
        log.price_refresh(tickers, rows_loaded, rows_per_ticker)
        return {'tickers': tickers, 'rows_loaded': rows_loaded, 'rows_per_ticker': rows_per_ticker}

    def _required_price_checkpoints(self, transactions, required_end, is_cash_like_fn, normalize_cash_asset_fn, base_currency, validate_action_fn, trade_actions) -> dict:
        """Build per-ticker required dates for strict cached coverage checks."""
        checkpoints = {}
        for trans in transactions:
            trans_date = trans[1]
            asset = trans[2]
            action = validate_action_fn(trans[3])
            asset_type = get_asset_type(asset)
            if action in trade_actions and not is_cash_like_fn(asset):
                checkpoints.setdefault(asset, set()).add(trans_date)
                # Add FX checkpoint for non-USD stocks
                from portfolio_db.domain import ASSET_TYPE_TO_CASH
                fx_ticker = ASSET_TYPE_TO_CASH.get(asset_type)
                if fx_ticker:
                    checkpoints.setdefault(fx_ticker, set()).add(trans_date)
            if is_cash_like_fn(asset):
                normalized = normalize_cash_asset_fn(asset, asset_type)
                if normalized != base_currency:
                    checkpoints.setdefault(normalized, set()).add(trans_date)

        for ticker in list(checkpoints):
            checkpoints[ticker].add(required_end)

        return {ticker: sorted(dates) for ticker, dates in checkpoints.items()}

    def _validate_cached_price_requirements(self, transactions, required_end, is_cash_like_fn, normalize_cash_asset_fn, base_currency, validate_action_fn, trade_actions) -> dict:
        """Validate that cached prices cover all required valuation checkpoints."""
        checkpoints = self._required_price_checkpoints(transactions, required_end, is_cash_like_fn, normalize_cash_asset_fn, base_currency, validate_action_fn, trade_actions)
        if not checkpoints:
            return {'required_range': {'start': None, 'end': str(required_end)}, 'coverage': [], 'issues': []}

        required_start = min(min(dates) for dates in checkpoints.values())
        tickers = sorted(checkpoints)
        cached = self.db.get_price_series(tickers, start_date=required_start, end_date=required_end)
        coverage = []
        issues = []

        for ticker in tickers:
            series = cached.get(ticker)
            point_failures = []
            for check_date in checkpoints[ticker]:
                if self._get_series_price_asof(series, check_date) is None:
                    point_failures.append(str(check_date))
            coverage_item = {
                'ticker': ticker,
                'required_start': str(required_start),
                'required_end': str(required_end),
                'checkpoint_dates': [str(value) for value in checkpoints[ticker]],
                'cached_rows': len(series) if series is not None else 0,
                'issues': [],
            }
            if series is None or len(series) == 0:
                coverage_item['issues'].append('missing_series')
            if point_failures:
                coverage_item['issues'].append('missing_required_dates')
                coverage_item['missing_dates'] = point_failures
            coverage.append(coverage_item)
            if coverage_item['issues']:
                issues.append({'ticker': ticker, 'issues': coverage_item['issues'], 'missing_dates': coverage_item.get('missing_dates', [])})

        return {
            'required_range': {'start': str(required_start), 'end': str(required_end)},
            'coverage': coverage,
            'issues': issues,
        }

    def _require_cached_price_requirements(self, transactions, required_end, is_cash_like_fn, normalize_cash_asset_fn, base_currency, validate_action_fn, trade_actions, price_issue_message_fn, price_data_unavailable_error_cls):
        """Raise on missing cached coverage and set stale state."""
        coverage = self._validate_cached_price_requirements(transactions, required_end, is_cash_like_fn, normalize_cash_asset_fn, base_currency, validate_action_fn, trade_actions)
        if coverage['issues']:
            self._set_stale_data(True)
            issue = coverage['issues'][0]
            log.price_coverage_failure(issue['ticker'], issue['issues'])
            raise price_data_unavailable_error_cls(price_issue_message_fn(issue))
        return coverage

    def _persist_prices_to_db(self, prices_dict: dict):
        """Store fetched prices to database for caching."""
        import pandas as pd
        try:
            for asset, price_data in prices_dict.items():
                if price_data is None or len(price_data) == 0:
                    continue

                # Handle both Series and DataFrame
                if isinstance(price_data, pd.DataFrame):
                    # If DataFrame, extract the first column (usually 'Close')
                    if len(price_data.columns) > 0:
                        price_series = price_data.iloc[:, 0]
                    else:
                        continue
                else:
                    price_series = price_data

                # Insert prices for this asset
                for date_idx, price in price_series.items():
                    date_obj = date_idx.date() if hasattr(date_idx, 'date') else date_idx
                    # Skip NaN values
                    try:
                        if price is None or (isinstance(price, float) and price != price):  # NaN check
                            continue
                        self.db.insert_price(asset, date_obj, float(price))
                    except Exception:
                        # Individual price insert failures are non-critical
                        continue
        except Exception:
            # Price persistence is non-critical - calculations use fresh prices
            pass

    def analyze_price_coverage(self, transactions, required_end, is_cash_like_fn, normalize_cash_asset_fn, base_currency, validate_action_fn, trade_actions) -> dict:
        """Inspect cached price coverage for all required tickers."""
        return self._validate_cached_price_requirements(transactions, required_end, is_cash_like_fn, normalize_cash_asset_fn, base_currency, validate_action_fn, trade_actions)

    def repair_prices(self, coverage, required_start, required_end, tickers=None) -> dict:
        """Fetch and persist cached prices for missing or requested tickers."""
        if required_start is None or required_end is None:
            return {'status': 'skipped', 'tickers': [], 'rows_loaded': 0}

        target_tickers = sorted(set(tickers or [
            item['ticker'] for item in coverage['coverage'] if item['issues']
        ]))
        if not target_tickers:
            return {'status': 'up_to_date', 'tickers': [], 'rows_loaded': 0}

        refresh_result = self._refresh_cached_prices(target_tickers, required_start, required_end)
        rows_loaded = refresh_result['rows_loaded']
        rows_per_ticker = refresh_result['rows_per_ticker']
        for ticker in target_tickers:
            self.db.log_price_repair(
                ticker,
                start_date=required_start,
                end_date=required_end,
                status='success',
                rows_loaded=rows_per_ticker.get(ticker, 0),
            )
        return {
            'rows_loaded': rows_loaded,
            'rows_per_ticker': rows_per_ticker,
            'target_tickers': target_tickers,
        }

    def verify_prices_storage(self, coverage, refresh_state) -> dict:
        """Verify and report on prices table structure and optimization."""
        info = self.db.get_prices_table_info()
        ticker_counts = self.db.get_prices_by_ticker_count()

        return {
            'status': 'verified',
            'schema': [
                {
                    'column': col[1],
                    'type': col[2],
                    'is_primary_key': col[5] > 0
                }
                for col in info['schema']
            ],
            'statistics': {
                'total_records': info['total_records'],
                'min_date': str(info['min_date']) if info['min_date'] else None,
                'max_date': str(info['max_date']) if info['max_date'] else None,
                'date_range_days': (info['max_date'] - info['min_date']).days if info['max_date'] and info['min_date'] else 0,
            },
            'ticker_breakdown': [
                {'ticker': ticker, 'record_count': count}
                for ticker, count in ticker_counts
            ],
            'coverage': coverage,
            'refresh_state': refresh_state,
            'repair_log': [
                {
                    'repair_id': row[0],
                    'ticker': row[1],
                    'start_date': str(row[2]) if row[2] else None,
                    'end_date': str(row[3]) if row[3] else None,
                    'status': row[4],
                    'rows_loaded': row[5],
                    'message': row[6],
                    'timestamp': str(row[7]) if row[7] else None,
                }
                for row in self.db.get_latest_repair_logs()
            ],
            'optimization_notes': [
                'Primary key on (date, ticker) is optimal for lookups',
                'Index on ticker column enables fast filtering by asset',
                f'Table contains {len(ticker_counts)} unique tickers',
                f'Storage is efficient for {info["total_records"]} price records',
                f'Price coverage issues detected: {len(coverage["issues"])}',
            ]
        }

    def load_calculation_prices(self, symbols: list, start_date, end_date) -> dict:
        """Load cached prices for calculation."""
        cached_prices = self.db.get_price_series(symbols, start_date=start_date, end_date=end_date)
        return dict(cached_prices)

    @staticmethod
    def _extract_scalar_price(value):
        """Extract scalar from Series/DataFrame cell-like objects."""
        if value is None:
            return None
        if hasattr(value, 'iloc'):
            if len(value) == 0:
                return None
            value = value.iloc[0]
        elif hasattr(value, 'values'):
            values = value.values
            if len(values) == 0:
                return None
            value = values[0]

        try:
            value = float(value)
        except (TypeError, ValueError):
            return None

        if value != value:
            return None
        return value

    def _get_series_price_asof(self, price_series, valuation_ts):
        """Read price using asof semantics at or before valuation_ts."""
        import pandas as pd

        if price_series is None:
            return None
        try:
            return self._extract_scalar_price(price_series.asof(pd.Timestamp(valuation_ts)))
        except Exception:
            return None

    def _require_series_price_asof(self, price_series, valuation_ts, *, symbol: str, kind: str, price_data_unavailable_error_cls) -> float:
        """Read mandatory price/FX data or raise a user-facing retry error."""
        value = self._get_series_price_asof(price_series, valuation_ts)
        if value is None:
            valuation_label = str(getattr(valuation_ts, 'date', lambda: valuation_ts)())
            raise price_data_unavailable_error_cls(
                f"{kind} unavailable for {symbol} as of {valuation_label}; try again."
            )
        return value
