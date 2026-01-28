"""Price fetching and caching."""

import json
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Optional

import yfinance
from binance import Client
from binance.exceptions import BinanceAPIException

from src.models import AssetType


class PriceCache:
    """TTL-based price cache stored in JSON."""

    def __init__(self, cache_file: str = "data/cache/prices.json", ttl_hours: float = 0.25):
        self.cache_file = Path(cache_file)
        self.ttl_seconds = ttl_hours * 3600
        self._ensure_directory()

    def _ensure_directory(self):
        """Create cache directory if it doesn't exist."""
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)

    def _load_cache(self) -> dict:
        """Load cache from file."""
        if not self.cache_file.exists():
            return {}

        try:
            with open(self.cache_file, "r") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_cache(self, cache: dict):
        """Save cache to file."""
        self._ensure_directory()
        with open(self.cache_file, "w") as f:
            json.dump(cache, f, indent=2)

    def get(self, key: str) -> Optional[str]:
        """Get cached value if not expired."""
        cache = self._load_cache()
        if key not in cache:
            return None

        entry = cache[key]
        timestamp = datetime.fromisoformat(entry["timestamp"])
        if datetime.now() - timestamp > timedelta(seconds=self.ttl_seconds):
            del cache[key]
            self._save_cache(cache)
            return None

        return entry["value"]

    def set(self, key: str, value: str):
        """Set cache value with timestamp."""
        cache = self._load_cache()
        cache[key] = {
            "value": value,
            "timestamp": datetime.now().isoformat(),
        }
        self._save_cache(cache)


