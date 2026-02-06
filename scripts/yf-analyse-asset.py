#!/usr/bin/env python3
"""
Analyse individual asset metrics using yfinance.
Usage: python yf-analyse-asset.py TICKER
Supports: stocks, ETFs, crypto
"""

import yfinance as yf
import pandas as pd
import numpy as np
import sys
from typing import Optional, Tuple

BENCHMARK_TICKER = "^GSPC"  # S&P 500 for beta calculation
RISK_FREE_RATE = 0.0425  # ~4.25% current risk-free rate (5-year Treasury)

# ETF benchmark mapping for accurate tracking error calculation
ETF_BENCHMARKS = {
    # US Large Cap
    "SPY": "^GSPC",     # S&P 500
    "VOO": "^GSPC",     # Vanguard S&P 500
    "IVV": "^GSPC",     # iShares Core S&P 500
    "VTI": "^VTI",      # Total Stock Market (self)

    # US Small/Mid Cap
    "IWM": "^RUT",      # Russell 2000
    "IWR": "^MID",      # Russell Midcap
    "VO": "^VEXMX",     # Mid-cap ETF (approximate)
    "VB": "^RUJ",       # Small-cap ETF

    # US Sector
    "XLK": "^SP500-45", # Technology
    "XLF": "^SP500-40", # Financial
    "XLV": "^SP500-35", # Healthcare
    "XLE": "^SP500-10", # Energy
    "XLY": "^SP500-30", # Consumer Discretionary
    "XLP": "^SP500-25", # Consumer Staples
    "XLI": "^SP500-20", # Industrial
    "XLB": "^SP500-15", # Materials
    "XLRE": "^SP500-50",# Real Estate
    "XLU": "^SP500-55", # Utilities
    "XLC": "^SP500-IT", # Communication Services

    # International
    "EFA": "^EFA",      # MSCI EAFE (developed international)
    "EEM": "^EEM",      # MSCI Emerging Markets
    "VEA": "^VEA",      # Vanguard Developed Markets
    "VWO": "^VWO",      # Vanguard Emerging Markets
    "VGK": "^VGK",      # Vanguard Europe
    "VPL": "^VPL",      # Vanguard Pacific

    # Bonds
    "TLT": "^TNX",      # Treasury 20+ Year (use 10Y yield as proxy)
    "IEF": "^FVX",      # Treasury 7-10 Year
    "SHY": "^IRX",      # Treasury 1-3 Year
    "AGG": "^AGG",      # Aggregate Bond (self)
    "BND": "^BND",      # Vanguard Total Bond (self)
    "LQD": "^LQD",      # Corporate Bond (self)
    "HYG": "^HYG",      # High Yield Corporate (self)
    "JNK": "^JNK",      # High Yield Junk (self)

    # Commodities
    "GLD": "GLD",       # Gold (use spot futures as proxy)
    "SLV": "SLV",       # Silver
    "GDX": "GDX",       # Gold Miners
    "USO": "CL=F",      # Oil (WTI Crude)
    "DBC": "DBC",       # Commodity Index (self)

    # Volatility
    "VXX": "^VIX",      # VIX (use index)
    "UVXY": "^VIX",     # VIX (2x leverage)

    # Nasdaq
    "QQQ": "^NDX",      # Nasdaq 100
    "QQQM": "^NDX",     # Invesco Nasdaq 100
    "VGT": "^VGT",      # Vanguard Information Technology
}


def get_benchmark_ticker(etf_symbol: str) -> str:
    """Get appropriate benchmark for ETF tracking error calculation."""
    return ETF_BENCHMARKS.get(etf_symbol.upper(), BENCHMARK_TICKER)


def detect_asset_type(ticker: yf.Ticker) -> str:
    """Detect if asset is stock, ETF, or crypto."""
    info = ticker.info
    if info.get('quoteType') == 'ETF':
        return 'ETF'
    elif info.get('quoteType') == 'CRYPTOCURRENCY':
        return 'CRYPTO'
    elif info.get('category') or info.get('holdings'):
        return 'ETF'
    return 'STOCK'


def get_benchmark_data(asset_hist: pd.DataFrame, asset_symbol: Optional[str] = None, for_tracking_error: bool = False) -> pd.Series:
    """Get benchmark returns aligned with asset dates.

    Args:
        asset_hist: Historical data for the asset
        asset_symbol: Ticker symbol (used to find correct benchmark for ETFs)
        for_tracking_error: If True, use ETF-specific benchmark for tracking error

    Returns:
        Series of benchmark returns
    """
    if asset_hist.empty:
        return pd.Series(dtype=float)

    # Get the date range from asset history
    start_date = asset_hist.index[0]
    end_date = asset_hist.index[-1]

    # Select appropriate benchmark
    if for_tracking_error and asset_symbol:
        benchmark_ticker = get_benchmark_ticker(asset_symbol)
    else:
        benchmark_ticker = BENCHMARK_TICKER

    # Fetch benchmark data for the same date range
    benchmark = yf.Ticker(benchmark_ticker)
    bench_hist = benchmark.history(start=start_date, end=end_date)

    if bench_hist.empty:
        return pd.Series(dtype=float)

    return bench_hist['Close'].pct_change().dropna()


def calculate_beta(asset_returns: pd.Series, benchmark_returns: pd.Series) -> Optional[float]:
    """Calculate beta against benchmark."""
    if len(benchmark_returns) < 10 or len(asset_returns) < 10:
        return None

    # Align the data by index (dates)
    aligned_data = pd.DataFrame({
        'asset': asset_returns,
        'benchmark': benchmark_returns
    }).dropna()

    if len(aligned_data) < 10:
        return None

    covariance = aligned_data['asset'].cov(aligned_data['benchmark'])
    benchmark_variance = aligned_data['benchmark'].var()

    if benchmark_variance == 0 or pd.isna(covariance) or pd.isna(benchmark_variance):
        return None

    return covariance / benchmark_variance


