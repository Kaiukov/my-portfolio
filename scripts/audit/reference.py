#!/usr/bin/env python3
"""Independent reference calculator for issue #226 audit fixture.

The fixture is intentionally USD-only so the reference can compute the financial
surface from first principles without depending on project SQL helpers.
"""

from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any


AS_OF = date(2026, 1, 5)
RF_ANNUAL = 0.02
INFLATION = 0.025
TRADING_DAYS = 252.0
CAGR_DAYS = 365.25
XIRR_DAYS = 365.0


@dataclass(frozen=True)
class Tx:
  dt: date
  asset: str
  action: str
  quantity: float
  price: float | None = None
  fees: float = 0.0


TRANSACTIONS = [
  Tx(date(2024, 1, 2), "USD", "DEPOSIT", 10000),
  Tx(date(2024, 1, 2), "AUDITAAA", "BUY", 50, 100, 10),
  Tx(date(2024, 1, 2), "AUDITBBB", "BUY", 20, 100, 5),
  Tx(date(2024, 6, 3), "USD", "DEPOSIT", 3000),
  Tx(date(2024, 9, 3), "USD", "DIVIDEND", 120),
  Tx(date(2024, 12, 2), "USD", "FEE", 50),
  Tx(date(2025, 3, 3), "AUDITBBB", "BUY", 10, 80, 4),
  Tx(date(2025, 6, 2), "AUDITAAA", "SELL", 20, 130, 6),
  Tx(date(2025, 9, 2), "USD", "WITHDRAW", 1000),
  Tx(date(2025, 12, 1), "USD", "DEPOSIT", 2000),
]

PRICES: dict[str, dict[date, float]] = {
  "AUDITAAA": {
    date(2024, 1, 2): 100, date(2024, 3, 1): 110, date(2024, 6, 3): 120,
    date(2024, 9, 3): 80, date(2024, 12, 2): 90, date(2025, 3, 3): 115,
    date(2025, 6, 2): 130, date(2025, 9, 2): 125, date(2025, 12, 1): 140,
    date(2026, 1, 5): 150,
  },
  "AUDITBBB": {
    date(2024, 1, 2): 100, date(2024, 3, 1): 95, date(2024, 6, 3): 90,
    date(2024, 9, 3): 70, date(2024, 12, 2): 75, date(2025, 3, 3): 80,
    date(2025, 6, 2): 85, date(2025, 9, 2): 95, date(2025, 12, 1): 100,
    date(2026, 1, 5): 105,
  },
  "SPY": {
    date(2024, 1, 2): 100, date(2024, 3, 1): 102, date(2024, 6, 3): 105,
    date(2024, 9, 3): 95, date(2024, 12, 2): 98, date(2025, 3, 3): 110,
    date(2025, 6, 2): 118, date(2025, 9, 2): 116, date(2025, 12, 1): 125,
    date(2026, 1, 5): 130,
  },
}


def daterange(start: date, end: date) -> list[date]:
  days = (end - start).days
  return [start + timedelta(days=i) for i in range(days + 1)]


def price_asof(ticker: str, dt: date) -> float:
  candidates = [pdate for pdate in PRICES[ticker] if pdate <= dt]
  if not candidates:
    raise ValueError(f"missing price for {ticker} as of {dt.isoformat()}")
  return PRICES[ticker][max(candidates)]


def portfolio_state_asof(dt: date) -> tuple[dict[str, float], float]:
  holdings: dict[str, float] = {}
  cash = 0.0
  for tx in TRANSACTIONS:
    if tx.dt > dt:
      continue
    if tx.action == "DEPOSIT":
      cash += tx.quantity
    elif tx.action == "WITHDRAW":
      cash -= tx.quantity
    elif tx.action in ("DIVIDEND", "INTEREST"):
      cash += tx.quantity
    elif tx.action in ("FEE", "TAX"):
      cash -= tx.quantity
    elif tx.action == "BUY":
      holdings[tx.asset] = holdings.get(tx.asset, 0.0) + tx.quantity
      cash -= tx.quantity * float(tx.price) + tx.fees
    elif tx.action == "SELL":
      holdings[tx.asset] = holdings.get(tx.asset, 0.0) - tx.quantity
      cash += tx.quantity * float(tx.price) - tx.fees
  return holdings, cash


