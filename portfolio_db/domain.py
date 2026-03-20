"""Shared domain constants and helpers for asset/cash/FX classification."""

BASE_CURRENCY = 'USD'
LEGACY_CASH_TO_FX = {
    'CASH EUR': 'EURUSD=X',
    'CASH GBP': 'GBPUSD=X',
    'CASH UAH': 'UAHUSD=X',
}
ASSET_TYPE_TO_CASH = {
    'stock_eur': 'EURUSD=X',
    'stock_gbp': 'GBPUSD=X',
}
SUPPORTED_FX_TICKERS = ('EURUSD=X', 'GBPUSD=X', 'UAHUSD=X')
CASH_FX_SYMBOLS = ('EURUSD=X', 'GBPUSD=X', 'UAHUSD=X')
CASH_BUCKET_DEFAULTS = {
    'USD': {'balance': 0.0, 'deposits': 0.0, 'transfers_in': 0.0, 'withdrawals': 0.0, 'spent': 0.0, 'received': 0.0, 'dividends': 0.0, 'interest': 0.0, 'fees': 0.0, 'taxes': 0.0},
    'EURUSD=X': {'balance': 0.0, 'deposits': 0.0, 'transfers_in': 0.0, 'withdrawals': 0.0, 'spent': 0.0, 'received': 0.0, 'dividends': 0.0, 'interest': 0.0, 'fees': 0.0, 'taxes': 0.0},
    'GBPUSD=X': {'balance': 0.0, 'deposits': 0.0, 'transfers_in': 0.0, 'withdrawals': 0.0, 'spent': 0.0, 'received': 0.0, 'dividends': 0.0, 'interest': 0.0, 'fees': 0.0, 'taxes': 0.0},
}
CASH_DISPLAY_CURRENCY = {
    'USD': 'USD',
    'EURUSD=X': 'EUR',
    'GBPUSD=X': 'GBP',
    'UAHUSD=X': 'UAH',
}
ALLOCATION_SUMMARY_LABELS = {
    'assets': 'TOTAL ASSETS',
    'cash': 'TOTAL CASH',
    'portfolio': 'TOTAL PORTFOLIO',
}


def get_asset_type(ticker: str) -> str:
    """Determine asset type by ticker symbol.

    Returns:
        - 'cash_base': USD (rate = 1.0)
        - 'cash_fx': EURUSD=X, GBPUSD=X, etc (FX pairs)
        - 'crypto': Bitcoin, Ethereum (ends with -USD)
        - 'stock_gbp': London stocks (ends with .L)
        - 'stock_eur': German stocks (ends with .DE)
        - 'stock_usd': US stocks and default
    """
    if ticker == BASE_CURRENCY:
        return 'cash_base'
    elif ticker.endswith('USD=X'):
        return 'cash_fx'
    elif ticker.endswith('-USD'):
        return 'crypto'
    elif ticker.endswith('.L'):
        return 'stock_gbp'
    elif ticker.endswith('.DE'):
        return 'stock_eur'
    else:
        return 'stock_usd'


def is_cash_like(asset: str) -> bool:
    """Return True for cash / FX assets."""
    asset_type = get_asset_type(asset)
    return asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')


def normalize_cash_asset(asset: str, asset_type: str) -> str:
    """Map cash-like assets to a canonical ticker."""
    if asset_type == 'cash_base' or asset == 'CASH USD':
        return BASE_CURRENCY
    if asset_type == 'cash_fx':
        return asset
    if asset == 'CASH EUR':
        return 'EURUSD=X'
    if asset == 'CASH GBP':
        return 'GBPUSD=X'
    if asset == 'CASH UAH':
        return 'UAHUSD=X'
    return asset


def get_cash_key_for_asset(asset: str, asset_type: str) -> str:
    """Return canonical cash bucket for an asset or currency."""
    if asset_type == 'stock_gbp' or asset == 'CASH GBP':
        return CASH_FX_SYMBOLS[1]
    if asset_type == 'stock_eur' or asset == 'CASH EUR':
        return CASH_FX_SYMBOLS[0]
    if asset_type == 'cash_fx':
        return asset
    return BASE_CURRENCY


def fx_ticker_for_asset(asset: str, asset_type: str = None) -> str | None:
    """Resolve FX ticker for a cash-like asset or regional stock type."""
    if asset_type == 'cash_fx':
        return asset
    if asset_type in ASSET_TYPE_TO_CASH:
        return ASSET_TYPE_TO_CASH[asset_type]
    return LEGACY_CASH_TO_FX.get(asset)


def cash_currency_for_asset_type(asset_type: str) -> str:
    """Resolve cash bucket by asset type."""
    return ASSET_TYPE_TO_CASH.get(asset_type, BASE_CURRENCY)