def calculate_52_week_range_percent(hist: pd.DataFrame, info: dict) -> Tuple[Optional[float], Optional[float]]:
    """Calculate 52-week range percentage (position within 52-week range)."""
    week_52_high = info.get('fiftyTwoWeekHigh', info.get('52WeekHigh'))
    week_52_low = info.get('fiftyTwoWeekLow', info.get('52WeekLow'))

    if pd.isna(week_52_high) or pd.isna(week_52_low) or week_52_high == week_52_low:
        return None, None

    current_price = hist['Close'].iloc[-1]

    # Calculate percentage position in range
    range_percent = ((current_price - week_52_low) / (week_52_high - week_52_low)) * 100

    # Calculate distance from high (% below high)
    percent_from_high = ((week_52_high - current_price) / week_52_high) * 100

    return range_percent, percent_from_high


def calculate_cagr(hist: pd.DataFrame, years: int) -> Optional[float]:
    """Calculate Compound Annual Growth Rate for specified period."""
    if len(hist) < 2:
        return None

    # Get data for the specified period
    period_data = hist.tail(min(int(252 * years), len(hist)))
    if len(period_data) < 2:
        return None

    start_price = period_data['Close'].iloc[0]
    end_price = period_data['Close'].iloc[-1]

    if start_price <= 0:
        return None

    # Calculate actual years in data
    actual_years = len(period_data) / 252

    cagr = (end_price / start_price) ** (1 / actual_years) - 1
    return cagr


def calculate_max_drawdown(hist: pd.DataFrame) -> Tuple[Optional[float], Optional[pd.Timestamp]]:
    """Calculate maximum drawdown and its date."""
    if len(hist) < 2:
        return None, None

    close_prices = hist['Close']
    rolling_max = close_prices.expanding().max()
    drawdown = (close_prices - rolling_max) / rolling_max

    max_dd = drawdown.min()
    max_dd_date = drawdown.idxmin()

    return max_dd, max_dd_date


def calculate_sharpe_ratio(returns: pd.Series, risk_free_rate: float = RISK_FREE_RATE) -> Optional[float]:
    """Calculate Sharpe Ratio (annualized)."""
    if len(returns) < 2:
        return None

    # Remove NaN values
    returns_clean = returns.dropna()
    if len(returns_clean) < 2:
        return None

    # Annualized return
    total_return = (1 + returns_clean).prod() - 1
    years = len(returns_clean) / 252
    annualized_return = (1 + total_return) ** (1 / years) - 1

    # Annualized volatility
    annualized_volatility = returns_clean.std() * np.sqrt(252)

    if annualized_volatility == 0:
        return None

    sharpe = (annualized_return - risk_free_rate) / annualized_volatility
    return sharpe


def calculate_downside_deviation(returns: pd.Series, risk_free_rate: float = RISK_FREE_RATE) -> Optional[float]:
    """Calculate downside deviation (only negative returns relative to risk-free rate)."""
    if len(returns) < 2:
        return None

    returns_clean = returns.dropna()
    if len(returns_clean) < 2:
        return None

    # Calculate daily risk-free rate
    daily_rf = (1 + risk_free_rate) ** (1 / 252) - 1

    # Calculate excess returns
    excess_returns = returns_clean - daily_rf

    # Only consider negative excess returns (downside)
    downside_returns = excess_returns[excess_returns < 0]

    if len(downside_returns) == 0:
        return 0.0

    # Calculate downside deviation (annualized)
    downside_deviation = np.sqrt((downside_returns ** 2).mean()) * np.sqrt(252)
    return downside_deviation


def calculate_rsi(hist: pd.DataFrame, period: int = 14) -> Optional[float]:
    """Calculate Relative Strength Index (RSI)."""
    if len(hist) < period + 1:
        return None

    close_prices = hist['Close']

    # Calculate price changes
    delta = close_prices.diff()

    # Separate gains and losses
    gains = delta.where(delta > 0, 0)
    losses = -delta.where(delta < 0, 0)

    # Calculate average gains and losses using Wilder's smoothing
    avg_gains = gains.rolling(window=period, min_periods=1).mean()
    avg_losses = losses.rolling(window=period, min_periods=1).mean()

    # Use the first period as simple average, then apply Wilder's smoothing
    first_avg_gain = gains.iloc[:period].mean()
    first_avg_loss = losses.iloc[:period].mean()

    if first_avg_loss == 0:
        return 100.0

    # Calculate RS (Relative Strength)
    rs = avg_gains.iloc[-1] / avg_losses.iloc[-1]

    # Calculate RSI
    rsi = 100 - (100 / (1 + rs))

    return rsi


def calculate_ma_cross(hist: pd.DataFrame) -> dict:
    """Calculate 50/200 Moving Averages and price position."""
    if len(hist) < 200:
        return {
            'ma50': None,
            'ma200': None,
            'price_vs_ma50': None,
            'price_vs_ma200': None,
            'ma50_vs_ma200': None,
            'trend': 'Insufficient data'
        }

    close_prices = hist['Close']
    current_price = close_prices.iloc[-1]

    ma50 = close_prices.rolling(window=50).mean().iloc[-1]
    ma200 = close_prices.rolling(window=200).mean().iloc[-1]

    # Price position vs MAs
    price_vs_ma50_pct = ((current_price - ma50) / ma50) * 100 if ma50 else None
    price_vs_ma200_pct = ((current_price - ma200) / ma200) * 100 if ma200 else None

    # MA50 vs MA200 (golden/death cross)
    if ma50 and ma200:
        ma50_vs_ma200_pct = ((ma50 - ma200) / ma200) * 100
        if ma50 > ma200:
            trend = "Golden Cross (Bullish)"
        else:
            trend = "Death Cross (Bearish)"
    else:
        ma50_vs_ma200_pct = None
        trend = "N/A"

    return {
        'ma50': ma50,
        'ma200': ma200,
        'price_vs_ma50': price_vs_ma50_pct,
        'price_vs_ma200': price_vs_ma200_pct,
        'ma50_vs_ma200': ma50_vs_ma200_pct,
        'trend': trend
    }