def portfolio_value_asof(dt: date) -> float:
  holdings, cash = portfolio_state_asof(dt)
  return cash + sum(qty * price_asof(asset, dt) for asset, qty in holdings.items())


def cash_flow_impact(dt: date) -> float:
  impact = 0.0
  for tx in TRANSACTIONS:
    if tx.dt == dt and tx.action == "DEPOSIT":
      impact += tx.quantity
    elif tx.dt == dt and tx.action == "WITHDRAW":
      impact -= tx.quantity
  return impact


def daily_returns() -> list[dict[str, Any]]:
  rows = []
  prev = 0.0
  start = min(tx.dt for tx in TRANSACTIONS)
  for idx, dt in enumerate(daterange(start, AS_OF)):
    pv = portfolio_value_asof(dt)
    flow = 0.0 if idx == 0 else cash_flow_impact(dt)
    if idx == 0 or prev <= 0:
      pdr = 0.0
      inv = 0.0
    else:
      pdr = ((pv - prev) / prev) * 100.0
      inv = ((pv - prev - flow) / prev) * 100.0
    rows.append({
      "date": dt.isoformat(),
      "portfolio_value": pv,
      "portfolio_daily_return": pdr,
      "investment_return": inv,
      "cash_flow_impact": flow,
    })
    prev = pv
  return rows


def percentile_cont(values: list[float], p: float) -> float:
  ordered = sorted(values)
  if not ordered:
    return 0.0
  if len(ordered) == 1:
    return ordered[0]
  pos = 1.0 + (len(ordered) - 1.0) * p
  lower = math.floor(pos)
  upper = math.ceil(pos)
  frac = pos - lower
  low_val = ordered[lower - 1]
  up_val = ordered[upper - 1]
  return low_val + frac * (up_val - low_val)


def product_return(returns_pct: list[float]) -> float:
  product = 1.0
  for ret in returns_pct:
    product *= max(1.0 + ret / 100.0, 1e-12)
  return product - 1.0


def drawdown_stats(rows: list[dict[str, Any]]) -> tuple[float, float, float]:
  running_max = 0.0
  drawdowns: list[float] = []
  durations: list[float] = []
  current_duration = 0.0
  for row in rows:
    pv = float(row["portfolio_value"])
    running_max = max(running_max, pv)
    dd = ((running_max - pv) / running_max) * 100.0 if running_max > 0 else 0.0
    drawdowns.append(dd)
    if dd > 0:
      current_duration += 1.0
    elif current_duration > 0:
      durations.append(current_duration)
      current_duration = 0.0
  if current_duration > 0:
    durations.append(current_duration)
  positive = [dd for dd in drawdowns if dd > 0]
  return max(drawdowns), (sum(positive) / len(positive) if positive else 0.0), (sum(durations) / len(durations) if durations else 0.0)


def monthly_median(rows: list[dict[str, Any]]) -> float:
  by_month: dict[str, list[float]] = {}
  for row in rows:
    by_month.setdefault(str(row["date"])[:7], []).append(float(row["investment_return"]))
  returns = [product_return(vals) * 100.0 for vals in by_month.values()]
  return percentile_cont(returns, 0.5)


