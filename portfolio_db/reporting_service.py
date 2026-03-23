"""Snapshot, cash/position building, and reporting totals."""

from datetime import datetime

from portfolio_db.domain import (
    BASE_CURRENCY,
    CASH_BUCKET_DEFAULTS,
    CASH_DISPLAY_CURRENCY,
    CASH_FX_SYMBOLS,
    ALLOCATION_SUMMARY_LABELS,
    get_asset_type,
    is_cash_like,
    normalize_cash_asset,
    get_cash_key_for_asset,
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
        transactions = self._get_transactions_up_to(as_of_date)
        cash_balances = {
            symbol: values.copy()
            for symbol, values in CASH_BUCKET_DEFAULTS.items()
        }

        for trans in transactions:
            asset = trans[2]
            action = trans[3].upper()
            quantity = float(trans[4])
            price = trans[6]
            asset_type = get_asset_type(asset)
            cash_key = get_cash_key_for_asset(asset, asset_type)

            if action in external_inflow_actions and (asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')):
                deposit_key = normalize_cash_asset(asset, asset_type)
                cash_balances.setdefault(deposit_key, self._empty_cash_bucket())
                cash_balances[deposit_key]['deposits'] += quantity
                cash_balances[deposit_key]['balance'] += quantity
            elif action in transfer_actions and (asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')):
                transfer_key = normalize_cash_asset(asset, asset_type)
                cash_balances.setdefault(transfer_key, self._empty_cash_bucket())
                cash_balances[transfer_key]['transfers_in'] += quantity
                cash_balances[transfer_key]['balance'] += quantity
            elif action in external_outflow_actions and (asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')):
                withdraw_key = normalize_cash_asset(asset, asset_type)
                cash_balances.setdefault(withdraw_key, self._empty_cash_bucket())
                cash_balances[withdraw_key]['withdrawals'] += quantity
                cash_balances[withdraw_key]['balance'] -= quantity
            elif action in income_actions and (asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')):
                income_key = normalize_cash_asset(asset, asset_type)
                cash_balances.setdefault(income_key, self._empty_cash_bucket())
                metric_key = 'dividends' if action == 'DIVIDEND' else 'interest'
                cash_balances[income_key][metric_key] += quantity
                cash_balances[income_key]['balance'] += quantity
            elif action == 'BUY' and price:
                cash_balances[cash_key]['spent'] += quantity * price
                cash_balances[cash_key]['balance'] -= quantity * price
            elif action == 'SELL' and price:
                cash_balances[cash_key]['received'] += quantity * price
                cash_balances[cash_key]['balance'] += quantity * price
            elif action in expense_actions:
                fee_key = normalize_cash_asset(asset, asset_type) if (asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')) else cash_key
                cash_balances.setdefault(fee_key, self._empty_cash_bucket())
                metric_key = 'fees' if action == 'FEE' else 'taxes'
                cash_balances[fee_key][metric_key] += quantity
                cash_balances[fee_key]['balance'] -= quantity
            elif action == 'EXCHANGE_FROM':
                exchange_key = normalize_cash_asset(asset, asset_type) if (asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')) else cash_key
                cash_balances.setdefault(exchange_key, self._empty_cash_bucket())
                cash_balances[exchange_key]['balance'] += quantity
            elif action == 'EXCHANGE_TO':
                exchange_key = normalize_cash_asset(asset, asset_type) if (asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')) else cash_key
                cash_balances.setdefault(exchange_key, self._empty_cash_bucket())
                cash_balances[exchange_key]['balance'] += quantity

        return cash_balances

    def _build_cash_snapshot(self, as_of_date, price_context: dict, external_inflow_actions, transfer_actions, external_outflow_actions, income_actions, expense_actions, trade_actions, price_data_unavailable_error_cls) -> list:
        """Build valued cash balances for one reporting snapshot."""
        valuation_ts = price_context['valuation_ts']
        prices_dict = price_context['prices_dict']
        raw_balances = self.get_actual_cash_balances(
            as_of_date,
            external_inflow_actions,
            transfer_actions,
            external_outflow_actions,
            income_actions,
            expense_actions,
            trade_actions,
        )

        snapshot = []
        for symbol, raw in raw_balances.items():
            fx_rate = 1.0
            has_activity = any(float(raw[key]) != 0.0 for key in raw)
            if symbol != BASE_CURRENCY and has_activity:
                fx_rate = self.price_cache._require_series_price_asof(
                    prices_dict.get(symbol),
                    valuation_ts,
                    symbol=symbol,
                    kind='FX rate',
                    price_data_unavailable_error_cls=price_data_unavailable_error_cls,
                )

            snapshot.append({
                'symbol': symbol,
                'currency': CASH_DISPLAY_CURRENCY.get(symbol, symbol),
                'balance': raw['balance'],
                'market_value': raw['balance'] * fx_rate,
                'usd_value': raw['balance'] * fx_rate,
                'last_price': fx_rate,
                'fx_rate': fx_rate,
                'deposits': raw['deposits'],
                'transfers_in': raw['transfers_in'],
                'withdrawals': raw['withdrawals'],
                'spent': raw['spent'],
                'received': raw['received'],
                'dividends': raw['dividends'],
                'interest': raw['interest'],
                'fees': raw['fees'],
                'taxes': raw['taxes'],
            })

        return snapshot

    def _build_position_snapshot(self, as_of_date, price_context: dict, cash_snapshot: list, include_closed, trade_actions, price_data_unavailable_error_cls) -> list:
        """Build position-level reporting snapshot."""
        transactions = price_context['transactions']
        valuation_ts = price_context['valuation_ts']
        prices_dict = price_context['prices_dict']

        positions = {}
        for trans in transactions:
            asset = trans[2]
            action = trans[3].upper()
            quantity = float(trans[4])
            price = trans[6]
            date_obj = trans[1]

            if action not in trade_actions:
                continue

            if asset not in positions:
                positions[asset] = {
                    'symbol': asset,
                    'shares': 0.0,
                    'buy_quantity': 0.0,
                    'buy_cost': 0.0,
                    'sell_quantity': 0.0,
                    'sell_proceeds': 0.0,
                    'dividend_income': 0.0,
                    'first_buy_date': date_obj,
                    'last_price_from_trans': None,
                }

            if action == 'BUY':
                positions[asset]['shares'] += quantity
                positions[asset]['buy_quantity'] += quantity
                if price:
                    positions[asset]['buy_cost'] += quantity * price
                    positions[asset]['last_price_from_trans'] = price
                positions[asset]['first_buy_date'] = min(positions[asset]['first_buy_date'], date_obj)
            elif action == 'SELL':
                positions[asset]['shares'] -= quantity
                positions[asset]['sell_quantity'] += quantity
                if price:
                    positions[asset]['sell_proceeds'] += quantity * price
                    positions[asset]['last_price_from_trans'] = price

        def fx_rate(symbol: str) -> float:
            return self.price_cache._require_series_price_asof(
                prices_dict.get(symbol),
                valuation_ts,
                symbol=symbol,
                kind='FX rate',
                price_data_unavailable_error_cls=price_data_unavailable_error_cls,
            )

        result = []
        for symbol, pos_data in positions.items():
            shares = pos_data['shares']
            if abs(shares) < 0.01:
                shares = 0.0
            if shares == 0 and not include_closed:
                continue

            asset_type = get_asset_type(symbol)
            last_price = self.price_cache._get_series_price_asof(prices_dict.get(symbol), valuation_ts)
            if last_price is None and shares > 0:
                raise price_data_unavailable_error_cls(
                    f"Price unavailable for {symbol} as of {as_of_date}; try again."
                )
            if last_price is None:
                last_price = pos_data['last_price_from_trans']
            if last_price is not None and asset_type == 'stock_gbp':
                last_price *= fx_rate('GBPUSD=X')
            elif last_price is not None and asset_type == 'stock_eur':
                last_price *= fx_rate('EURUSD=X')

            avg_cost_per_share = (pos_data['buy_cost'] / pos_data['buy_quantity']) if pos_data['buy_quantity'] > 0 else 0.0
            total_cost = (shares * avg_cost_per_share) if shares > 0 else 0.0
            market_value = (shares * last_price) if last_price and shares > 0 else 0.0
            unrealized_gain_value = market_value - total_cost if shares > 0 else 0.0
            unrealized_gain_pct = (unrealized_gain_value / total_cost * 100) if total_cost > 0 and shares > 0 else 0.0
            realized_gain_value = pos_data['sell_proceeds'] - (pos_data['sell_quantity'] * avg_cost_per_share) if pos_data['sell_quantity'] > 0 else 0.0
            realized_gain_pct = (realized_gain_value / (pos_data['sell_quantity'] * avg_cost_per_share) * 100) if pos_data['sell_quantity'] > 0 and avg_cost_per_share > 0 else 0.0

            daily_gain_pct = 0.0
            daily_gain_value = 0.0
            price_series = prices_dict.get(symbol)
            if shares > 0 and last_price and price_series is not None:
                try:
                    price_history = price_series.loc[:valuation_ts]
                    if hasattr(price_history, 'columns'):
                        price_history = price_history.iloc[:, 0]
                    if len(price_history) > 1:
                        today_price = float(price_history.iloc[-1])
                        yesterday_price = float(price_history.iloc[-2])
                        if asset_type in ('stock_gbp', 'stock_eur'):
                            fx_symbol = 'GBPUSD=X' if asset_type == 'stock_gbp' else 'EURUSD=X'
                            fx_series = prices_dict.get(fx_symbol)
                            today_ts = price_history.index[-1]
                            yesterday_ts = price_history.index[-2]
                            today_fx = self.price_cache._get_series_price_asof(fx_series, today_ts)
                            yesterday_fx = self.price_cache._get_series_price_asof(fx_series, yesterday_ts)
                            if today_fx is None or yesterday_fx is None or today_fx <= 0 or yesterday_fx <= 0:
                                continue
                            today_price *= today_fx
                            yesterday_price *= yesterday_fx
                        if yesterday_price > 0:
                            daily_gain_pct = ((today_price - yesterday_price) / yesterday_price) * 100
                            daily_gain_value = shares * (today_price - yesterday_price)
                except Exception:
                    pass

            result.append({
                'symbol': symbol,
                'status': 'OPEN' if shares > 0 else 'CLOSED',
                'shares': shares,
                'last_price': last_price,
                'avg_cost_per_share': avg_cost_per_share,
                'total_cost': total_cost,
                'market_value': market_value,
                'dividend_income': pos_data['dividend_income'],
                'day_gain_pct': daily_gain_pct,
                'day_gain_value': daily_gain_value,
                'total_gain_pct': unrealized_gain_pct,
                'total_gain_value': unrealized_gain_value,
                'realized_gain_value': realized_gain_value,
                'realized_gain_pct': realized_gain_pct,
            })

        for cash in cash_snapshot:
            if cash['balance'] == 0 and not include_closed and cash['deposits'] == 0 and cash['withdrawals'] == 0:
                continue
            cash_daily_gain_pct = 0.0
            cash_daily_gain_value = 0.0
            if cash['balance'] > 0 and cash['symbol'] != BASE_CURRENCY:
                price_series = prices_dict.get(cash['symbol'])
                if price_series is not None:
                    try:
                        price_history = price_series.loc[:valuation_ts]
                        if hasattr(price_history, 'columns'):
                            price_history = price_history.iloc[:, 0]
                        if len(price_history) > 1:
                            today_px = float(price_history.iloc[-1])
                            yesterday_px = float(price_history.iloc[-2])
                            if yesterday_px > 0:
                                cash_daily_gain_pct = ((today_px - yesterday_px) / yesterday_px) * 100
                                cash_daily_gain_value = cash['balance'] * (today_px - yesterday_px)
                    except Exception:
                        pass
            result.append({
                'symbol': cash['symbol'],
                'status': 'OPEN' if cash['balance'] != 0 else 'CLOSED',
                'shares': cash['balance'],
                'last_price': cash['last_price'],
                'avg_cost_per_share': 0.0,
                'total_cost': 0.0,
                'market_value': cash['market_value'],
                'dividend_income': 0.0,
                'day_gain_pct': cash_daily_gain_pct,
                'day_gain_value': cash_daily_gain_value,
                'total_gain_pct': 0.0,
                'total_gain_value': 0.0,
                'realized_gain_value': 0.0,
                'realized_gain_pct': 0.0,
            })

        result.sort(key=lambda item: item['market_value'], reverse=True)
        return result

    def _aggregate_reporting_totals(self, as_of_date, positions: list, transactions, fx_prices, external_inflow_actions, transfer_actions, external_outflow_actions, validate_action_fn, price_data_unavailable_error_cls) -> dict:
        """Aggregate totals for the snapshot."""
        if transactions is None:
            transactions = self._get_transactions_up_to(as_of_date)

        cash_flow_metrics = self._get_external_cash_flow_metrics(
            transactions=transactions,
            as_of_date=as_of_date,
            fx_prices=fx_prices,
            external_inflow_actions=external_inflow_actions,
            transfer_actions=transfer_actions,
            external_outflow_actions=external_outflow_actions,
            validate_action_fn=validate_action_fn,
            price_data_unavailable_error_cls=price_data_unavailable_error_cls,
        )
        realized_gain = 0.0
        unrealized_gain = 0.0
        portfolio_value = 0.0

        for position in positions:
            portfolio_value += float(position.get('market_value') or 0.0)
            asset_type = get_asset_type(position['symbol'])
            if asset_type in ('cash_base', 'cash_fx') or position['symbol'].startswith('CASH'):
                continue
            realized_gain += float(position.get('realized_gain_value') or 0.0)
            unrealized_gain += float(position.get('total_gain_value') or 0.0)

        income = cash_flow_metrics['income']
        fees = cash_flow_metrics['fees']
        taxes = cash_flow_metrics['taxes']
        total_profit = realized_gain + unrealized_gain + income - fees - taxes
        return {
            'portfolio_value': portfolio_value,
            'deposits': cash_flow_metrics['deposits'],
            'transfers_in': cash_flow_metrics['transfers_in'],
            'withdrawals': cash_flow_metrics['withdrawals'],
            'net_contributions': cash_flow_metrics['net_contributions'],
            'dividends': cash_flow_metrics['dividends'],
            'interest': cash_flow_metrics['interest'],
            'fees': fees,
            'taxes': taxes,
            'income': income,
            'realized_gain': realized_gain,
            'unrealized_gain': unrealized_gain,
            'total_profit': total_profit,
            'total_return_pct': 0.0,
            'time_weighted_return_pct': 0.0,
            'total_invested': cash_flow_metrics['net_contributions'],
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
        snapshot = self.build_reporting_snapshot(
            as_of_date=as_of_date,
            include_closed=False,
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
        positions = snapshot['positions']
        assets = []
        cash = []
        for position in positions:
            asset_type = get_asset_type(position['symbol'])
            if asset_type in ('cash_base', 'cash_fx') or position['symbol'].startswith('CASH'):
                cash.append(position)
            else:
                assets.append(position)

        total_assets_value = sum(position['market_value'] for position in assets)
        total_cash_value = sum(position['market_value'] for position in cash)
        total_portfolio_value = snapshot['portfolio_value']

        result = []
        if allocation_type in ['assets', 'all']:
            for position in assets:
                denominator = total_portfolio_value if allocation_type == 'all' else total_assets_value
                pct = (position['market_value'] / denominator * 100) if denominator > 0 else 0.0
                result.append({
                    'symbol': position['symbol'],
                    'type': 'asset',
                    'value': position['market_value'],
                    'percentage': pct,
                })

        if allocation_type in ['cash', 'all']:
            cash_lookup = {item['symbol']: item for item in snapshot['cash_balances']}
            for position in cash:
                denominator = total_portfolio_value if allocation_type == 'all' else total_cash_value
                pct = (position['market_value'] / denominator * 100) if denominator > 0 else 0.0
                cash_meta = cash_lookup.get(position['symbol'], {})
                result.append({
                    'symbol': position['symbol'],
                    'type': 'cash',
                    'value': position['market_value'],
                    'percentage': pct,
                    'original_currency_value': cash_meta.get('balance', position['shares']),
                    'fx_rate': cash_meta.get('fx_rate', position['last_price']),
                })

        result.sort(key=lambda item: item['value'], reverse=True)

        summary = []
        if allocation_type in ['assets', 'all']:
            assets_pct = (total_assets_value / total_portfolio_value * 100) if allocation_type == 'all' and total_portfolio_value > 0 else (100.0 if total_assets_value > 0 else 0.0)
            summary.append({'symbol': ALLOCATION_SUMMARY_LABELS['assets'], 'type': 'summary', 'value': total_assets_value, 'percentage': assets_pct})
        if allocation_type in ['cash', 'all']:
            cash_pct = (total_cash_value / total_portfolio_value * 100) if allocation_type == 'all' and total_portfolio_value > 0 else (100.0 if total_cash_value > 0 else 0.0)
            summary.append({'symbol': ALLOCATION_SUMMARY_LABELS['cash'], 'type': 'summary', 'value': total_cash_value, 'percentage': cash_pct})
        if allocation_type == 'all':
            summary.append({'symbol': ALLOCATION_SUMMARY_LABELS['portfolio'], 'type': 'summary', 'value': total_portfolio_value, 'percentage': 100.0})

        return {
            'as_of_date': snapshot['as_of_date'],
            'positions': result,
            'summary': summary,
            'total_value': total_portfolio_value,
        }