def calculate_macd(hist: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
    """Calculate MACD (Moving Average Convergence Divergence)."""
    if len(hist) < slow + signal:
        return {
            'macd': None,
            'macd_signal': None,
            'macd_histogram': None,
            'macd_trend': 'Insufficient data'
        }

    close_prices = hist['Close']

    # Calculate EMAs
    ema_fast = close_prices.ewm(span=fast, adjust=False).mean()
    ema_slow = close_prices.ewm(span=slow, adjust=False).mean()

    # MACD Line
    macd_line = ema_fast - ema_slow

    # Signal Line (9-period EMA of MACD)
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()

    # Histogram
    histogram = macd_line - signal_line

    # Get current values
    macd = macd_line.iloc[-1]
    macd_signal = signal_line.iloc[-1]
    macd_hist = histogram.iloc[-1]

    # Determine trend
    if macd is None or macd_signal is None:
        trend = 'N/A'
    elif macd > macd_signal and macd > 0:
        trend = "Strong Bullish"
    elif macd > macd_signal and macd < 0:
        trend = "Bullish Reversal"
    elif macd < macd_signal and macd > 0:
        trend = "Bearish Reversal"
    else:
        trend = "Strong Bearish"

    return {
        'macd': macd,
        'macd_signal': macd_signal,
        'macd_histogram': macd_hist,
        'macd_trend': trend
    }


def calculate_williams_r(hist: pd.DataFrame, period: int = 14) -> dict:
    """Calculate Williams %R indicator with multiple periods.

    Williams %R = (Highest High - Close) / (Highest High - Lowest Low) × -100
    Range: -100 to 0 (overbought: -20 to 0, oversold: -80 to -100)

    Periods:
    - 14: Standard period (most platforms, Finviz, TradingView)
    - 2: Short-term period (Investing.com default)
    """
    results = {}

    for p in [period, 2]:  # Calculate both requested period and period=2
        if len(hist) < p:
            results[f'williams_r_{p}'] = None
            results[f'williams_r_{p}_signal'] = 'Insufficient data'
            continue

        close_prices = hist['Close']
        high_prices = hist['High']
        low_prices = hist['Low']

        # Calculate rolling highest high and lowest low
        highest_high = high_prices.rolling(window=p).max()
        lowest_low = low_prices.rolling(window=p).min()

        # Calculate Williams %R
        williams_r = ((highest_high - close_prices) / (highest_high - lowest_low)) * -100

        # Get current value
        wr = williams_r.iloc[-1]

        # Determine signal
        if pd.isna(wr):
            signal = 'N/A'
        elif wr >= -20:
            signal = "Overbought"
        elif wr <= -80:
            signal = "Oversold"
        else:
            signal = "Neutral"

        results[f'williams_r_{p}'] = wr
        results[f'williams_r_{p}_signal'] = signal

    # Add primary result (using requested period, default 14)
    results['williams_r'] = results.get(f'williams_r_{period}')
    results['williams_r_signal'] = results.get(f'williams_r_{period}_signal')

    return results


def calculate_stoch(hist: pd.DataFrame, k_period: int = 14, d_period: int = 3, smoothing: int = 3) -> dict:
    """Calculate Stochastic Oscillator (Slow Stochastic).

    Fast %K = 100 × (Close - Lowest Low) / (Highest High - Lowest Low)
    Slow %K = SMA(Fast %K, smoothing)
    %D = SMA(Slow %K, d_period)
    Range: 0 to 100 (overbought: >80, oversold: <20)
    """
    if len(hist) < k_period + smoothing:
        return {
            'stoch_k': None,
            'stoch_d': None,
            'stoch_signal': 'Insufficient data'
        }

    close_prices = hist['Close']
    high_prices = hist['High']
    low_prices = hist['Low']

    # Calculate rolling highest high and lowest low
    highest_high = high_prices.rolling(window=k_period).max()
    lowest_low = low_prices.rolling(window=k_period).min()

    # Calculate Fast %K
    fast_k = 100 * (close_prices - lowest_low) / (highest_high - lowest_low)

    # Calculate Slow %K (smoothed)
    slow_k = fast_k.rolling(window=smoothing).mean()

    # Calculate %D (smoothed again)
    stoch_d = slow_k.rolling(window=d_period).mean()

    # Get current values
    k = slow_k.iloc[-1]
    d = stoch_d.iloc[-1]

    # Determine signal
    if pd.isna(k) or pd.isna(d):
        signal = 'N/A'
    elif k >= 80:
        signal = "Overbought"
    elif k <= 20:
        signal = "Oversold"
    elif k > d:
        signal = "Bullish crossover"
    elif k < d:
        signal = "Bearish crossover"
    else:
        signal = "Neutral"

    return {
        'stoch_k': k,
        'stoch_d': d,
        'stoch_signal': signal
    }


def calculate_stochrsi(hist: pd.DataFrame, rsi_period: int = 14, stoch_period: int = 14,
                       k_smoothing: int = 3, d_smoothing: int = 3) -> dict:
    """Calculate Stochastic RSI (StochRSI).

    StochRSI = (RSI - Lowest RSI over n-period) / (Highest RSI over n-period - Lowest RSI over n-period)
    %K = SMA(StochRSI, k_smoothing)
    %D = SMA(%K, d_smoothing)
    Range: 0 to 100 (overbought: >80, oversold: <20)
    """
    if len(hist) < rsi_period + stoch_period:
        return {
            'stochrsi_k': None,
            'stochrsi_d': None,
            'stochrsi_signal': 'Insufficient data'
        }

    # First calculate RSI
    rsi_values = hist['Close'].copy()

    # Calculate price changes
    delta = rsi_values.diff()

    # Separate gains and losses
    gains = delta.where(delta > 0, 0)
    losses = -delta.where(delta < 0, 0)

    # Calculate average gains and losses
    avg_gains = gains.rolling(window=rsi_period).mean()
    avg_losses = losses.rolling(window=rsi_period).mean()

    # Calculate RS and RSI
    rs = avg_gains / avg_losses
    rsi = 100 - (100 / (1 + rs))

    # Calculate StochRSI
    lowest_rsi = rsi.rolling(window=stoch_period).min()
    highest_rsi = rsi.rolling(window=stoch_period).max()

    stochrsi = (rsi - lowest_rsi) / (highest_rsi - lowest_rsi)

    # Apply smoothing to get %K
    stochrsi_k = stochrsi.rolling(window=k_smoothing).mean()

    # Calculate %D
    stochrsi_d = stochrsi_k.rolling(window=d_smoothing).mean()

    # Get current values
    k = stochrsi_k.iloc[-1]
    d = stochrsi_d.iloc[-1]

    # Determine signal
    if pd.isna(k) or pd.isna(d):
        signal = 'N/A'
    elif k >= 80:
        signal = "Overbought"
    elif k <= 20:
        signal = "Oversold"
    elif k > d:
        signal = "Bullish crossover"
    elif k < d:
        signal = "Bearish crossover"
    else:
        signal = "Neutral"

    return {
        'stochrsi_k': k,
        'stochrsi_d': d,
        'stochrsi_signal': signal
    }


def calculate_calmar_ratio(cagr: Optional[float], max_drawdown: Optional[float]) -> Optional[float]:
    """Calculate Calmar Ratio (CAGR / Max Drawdown)."""
    if cagr is None or max_drawdown is None:
        return None

    if max_drawdown == 0:
        return None

    # Calmar uses absolute value of max drawdown
    return cagr / abs(max_drawdown)


def calculate_ulcer_index(hist: pd.DataFrame) -> Optional[float]:
    """Calculate Ulcer Index (measures depth and duration of drawdowns)."""
    if len(hist) < 2:
        return None

    close_prices = hist['Close'].values

    # Calculate running maximum (peak) at each point
    running_max = np.maximum.accumulate(close_prices)

    # Calculate percentage drawdown from peak
    drawdown_pct = ((close_prices - running_max) / running_max) * 100

    # Square the drawdowns and calculate average
    squared_drawdowns = drawdown_pct ** 2
    ulcer_index = np.sqrt(np.mean(squared_drawdowns))

    return ulcer_index


def calculate_skewness(returns: pd.Series) -> Optional[float]:
    """Calculate skewness of returns distribution (asymmetry)."""
    if len(returns) < 3:
        return None

    returns_clean = returns.dropna()
    if len(returns_clean) < 3:
        return None

    return returns_clean.skew()


def calculate_kurtosis(returns: pd.Series) -> Optional[float]:
    """Calculate kurtosis of returns distribution (tail thickness)."""
    if len(returns) < 4:
        return None

    returns_clean = returns.dropna()
    if len(returns_clean) < 4:
        return None

    # pandas.kurt() returns excess kurtosis (kurtosis - 3)
    return returns_clean.kurt()


def calculate_up_down_capture(asset_returns: pd.Series, benchmark_returns: pd.Series) -> dict:
    """Calculate Up/Down Capture ratios vs benchmark."""
    # Align the data by index (dates)
    aligned_data = pd.DataFrame({
        'asset': asset_returns,
        'benchmark': benchmark_returns
    }).dropna()

    if len(aligned_data) < 10:
        return {
            'up_capture': None,
            'down_capture': None,
            'up_capture_ratio': None,
            'down_capture_ratio': None
        }

    # Separate up and down market periods
    up_periods = aligned_data[aligned_data['benchmark'] > 0]
    down_periods = aligned_data[aligned_data['benchmark'] < 0]

    # Calculate cumulative returns for up periods
    if len(up_periods) > 0:
        asset_up_return = (1 + up_periods['asset']).prod() - 1
        benchmark_up_return = (1 + up_periods['benchmark']).prod() - 1
        if benchmark_up_return != 0:
            up_capture = (asset_up_return / benchmark_up_return) * 100
        else:
            up_capture = None
    else:
        up_capture = None

    # Calculate cumulative returns for down periods
    if len(down_periods) > 0:
        asset_down_return = (1 + down_periods['asset']).prod() - 1
        benchmark_down_return = (1 + down_periods['benchmark']).prod() - 1
        if benchmark_down_return != 0:
            down_capture = (asset_down_return / benchmark_down_return) * 100
        else:
            down_capture = None
    else:
        down_capture = None

    # Interpret capture ratios
    if up_capture is not None:
        if up_capture >= 100:
            up_ratio = "Outperforms"
        elif up_capture >= 80:
            up_ratio = "Good"
        elif up_capture >= 50:
            up_ratio = "Weak"
        else:
            up_ratio = "Poor"
    else:
        up_ratio = None

    if down_capture is not None:
        if down_capture <= 80:
            down_ratio = "Protects"  # Less loss than benchmark = good
        elif down_capture <= 100:
            down_ratio = "Average"
        elif down_capture <= 120:
            down_ratio = "Weak"
        else:
            down_ratio = "Poor"  # More loss than benchmark = bad
    else:
        down_ratio = None

    return {
        'up_capture': up_capture,
        'down_capture': down_capture,
        'up_capture_ratio': up_ratio,
        'down_capture_ratio': down_ratio
    }


def calculate_premium_discount(current_price: float, nav_price: Optional[float]) -> Optional[float]:
    """Calculate Premium/Discount to NAV."""
    if nav_price is None or nav_price == 0:
        return None
    return ((current_price - nav_price) / nav_price) * 100


def calculate_tracking_error(etf_returns: pd.Series, benchmark_returns: pd.Series) -> Optional[float]:
    """Calculate Tracking Error (standard deviation of excess returns).

    Tracking error measures how closely an ETF follows its benchmark.
    Low tracking error (<0.5%) is good for index ETFs.
    """
    # Align the data
    aligned_data = pd.DataFrame({
        'etf': etf_returns,
        'benchmark': benchmark_returns
    }).dropna()

    if len(aligned_data) < 10:
        return None

    # Calculate excess returns (ETF - Benchmark)
    excess_returns = aligned_data['etf'] - aligned_data['benchmark']

    # Annualized standard deviation of excess returns (as decimal)
    tracking_error = excess_returns.std() * np.sqrt(252)

    return tracking_error


def calculate_sortino_ratio(returns: pd.Series, risk_free_rate: float = RISK_FREE_RATE) -> Optional[float]:
    """Calculate Sortino Ratio."""
    if len(returns) < 2:
        return None

    returns_clean = returns.dropna()
    if len(returns_clean) < 2:
        return None

    # Annualized return
    total_return = (1 + returns_clean).prod() - 1
    years = len(returns_clean) / 252
    annualized_return = (1 + total_return) ** (1 / years) - 1

    # Downside deviation
    downside_dev = calculate_downside_deviation(returns_clean, risk_free_rate)

    if downside_dev is None or downside_dev == 0:
        return None

    sortino = (annualized_return - risk_free_rate) / downside_dev
    return sortino


def get_liquidity_metrics(info: dict, hist: pd.DataFrame) -> dict:
    """Get bid/ask spread, volume, and open interest for trading assets."""
    metrics = {}

    # Bid/Ask prices
    bid = info.get('bid')
    ask = info.get('ask')

    if bid is not None and ask is not None:
        metrics['bid'] = bid
        metrics['ask'] = ask
        spread = ask - bid
        spread_pct = (spread / bid) * 100 if bid != 0 else None
        metrics['spread'] = spread
        metrics['spread_pct'] = spread_pct
    else:
        metrics['bid'] = None
        metrics['ask'] = None
        metrics['spread'] = None
        metrics['spread_pct'] = None

    # Previous close
    prev_close = info.get('previousClose')
    if prev_close:
        metrics['prev_close'] = prev_close
    else:
        metrics['prev_close'] = None

    # Volume
    volume = info.get('volume')
    if volume and volume > 0:
        metrics['volume'] = volume
    else:
        # Try from hist
        if not hist.empty and 'Volume' in hist.columns:
            metrics['volume'] = hist['Volume'].iloc[-1]
        else:
            metrics['volume'] = None

    # Open Interest (futures only)
    open_interest = info.get('openInterest')
    if open_interest and open_interest > 0:
        metrics['open_interest'] = open_interest
    else:
        metrics['open_interest'] = None

    return metrics


def calculate_risk_metrics(hist: pd.DataFrame, info: dict, asset_symbol: Optional[str] = None) -> dict:
    """Calculate all risk metrics for the asset.

    Args:
        hist: Historical price data
        info: Ticker info dictionary
        asset_symbol: Ticker symbol for ETF benchmark lookup
    """
    """Calculate all risk metrics for the asset."""
    daily_returns = hist['Close'].pct_change().dropna()

    metrics = {}

    # Liquidity metrics (bid/ask, volume, open interest)
    liquidity = get_liquidity_metrics(info, hist)
    metrics.update(liquidity)

    # Beta (requires sufficient data)
    if len(hist) >= 50:
        benchmark_returns = get_benchmark_data(hist)
        metrics['beta'] = calculate_beta(daily_returns, benchmark_returns)
    else:
        metrics['beta'] = None

    # 52 Week Range %
    range_pct, from_high = calculate_52_week_range_percent(hist, info)
    metrics['52w_range_percent'] = range_pct
    metrics['52w_percent_from_high'] = from_high

    # CAGR for different periods
    hist_5y = yf.Ticker(info.get('symbol', '')).history(period="5y")
    if not hist_5y.empty:
        metrics['cagr_1y'] = calculate_cagr(hist_5y, 1)
        metrics['cagr_3y'] = calculate_cagr(hist_5y, 3)
        metrics['cagr_5y'] = calculate_cagr(hist_5y, 5)
    else:
        metrics['cagr_1y'] = None
        metrics['cagr_3y'] = None
        metrics['cagr_5y'] = None

    # Max Drawdown
    max_dd, max_dd_date = calculate_max_drawdown(hist)
    metrics['max_drawdown'] = max_dd
    metrics['max_drawdown_date'] = max_dd_date

    # Sharpe Ratio
    metrics['sharpe_ratio'] = calculate_sharpe_ratio(daily_returns)

    # Sortino Ratio
    metrics['sortino_ratio'] = calculate_sortino_ratio(daily_returns)

    # Downside Deviation
    metrics['downside_deviation'] = calculate_downside_deviation(daily_returns)

    # RSI (14-period)
    metrics['rsi'] = calculate_rsi(hist)

    # 50/200 Moving Averages
    ma_metrics = calculate_ma_cross(hist)
    metrics.update(ma_metrics)

    # MACD
    macd_metrics = calculate_macd(hist)
    metrics.update(macd_metrics)

    # Williams %R
    williams_r_metrics = calculate_williams_r(hist)
    metrics.update(williams_r_metrics)

    # Stochastic Oscillator
    stoch_metrics = calculate_stoch(hist)
    metrics.update(stoch_metrics)

    # Stochastic RSI
    stochrsi_metrics = calculate_stochrsi(hist)
    metrics.update(stochrsi_metrics)

    # Calmar Ratio (using 3Y CAGR)
    max_dd, _ = calculate_max_drawdown(hist)
    hist_5y = yf.Ticker(info.get('symbol', '')).history(period="5y")
    if not hist_5y.empty:
        cagr_3y = calculate_cagr(hist_5y, 3)
        metrics['calmar_ratio'] = calculate_calmar_ratio(cagr_3y, max_dd)
    else:
        metrics['calmar_ratio'] = None

    # Ulcer Index
    metrics['ulcer_index'] = calculate_ulcer_index(hist)

    # Skewness (asymmetry of returns distribution)
    metrics['skewness'] = calculate_skewness(daily_returns)

    # Kurtosis (tail thickness)
    metrics['kurtosis'] = calculate_kurtosis(daily_returns)

    # Up/Down Capture (requires benchmark data)
    if len(hist) >= 50:
        benchmark_returns = get_benchmark_data(hist)
        capture_metrics = calculate_up_down_capture(daily_returns, benchmark_returns)
        metrics.update(capture_metrics)
    else:
        metrics['up_capture'] = None
        metrics['down_capture'] = None
        metrics['up_capture_ratio'] = None
        metrics['down_capture_ratio'] = None

    # ETF-specific metrics
    current_price = hist['Close'].iloc[-1]
    nav_price = info.get('navPrice')
    metrics['premium_discount'] = calculate_premium_discount(current_price, nav_price)

    # Tracking Error (for ETFs vs appropriate benchmark)
    if len(hist) >= 50 and asset_symbol:
        benchmark_returns = get_benchmark_data(hist, asset_symbol, for_tracking_error=True)
        metrics['tracking_error'] = calculate_tracking_error(daily_returns, benchmark_returns)
        # Store which benchmark was used
        metrics['tracking_error_benchmark'] = get_benchmark_ticker(asset_symbol)
    else:
        metrics['tracking_error'] = None
        metrics['tracking_error_benchmark'] = None

    return metrics

    return metrics


def print_risk_metrics_table(ticker_symbol: str, metrics: dict):
    """Print risk metrics as pandas DataFrame table."""
    # Interpret beta
    beta_val = metrics.get('beta')
    if beta_val is not None:
        if beta_val > 1.2:
            beta_interp = "High"
        elif beta_val < 0.8:
            beta_interp = "Low"
        elif beta_val < 0:
            beta_interp = "Inverse"
        else:
            beta_interp = "Market"
        beta_display = f"{beta_val:.2f} ({beta_interp})"
    else:
        beta_display = "N/A"

    # Interpret RSI
    rsi_val = metrics.get('rsi')
    if rsi_val is not None:
        if rsi_val >= 70:
            rsi_interp = "Overbought"
        elif rsi_val <= 30:
            rsi_interp = "Oversold"
        elif rsi_val >= 55:
            rsi_interp = "Bullish"
        elif rsi_val <= 45:
            rsi_interp = "Bearish"
        else:
            rsi_interp = "Neutral"
        rsi_display = f"{rsi_val:.1f} ({rsi_interp})"
    else:
        rsi_display = "N/A"

    # Format MA50/200
    ma50 = metrics.get('ma50')
    ma200 = metrics.get('ma200')
    if ma50 and ma200:
        ma_display = f"MA50: ${ma50:.2f} | MA200: ${ma200:.2f}"
    else:
        ma_display = "N/A"

    # Format price vs MA50
    price_vs_ma50 = metrics.get('price_vs_ma50')
    if price_vs_ma50 is not None:
        ma50_signal = "Above" if price_vs_ma50 > 0 else "Below"
        ma50_display = f"{price_vs_ma50:+.2f}% ({ma50_signal})"
    else:
        ma50_display = "N/A"

    # Format price vs MA200
    price_vs_ma200 = metrics.get('price_vs_ma200')
    if price_vs_ma200 is not None:
        ma200_signal = "Above" if price_vs_ma200 > 0 else "Below"
        ma200_status_display = f"{price_vs_ma200:+.2f}% ({ma200_signal})"
    else:
        ma200_status_display = "N/A"

    # Format MACD
    macd = metrics.get('macd')
    macd_signal = metrics.get('macd_signal')
    macd_hist = metrics.get('macd_histogram')
    if macd is not None and macd_signal is not None:
        macd_display = f"MACD: {macd:.4f} | Signal: {macd_signal:.4f}"
    else:
        macd_display = "N/A"

    if macd_hist is not None:
        hist_direction = "↑" if macd_hist > 0 else "↓"
        macd_hist_display = f"{macd_hist:+.4f} {hist_direction}"
    else:
        macd_hist_display = "N/A"

    # Format Up/Down Capture
    up_capture = metrics.get('up_capture')
    down_capture = metrics.get('down_capture')
    up_ratio = metrics.get('up_capture_ratio')
    down_ratio = metrics.get('down_capture_ratio')

    if up_capture is not None and up_ratio:
        up_capture_display = f"{up_capture:.0f}% ({up_ratio})"
    else:
        up_capture_display = "N/A"

    if down_capture is not None and down_ratio:
        down_capture_display = f"{down_capture:.0f}% ({down_ratio})"
    else:
        down_capture_display = "N/A"

    # Format Premium/Discount to NAV
    premium_discount = metrics.get('premium_discount')
    if premium_discount is not None:
        if premium_discount > 0:
            pd_display = f"{premium_discount:+.2f}% (Premium)"
        elif premium_discount < 0:
            pd_display = f"{premium_discount:+.2f}% (Discount)"
        else:
            pd_display = "0.00% (At NAV)"
    else:
        pd_display = "N/A"

    # Format Tracking Error
    tracking_error = metrics.get('tracking_error')
    te_benchmark = metrics.get('tracking_error_benchmark')
    if tracking_error is not None:
        if te_benchmark and te_benchmark != BENCHMARK_TICKER:
            te_display = f"{tracking_error:.2%} (vs {te_benchmark})"
        else:
            te_display = f"{tracking_error:.2%}"
    else:
        te_display = "N/A"

    # Format Williams %R (show both period 14 and period 2)
    williams_r_14 = metrics.get('williams_r_14')
    wr_signal_14 = metrics.get('williams_r_14_signal')
    williams_r_2 = metrics.get('williams_r_2')
    wr_signal_2 = metrics.get('williams_r_2_signal')

    if williams_r_14 is not None and williams_r_2 is not None:
        williams_r_display = f"P14: {williams_r_14:.1f} ({wr_signal_14}) | P2: {williams_r_2:.1f} ({wr_signal_2})"
    elif williams_r_14 is not None:
        williams_r_display = f"P14: {williams_r_14:.1f} ({wr_signal_14})"
    else:
        williams_r_display = "N/A"

    # Format Stochastic Oscillator
    stoch_k = metrics.get('stoch_k')
    stoch_d = metrics.get('stoch_d')
    stoch_signal = metrics.get('stoch_signal')
    if stoch_k is not None and stoch_d is not None:
        stoch_display = f"K: {stoch_k:.1f} | D: {stoch_d:.1f} ({stoch_signal})"
    else:
        stoch_display = "N/A"

    # Format Stochastic RSI
    stochrsi_k = metrics.get('stochrsi_k')
    stochrsi_d = metrics.get('stochrsi_d')
    stochrsi_signal = metrics.get('stochrsi_signal')
    if stochrsi_k is not None and stochrsi_d is not None:
        stochrsi_display = f"K: {stochrsi_k:.1f} | D: {stochrsi_d:.1f} ({stochrsi_signal})"
    else:
        stochrsi_display = "N/A"

    # Format Bid/Ask
    bid = metrics.get('bid')
    ask = metrics.get('ask')
    spread_pct = metrics.get('spread_pct')
    if bid is not None and ask is not None:
        if spread_pct is not None:
            bidask_display = f"Bid: ${bid:.2f} | Ask: ${ask:.2f} | Spread: {spread_pct:.3f}%"
        else:
            bidask_display = f"Bid: ${bid:.2f} | Ask: ${ask:.2f}"
    else:
        bidask_display = "N/A"

    # Format Volume
    volume = metrics.get('volume')
    if volume is not None and volume > 0:
        if volume >= 1_000_000:
            vol_display = f"{volume / 1_000_000:.1f}M"
        elif volume >= 1_000:
            vol_display = f"{volume / 1_000:.1f}K"
        else:
            vol_display = f"{volume:.0f}"
    else:
        vol_display = "N/A"

    # Format Open Interest
    open_interest = metrics.get('open_interest')
    if open_interest is not None and open_interest > 0:
        if open_interest >= 1_000_000:
            oi_display = f"{open_interest / 1_000_000:.1f}M"
        elif open_interest >= 1_000:
            oi_display = f"{open_interest / 1_000:.1f}K"
        else:
            oi_display = f"{open_interest:.0f}"
    else:
        oi_display = "N/A"

    # Format Previous Close
    prev_close = metrics.get('prev_close')
    if prev_close is not None:
        prev_close_display = f"${prev_close:.2f}"
    else:
        prev_close_display = "N/A"

    # Build DataFrame
    data = {
        "Metric": [
            "Bid/Ask",
            "Volume",
            "Open Interest",
            "Previous Close",
            "Beta",
            "52W Range %",
            "52W from High %",
            "Max Drawdown",
            "Max Drawdown Date",
            "Annual Volatility",
            "RSI (14)",
            "MA50/200",
            "Price vs MA50",
            "Price vs MA200",
            "MA Trend",
            "MACD",
            "MACD Histogram",
            "MACD Trend",
            "Williams %R (P14/P2)",
            "Stochastic (K/D)",
            "StochRSI (K/D)",
            "Sharpe Ratio",
            "Sortino Ratio",
            "Calmar Ratio",
            "Ulcer Index",
            "Skewness",
            "Kurtosis",
            "Up Capture",
            "Down Capture",
            "Premium/Discount to NAV",
            "Tracking Error",
            "Downside Deviation",
            "1Y CAGR",
            "3Y CAGR",
            "5Y CAGR",
        ],
        "Value": [
            bidask_display,
            vol_display,
            oi_display,
            prev_close_display,
            beta_display,
            f"{metrics.get('52w_range_percent'):.1f}%" if metrics.get('52w_range_percent') is not None else "N/A",
            f"{metrics.get('52w_percent_from_high'):.1f}%" if metrics.get('52w_percent_from_high') is not None else "N/A",
            f"{metrics.get('max_drawdown'):.2%}" if metrics.get('max_drawdown') is not None else "N/A",
            metrics.get('max_drawdown_date').strftime('%Y-%m-%d') if metrics.get('max_drawdown_date') else "N/A",
            metrics.get('annual_volatility', 'N/A'),
            rsi_display,
            ma_display,
            ma50_display,
            ma200_status_display,
            metrics.get('trend', 'N/A'),
            macd_display,
            macd_hist_display,
            metrics.get('macd_trend', 'N/A'),
            williams_r_display,
            stoch_display,
            stochrsi_display,
            f"{metrics.get('sharpe_ratio'):.2f}" if metrics.get('sharpe_ratio') is not None else "N/A",
            f"{metrics.get('sortino_ratio'):.2f}" if metrics.get('sortino_ratio') is not None else "N/A",
            f"{metrics.get('calmar_ratio'):.2f}" if metrics.get('calmar_ratio') is not None else "N/A",
            f"{metrics.get('ulcer_index'):.2f}" if metrics.get('ulcer_index') is not None else "N/A",
            f"{metrics.get('skewness'):.2f}" if metrics.get('skewness') is not None else "N/A",
            f"{metrics.get('kurtosis'):.2f}" if metrics.get('kurtosis') is not None else "N/A",
            up_capture_display,
            down_capture_display,
            pd_display,
            te_display,
            f"{metrics.get('downside_deviation'):.2%}" if metrics.get('downside_deviation') is not None else "N/A",
            f"{metrics.get('cagr_1y'):.2%}" if metrics.get('cagr_1y') is not None else "N/A",
            f"{metrics.get('cagr_3y'):.2%}" if metrics.get('cagr_3y') is not None else "N/A",
            f"{metrics.get('cagr_5y'):.2%}" if metrics.get('cagr_5y') is not None else "N/A",
        ]
    }

    df = pd.DataFrame(data)
    pd.set_option('display.max_rows', None)
    pd.set_option('display.max_columns', None)
    pd.set_option('display.width', None)

    print(f"\n{ticker_symbol}")
    print(df.to_string(index=False))
    print("-" * 40)


def analyze_crypto(ticker: yf.Ticker, hist: pd.DataFrame, metrics: dict):
    """Analyze cryptocurrency metrics."""
    current_price = hist['Close'].iloc[-1]
    daily_returns = hist['Close'].pct_change().dropna()
    annual_volatility = daily_returns.std() * (252 ** 0.5)
    metrics['annual_volatility'] = f"{annual_volatility:.2%}"

    print(f"Current Price:       ${current_price:.2f}")
    print(f"24h Change:          {ticker.info.get('regularMarketChangePercent', 'N/A')}%")

    print_risk_metrics_table(ticker.ticker, metrics)

    print(f"Market Cap:         ${ticker.info.get('marketCap', 0) / 1e9:.2f}B" if ticker.info.get('marketCap') else f"Market Cap:         N/A")
    print(f"24h Volume:          ${ticker.info.get('volume24Hr', 0) / 1e6:.2f}M" if ticker.info.get('volume24Hr') else f"24h Volume:          N/A")
    print(f"Circulating Supply: {ticker.info.get('circulatingSupply', 0) / 1e6:.2f}M" if ticker.info.get('circulatingSupply') else f"Circulating Supply: N/A")


def analyze_etf(ticker: yf.Ticker, hist: pd.DataFrame, info: dict, metrics: dict):
    """Analyze ETF metrics."""
    current_price = hist['Close'].iloc[-1]
    week_52_high = info.get('fiftyTwoWeekHigh', 'N/A')
    week_52_low = info.get('fiftyTwoWeekLow', 'N/A')
    daily_returns = hist['Close'].pct_change().dropna()
    annual_volatility = daily_returns.std() * (252 ** 0.5)
    metrics['annual_volatility'] = f"{annual_volatility:.2%}"

    print(f"Current Price:       ${current_price:.2f}")
    print(f"NAV Price:           ${info.get('navPrice', 'N/A')}")
    print(f"52 Week High:        ${week_52_high}")
    print(f"52 Week Low:         ${week_52_low}")

    print_risk_metrics_table(ticker.ticker, metrics)

    print(f"Dividend Yield:     {info.get('dividendYield', 'N/A')}")
    print(f"Expense Ratio:      {info.get('netExpenseRatio', 'N/A')}")
    print(f"52W Dividend Yield: {info.get('trailingAnnualDividendYield', 'N/A')}")

    print(f"Holdings Count:    {info.get('holdingsCount', 'N/A')}")
    print(f"Top 10 Holdings:   {info.get('top10Holdings', 'N/A')}")
    print(f"Top Holdings:      {info.get('topHoldings', 'N/A')}")

    print(f"Category:           {info.get('category', 'N/A')}")
    print(f"Fund Family:        {info.get('fundFamily', 'N/A')}")
    print(f"Assets Under Mgmt:  ${info.get('totalAssets', 'N/A')}")


def analyze_stock(ticker: yf.Ticker, hist: pd.DataFrame, info: dict, metrics: dict):
    """Analyze stock metrics."""
    current_price = hist['Close'].iloc[-1]
    week_52_high = info.get('fiftyTwoWeekHigh', info.get('52WeekHigh', 'N/A'))
    week_52_low = info.get('fiftyTwoWeekLow', info.get('52WeekLow', 'N/A'))

    daily_returns = hist['Close'].pct_change().dropna()
    annual_volatility = daily_returns.std() * (252 ** 0.5)
    metrics['annual_volatility'] = f"{annual_volatility:.2%}"

    print(f"Current Price:       ${current_price:.2f}")
    print(f"52 Week High:        ${week_52_high}")
    print(f"52 Week Low:         ${week_52_low}")

    print_risk_metrics_table(ticker.ticker, metrics)

    print(f"P/E Ratio:           {info.get('trailingPE', info.get('peRatio', 'N/A'))}")
    print(f"P/B Ratio:           {info.get('priceToBook', info.get('pbRatio', 'N/A'))}")
    print(f"PEG Ratio:           {info.get('pegRatio', 'N/A')}")

    roe = info.get('returnOnEquity', info.get('roe', 'N/A'))
    roa = info.get('returnOnAssets', info.get('roa', 'N/A'))
    print(f"ROE:                {roe if roe != 'N/A' else 'N/A'}")
    print(f"ROA:                {roa if roa != 'N/A' else 'N/A'}")
    print(f"Profit Margin:      {info.get('profitMargins', 'N/A')}")
    eps_t = info.get('trailingEps', 'N/A')
    eps_f = info.get('forwardEps', 'N/A')
    print(f"EPS (trailing):     ${eps_t if eps_t != 'N/A' else 'N/A'}")
    print(f"EPS (forward):      ${eps_f if eps_f != 'N/A' else 'N/A'}")

    print(f"Revenue Growth:     {info.get('revenueGrowth', 'N/A')}")
    print(f"EPS Growth (5y):    {info.get('earningsQuarterlyGrowth', 'N/A')}")

    print(f"Dividend Yield:     {info.get('dividendYield', 'N/A')}")
    print(f"Payout Ratio:       {info.get('payoutRatio', 'N/A')}")

    print(f"Debt-to-Equity:     {info.get('debtToEquity', 'N/A')}")
    print(f"Current Ratio:      {info.get('currentRatio', 'N/A')}")

    mc = info.get('marketCap', 0)
    print(f"Market Cap:         ${mc / 1e9:.2f}B" if mc else "Market Cap:         N/A")
    print(f"Sector:             {info.get('sector', 'N/A')}")
    print(f"Industry:           {info.get('industry', 'N/A')}")


def analyze_asset(ticker_symbol: str, period: str = "1y"):
    """Analyze asset metrics."""
    ticker = yf.Ticker(ticker_symbol)
    info = ticker.info

    # Get 5y historical data for CAGR calculations
    hist_5y = ticker.history(period="5y")

    # Historical data for risk metrics
    hist = ticker.history(period=period)
    if hist.empty:
        print(f"No data found for {ticker_symbol}")
        return

    asset_type = detect_asset_type(ticker)

    print(f"\n{ticker_symbol}")
    print(f"Type: {asset_type}\n")

    # Calculate risk metrics with 5y data for CAGR
    metrics = calculate_risk_metrics(hist, info | {'symbol': ticker_symbol}, asset_symbol=ticker_symbol)

    if asset_type == 'CRYPTO':
        analyze_crypto(ticker, hist, metrics)
    elif asset_type == 'ETF':
        analyze_etf(ticker, hist, info, metrics)
    else:
        analyze_stock(ticker, hist, info, metrics)


def main():
    """CLI entry point."""
    if len(sys.argv) < 2:
        print("Usage: uv run python scripts/yf-analyse-asset.py TICKER")
        print("Example: uv run python scripts/yf-analyse-asset.py AAPL")
        print("Supports: stocks (AAPL), ETFs (SCHD), crypto (BTC-USD)")
        sys.exit(1)

    ticker_symbol = sys.argv[1].upper()
    analyze_asset(ticker_symbol)


if __name__ == "__main__":
    main()