def benchmark_returns() -> tuple[list[dict[str, float | str]], float, float]:
  dates = sorted(dt for dt in PRICES["SPY"] if dt <= AS_OF)
  rows = []
  for prev, cur in zip(dates, dates[1:]):
    rows.append({
      "date": cur.isoformat(),
      "return_pct": ((PRICES["SPY"][cur] - PRICES["SPY"][prev]) / PRICES["SPY"][prev]) * 100.0,
    })
  spy_twr = (PRICES["SPY"][dates[-1]] - PRICES["SPY"][dates[0]]) / PRICES["SPY"][dates[0]]
  return rows, spy_twr, (AS_OF - dates[0]).days / CAGR_DAYS


def xnpv(rate: float, flows: list[tuple[date, float]]) -> float:
  ref = flows[0][0]
  return sum(amount / ((1.0 + rate) ** ((dt - ref).days / XIRR_DAYS)) for dt, amount in flows)


def xirr(flows: list[tuple[date, float]]) -> float:
  low = -0.9999
  high = 10.0
  f_low = xnpv(low, flows)
  f_high = xnpv(high, flows)
  while f_low * f_high > 0 and high <= 1000:
    high *= 2.0
    f_high = xnpv(high, flows)
  if f_low * f_high > 0:
    return 0.0
  for _ in range(200):
    mid = (low + high) / 2.0
    f_mid = xnpv(mid, flows)
    if abs(f_mid) < 1e-7 or (high - low) < 1e-7:
      return mid
    if f_low * f_mid <= 0:
      high = mid
    else:
      low = mid
      f_low = f_mid
  return (low + high) / 2.0


def fifo_metrics() -> tuple[float, float, float, list[dict[str, Any]]]:
  lots: dict[str, list[dict[str, float | date]]] = {}
  realized = 0.0
  details: list[dict[str, Any]] = []
  for index, tx in enumerate(TRANSACTIONS, start=1):
    if tx.action == "BUY":
      lots.setdefault(tx.asset, []).append({
        "id": float(index),
        "date": tx.dt,
        "remaining": tx.quantity,
        "unit_cost": (tx.quantity * float(tx.price) + tx.fees) / tx.quantity,
      })
    elif tx.action == "SELL":
      remaining = tx.quantity
      proceeds = tx.quantity * float(tx.price) - tx.fees
      for lot in lots.get(tx.asset, []):
        if remaining <= 0:
          break
        consume = min(float(lot["remaining"]), remaining)
        cost = consume * float(lot["unit_cost"])
        proceeds_share = proceeds * (consume / tx.quantity)
        gain = proceeds_share - cost
        realized += gain
        details.append({
          "sell_date": tx.dt.isoformat(),
          "asset": tx.asset,
          "sell_quantity": consume,
          "proceeds_usd": proceeds_share,
          "cost_basis_usd": cost,
          "realized_gain": gain,
          "matched_buy_date": lot["date"].isoformat(),
        })
        lot["remaining"] = float(lot["remaining"]) - consume
        remaining -= consume
  cost_basis = sum(float(lot["remaining"]) * float(lot["unit_cost"]) for asset_lots in lots.values() for lot in asset_lots)
  market_value = sum(float(lot["remaining"]) * price_asof(asset, AS_OF) for asset, asset_lots in lots.items() for lot in asset_lots)
  return cost_basis, realized, market_value - cost_basis, details