class PriceFetcher:
    """Fetches current prices from multiple sources."""

    def __init__(self):
        self.cache = PriceCache()
        self.binance_client = Client()  # Public API, no key required

    def get_stock_price(self, symbol: str) -> Optional[Decimal]:
        """Fetch stock/ETF price from Yahoo Finance."""
        try:
            # Try cache first
            cached = self.cache.get(f"stock:{symbol}")
            if cached:
                return Decimal(cached)

            # Fetch from yfinance
            ticker = yfinance.Ticker(symbol)
            data = ticker.history(period="1d")

            if data.empty:
                return None

            price = Decimal(str(data["Close"].iloc[-1]))
            self.cache.set(f"stock:{symbol}", str(price))
            return price
        except Exception:
            return None

    def get_crypto_price(self, symbol: str) -> Optional[Decimal]:
        """Fetch crypto price from Binance API."""
        try:
            # Try cache first
            cache_key = f"crypto:{symbol}"
            cached = self.cache.get(cache_key)
            if cached:
                return Decimal(cached)

            # Convert symbol format: BTC-USD -> BTCUSDT, ETH-USD -> ETHUSDT
            if symbol.endswith("-USD"):
                binance_symbol = symbol[:-4] + "USDT"  # Remove -USD, add USDT
            elif symbol.endswith("-USDT"):
                binance_symbol = symbol
            else:
                binance_symbol = symbol.replace("-", "") + "USDT"

            # Fetch from Binance using official client
            ticker = self.binance_client.get_symbol_ticker(symbol=binance_symbol)
            price = Decimal(ticker["price"])
            self.cache.set(cache_key, str(price))
            return price
        except (BinanceAPIException, Exception):
            return None

    def get_exchange_rate(
        self,
        from_currency: str,
        to_currency: str = "USD"
    ) -> Optional[Decimal]:
        """Get exchange rate between two currencies using yfinance."""
        if from_currency == to_currency:
            return Decimal("1")

        try:
            # Try cache first
            cache_key = f"rate:{from_currency}:{to_currency}"
            cached = self.cache.get(cache_key)
            if cached:
                return Decimal(cached)

            # Use yfinance for currency pairs (XXX=X format)
            # This returns 1 USD = X currency units, so we need to invert
            ticker = yfinance.Ticker(f"{from_currency}=X")
            data = ticker.history(period="1d")

            if data.empty:
                return None

            # Invert the rate: yfinance gives USD->currency, we need currency->USD
            inverse_rate = Decimal(str(data["Close"].iloc[-1]))
            if inverse_rate == 0:
                return None

            rate = Decimal("1") / inverse_rate
            self.cache.set(cache_key, str(rate))
            return rate
        except Exception:
            return None

    def get_price(self, symbol: str, asset_type: AssetType) -> Optional[Decimal]:
        """
        Get price for an asset based on its type.

        Args:
            symbol: Asset symbol (e.g., "BTC-USD", "AAPL", "CASH")
            asset_type: Type of asset

        Returns:
            Current price as Decimal, or None if not available
        """
        if asset_type == AssetType.CASH:
            return Decimal("1.0")
        elif asset_type == AssetType.CRYPTO:
            return self.get_crypto_price(symbol)
        else:  # STOCK or ETF
            return self.get_stock_price(symbol)

    # ═══════════════════════════════════════════════════════
    # BENCHMARK DATA FETCHING
    # ═══════════════════════════════════════════════════════

    def get_benchmark_performance(
        self,
        symbol: str = "SPY",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Optional[dict]:
        """
        Get benchmark performance over period.

        Args:
            symbol: Benchmark symbol (SPY, QQQ, IMOEX, etc.)
            start_date: Start date (YYYY-MM-DD), default 1 year ago
            end_date: End date (YYYY-MM-DD), default today

        Returns:
            Dictionary with start_price, end_price, return_pct
        """
        cache_key = f"benchmark_{symbol}_{start_date}_{end_date}"
        cached = self.cache.get(cache_key)
        if cached:
            return json.loads(cached)

        try:
            ticker = yfinance.Ticker(symbol)

            # Default: last 1 year
            if not start_date:
                end_dt = datetime.now()
                start_dt = end_dt - timedelta(days=365)
                start_date = start_dt.strftime("%Y-%m-%d")
                end_date = end_dt.strftime("%Y-%m-%d")

            hist = ticker.history(start=start_date, end=end_date)

            if hist.empty:
                return None

            start_price = hist["Close"].iloc[0]
            end_price = hist["Close"].iloc[-1]

            if start_price <= 0:
                return None

            return_pct = ((end_price - start_price) / start_price) * 100

            result = {
                "symbol": symbol,
                "start_date": start_date,
                "end_date": end_date,
                "start_price": float(start_price),
                "end_price": float(end_price),
                "return_pct": float(return_pct),
            }

            self.cache.set(cache_key, json.dumps(result))
            return result

        except Exception:
            return None

    def get_risk_free_rate(self) -> Decimal:
        """
        Get current risk-free rate (10-year Treasury yield).

        Returns:
            Risk-free rate as percentage (default 4.5% if API fails)
        """
        cache_key = "risk_free_rate"
        cached = self.cache.get(cache_key)
        if cached:
            return Decimal(cached)

        try:
            # Fetch 10-year Treasury yield
            ticker = yfinance.Ticker("^TNX")  # 10-year Treasury yield
            hist = ticker.history(period="1d")

            if not hist.empty:
                rate = Decimal(str(hist["Close"].iloc[-1])) / 100  # Convert from % to decimal
                self.cache.set(cache_key, str(rate))
                return rate
        except Exception:
            pass

        # Default risk-free rate
        return Decimal("0.045")

    def get_benchmark_daily_returns(
        self,
        symbol: str = "SPY",
        days: int = 252,
    ) -> list:
        """
        Get benchmark daily returns for the last N trading days.

        Args:
            symbol: Benchmark symbol
            days: Number of trading days (default 252 = 1 year)

        Returns:
            List of daily returns as Decimal values
        """
        cache_key = f"benchmark_returns_{symbol}_{days}"
        cached = self.cache.get(cache_key)
        if cached:
            return [Decimal(x) for x in json.loads(cached)]

        try:
            ticker = yfinance.Ticker(symbol)
            hist = ticker.history(period=f"{int(days * 1.3)}d")  # Get extra days for processing

            if hist.empty or len(hist) < 2:
                return [Decimal("0")]

            returns = []
            for i in range(1, min(days + 1, len(hist))):
                prev_close = hist["Close"].iloc[i - 1]
                curr_close = hist["Close"].iloc[i]

                if prev_close > 0:
                    daily_return = (curr_close - prev_close) / prev_close
                    returns.append(float(daily_return))

            self.cache.set(cache_key, json.dumps(returns))
            return [Decimal(str(r)) for r in returns]

        except Exception:
            return [Decimal("0")]
