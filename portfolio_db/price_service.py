"""Price fetching and caching service."""

import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict


class PriceService:
    """Fetch and cache prices from yfinance."""

    INTERNAL_TO_YFINANCE_FX = {
        'JPYUSD=X': 'JPY=X',
        'CHFUSD=X': 'CHF=X',
        'CADUSD=X': 'CAD=X',
        'AUDUSD=X': 'AUD=X',
        'HKDUSD=X': 'HKD=X',
        'SGDUSD=X': 'SGD=X',
    }
    REVERSE_QUOTED_FX = frozenset(INTERNAL_TO_YFINANCE_FX)

    # Manual asset type mapping for known assets
    ASSET_TYPE_MAP = {
        'BTC-USD': 'crypto',
        'ETH-USD': 'crypto',
        'XRP-USD': 'crypto',
        'SOL-USD': 'crypto',
        'DOGE-USD': 'crypto',
        'ETH': 'etf',  # Grayscale Ethereum Mini Trust
        'GBTC': 'etf',
    }

    def __init__(self):
        """Initialize price service."""
        self.prices_cache = {}

    def detect_asset_type(self, asset: str) -> str:
        """Detect asset type from yfinance."""
        # Check manual mapping first
        if asset in self.ASSET_TYPE_MAP:
            return self.ASSET_TYPE_MAP[asset]

        # Handle CASH assets
        if asset.startswith('CASH'):
            return 'cash'

        # Try yfinance
        try:
            ticker = yf.Ticker(asset)
            quote_type = ticker.info.get('quoteType', 'UNKNOWN')

            # Map yfinance quoteType to our categories
            if quote_type == 'CRYPTOCURRENCY':
                return 'crypto'
            elif quote_type == 'ETF':
                return 'etf'
            elif quote_type in ['EQUITY', 'COMMON_STOCK']:
                return 'stock'
            else:
                return quote_type.lower()
        except Exception:
            return 'unknown'

    def fetch_all_prices(self, assets: list, start_date, end_date) -> Dict[str, pd.Series]:
        """
        Fetch prices for all assets in date range.

        Returns:
            Dict of {asset: pd.Series with prices indexed by date}
        """
        prices_data = {}

        for asset in assets:
            try:
                if asset.startswith('CASH'):
                    # CASH assets always have price 1.0
                    prices_data[asset] = pd.Series(
                        1.0,
                        index=pd.date_range(start=start_date, end=end_date)
                    )
                else:
                    # Download from yfinance
                    ticker = self._map_to_yfinance(asset)
                    data = yf.download(
                        ticker,
                        start=start_date - timedelta(days=10),
                        end=end_date + timedelta(days=1),
                        progress=False
                    )

                    if isinstance(data, pd.DataFrame):
                        prices = data['Close']
                    else:
                        prices = data['Close']

                    if asset in self.REVERSE_QUOTED_FX:
                        prices = 1.0 / prices
                    prices.index = pd.to_datetime(prices.index)
                    prices_data[asset] = prices.sort_index()

            except Exception as e:
                print(f"Warning: Could not fetch {asset}: {e}")

        return prices_data

    def _map_to_yfinance(self, asset: str) -> str:
        """Map asset name to yfinance ticker."""
        # Regional stock suffixes — already in yfinance format
        if asset.endswith(('.L', '.DE', '.T', '.SW', '.TO', '.AX', '.HK', '.SG')):
            return asset
        # FX pairs: map internal XXXUSD=X to Yahoo format.
        # Some Yahoo pairs are quoted as foreign-currency-per-USD and are inverted on download.
        mapped_fx = self.INTERNAL_TO_YFINANCE_FX.get(asset)
        if mapped_fx:
            return mapped_fx
        # Default to asset name as ticker
        return asset