def performance(rows: list[dict[str, Any]]) -> dict[str, float | int | str]:
  inv = [float(row["investment_return"]) for row in rows]
  daily = [float(row["portfolio_daily_return"]) for row in rows]
  total_days = len(rows)
  start_value = float(rows[0]["portfolio_value"])
  end_value = float(rows[-1]["portfolio_value"])
  twr_decimal = product_return(inv)
  years = (date.fromisoformat(rows[-1]["date"]) - date.fromisoformat(rows[0]["date"])).days / CAGR_DAYS
  annual_return = ((1.0 + twr_decimal) ** (1.0 / years) - 1.0) if years > 0 else 0.0
  std_dev = statistics.pstdev(inv) if len(inv) > 1 else 0.0
  var_95 = percentile_cont(inv, 0.05)
  var_99 = percentile_cont(inv, 0.01)
  cvar_95 = statistics.fmean([ret for ret in inv if ret <= var_95])
  cvar_99 = statistics.fmean([ret for ret in inv if ret <= var_99])
  max_dd, avg_dd, avg_dd_duration = drawdown_stats(rows)
  bench, spy_twr, spy_years = benchmark_returns()
  bench_by_date = {str(row["date"]): float(row["return_pct"]) for row in bench}
  aligned = [(float(row["investment_return"]), bench_by_date[str(row["date"])]) for row in rows if str(row["date"]) in bench_by_date]
  avg_port = statistics.fmean(port for port, _ in aligned)
  avg_spy = statistics.fmean(spy for _, spy in aligned)
  covariance = statistics.fmean((port - avg_port) * (spy - avg_spy) for port, spy in aligned)
  variance_market = statistics.fmean((spy - avg_spy) ** 2 for _, spy in aligned)
  avg_excess = statistics.fmean(port - spy for port, spy in aligned)
  tracking_error_daily = math.sqrt(statistics.fmean((port - spy) ** 2 for port, spy in aligned))
  up_bench = sum(spy for _, spy in aligned if spy > 0)
  up_port = sum(port for port, spy in aligned if spy > 0)
  down_bench = sum(spy for _, spy in aligned if spy < 0)
  down_port = sum(port for port, spy in aligned if spy < 0)
  beta = covariance / variance_market if variance_market > 0 else 0.0
  hist_volatility = std_dev * math.sqrt(TRADING_DAYS)
  target_daily = (RF_ANNUAL / TRADING_DAYS) * 100.0
  downside_values = [(ret - target_daily) ** 2 for ret in inv if ret < target_daily]
  downside_dev = math.sqrt(statistics.fmean(downside_values)) if downside_values else 0.0
  spy_cagr = ((1.0 + spy_twr) ** (1.0 / spy_years) - 1.0) if spy_years > 0 else 0.0
  sharpe = (annual_return - RF_ANNUAL) / (hist_volatility / 100.0) if hist_volatility > 0 else 0.0
  sortino = ((statistics.fmean(inv) - target_daily) / downside_dev) * math.sqrt(TRADING_DAYS) if downside_dev > 0 else 0.0
  treynor = (annual_return - RF_ANNUAL) / beta if beta != 0 else 0.0
  information = ((avg_excess * TRADING_DAYS) / 100.0) / ((tracking_error_daily * math.sqrt(TRADING_DAYS)) / 100.0) if tracking_error_daily > 0 else 0.0
  jensen = (annual_return - (RF_ANNUAL + beta * (spy_cagr - RF_ANNUAL))) * 100.0
  relative = (annual_return - spy_cagr) * 100.0
  return {
    "total_days": total_days,
    "start_date": str(rows[0]["date"]),
    "end_date": str(rows[-1]["date"]),
    "start_value": start_value,
    "end_value": end_value,
    "total_gain": start_value * twr_decimal,
    "avg_daily_return": statistics.fmean(daily),
    "avg_investment_return": statistics.fmean(inv),
    "std_dev": std_dev,
    "hist_volatility": hist_volatility,
    "var_95": var_95,
    "var_99": var_99,
    "cvar_95": cvar_95,
    "cvar_99": cvar_99,
    "max_drawdown": max_dd,
    "avg_drawdown": avg_dd,
    "avg_drawdown_duration": avg_dd_duration,
    "time_weighted_return_pct": twr_decimal * 100.0,
    "total_return_pct": ((end_value - start_value) / start_value) * 100.0,
    "median_monthly_return": monthly_median(rows),
    "cagr": annual_return * 100.0,
    "beta": beta,
    "sharpe_ratio": sharpe,
    "sortino_ratio": sortino,
    "treynor_ratio": treynor,
    "information_ratio": information,
    "jensens_alpha": jensen,
    "relative_return": relative,
    "tracking_error": tracking_error_daily * math.sqrt(TRADING_DAYS),
    "spy_twr_pct": spy_twr * 100.0,
    "spy_cagr_pct": spy_cagr * 100.0,
    "up_capture_ratio": up_port / up_bench if up_bench != 0 else 0.0,
    "down_capture_ratio": down_port / down_bench if down_bench != 0 else 0.0,
    "calmar_ratio": (annual_return * 100.0) / abs(max_dd) if max_dd != 0 else 0.0,
    "real_cagr": ((1.0 + annual_return) / (1.0 + INFLATION) - 1.0) * 100.0,
    "real_total_return_pct": ((1.0 + ((end_value - start_value) / start_value)) / ((1.0 + INFLATION) ** years) - 1.0) * 100.0,
  }


def rounded(value: Any) -> Any:
  if isinstance(value, float):
    return round(value, 10)
  if isinstance(value, dict):
    return {key: rounded(val) for key, val in value.items()}
  if isinstance(value, list):
    return [rounded(item) for item in value]
  return value


def main() -> None:
  rows = daily_returns()
  perf = performance(rows)
  deposits = sum(tx.quantity for tx in TRANSACTIONS if tx.action == "DEPOSIT")
  withdrawals = sum(tx.quantity for tx in TRANSACTIONS if tx.action == "WITHDRAW")
  income = sum(tx.quantity for tx in TRANSACTIONS if tx.action in ("DIVIDEND", "INTEREST"))
  standalone_fees = sum(tx.quantity for tx in TRANSACTIONS if tx.action == "FEE")
  trade_fees = sum(tx.fees for tx in TRANSACTIONS)
  cost_basis, realized, unrealized, realized_rows = fifo_metrics()
  flows = []
  for tx in TRANSACTIONS:
    if tx.action == "DEPOSIT":
      flows.append((tx.dt, -tx.quantity))
    elif tx.action == "WITHDRAW":
      flows.append((tx.dt, tx.quantity))
  flows.append((AS_OF, float(perf["end_value"])))
  output = {
    "meta": {
      "as_of": AS_OF.isoformat(),
      "benchmark": "SPY",
      "risk_free_rate": RF_ANNUAL,
      "inflation_rate": INFLATION,
      "annualization": {"risk_trading_days": TRADING_DAYS, "cagr_days": CAGR_DAYS, "xirr_days": XIRR_DAYS},
    },
    "daily_returns": {
      "count": len(rows),
      "first_date": rows[0]["date"],
      "last_date": rows[-1]["date"],
      "checkpoints": [row for row in rows if row["date"] in {
        "2024-01-02", "2024-03-01", "2024-06-03", "2024-09-03", "2024-12-02",
        "2025-03-03", "2025-06-02", "2025-09-02", "2025-12-01", "2026-01-05",
      }],
    },
    "performance": perf,
    "mwr": xirr(flows),
    "status": {
      "deposits": deposits,
      "withdrawals": withdrawals,
      "income": income,
      "fees": standalone_fees + trade_fees,
      "taxes": 0.0,
      "total_invested": deposits - withdrawals,
      "portfolio_value": perf["end_value"],
      "total_gain": float(perf["end_value"]) - (deposits - withdrawals),
      "total_gain_pct": (float(perf["end_value"]) - (deposits - withdrawals)) / (deposits - withdrawals) * 100.0,
      "cost_basis": cost_basis,
      "realized_gain": realized,
      "unrealized_gain": unrealized,
      "total_profit": realized + unrealized,
    },
    "realized_gains": {
      "total": realized,
      "rows": realized_rows,
    },
  }
  out_path = Path(__file__).with_name("expected.json")
  out_path.write_text(json.dumps(rounded(output), indent=2, sort_keys=True) + "\n")
  print(out_path)


if __name__ == "__main__":
  main()
