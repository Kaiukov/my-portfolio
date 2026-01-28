# Relative Return (Alpha) Test Suite

## Test Overview

**Total Relative Return Tests: 22** ✅ All Passing

---

## Relative Return Test Categories

### 1. **Foundation Tests**
- ✅ `test_relative_return_positive_outperformance` - Portfolio beats benchmark (+5% alpha)
- ✅ `test_relative_return_negative_underperformance` - Portfolio underperforms (-2% alpha)
- ✅ `test_relative_return_breakeven` - Portfolio matches benchmark (0% alpha)

### 2. **Real-World Examples (Investopedia Data)**
- ✅ `test_relative_return_invesco_example_without_fees` - Fund: 30.48%, Benchmark: 18.65% → +11.83% alpha
- ✅ `test_relative_return_invesco_example_with_fees` - Fund: 22.97%, Benchmark: 18.65% → +4.32% alpha
- ✅ `test_relative_return_high_precision_fees_impact` - Fee impact: 11.83% → 4.32% (-7.51 pp)

### 3. **Market Context (Bull vs Bear)**
- ✅ `test_relative_return_bull_market_context` - 2% portfolio vs 20% market → -18% alpha (bad)
- ✅ `test_relative_return_bear_market_context` - 2% portfolio vs -20% market → +22% alpha (good)

### 4. **Performance Scenarios**
- ✅ `test_relative_return_margin_beater` - 10.5% portfolio vs 10% benchmark (+0.5% alpha)
- ✅ `test_relative_return_significant_underperformance` - 5% portfolio vs 15% benchmark (-10% alpha)
- ✅ `test_relative_return_s_p_500_benchmark` - 12% portfolio vs S&P 500: 10% (+2% alpha)

### 5. **Negative Market Scenarios**
- ✅ `test_relative_return_negative_portfolio_outperforms_worse` - -5% loss vs -10% loss → +5% alpha
- ✅ `test_relative_return_negative_portfolio_worse_than_benchmark` - -15% loss vs -10% loss → -5% alpha

### 6. **Precision & Formula Consistency**
- ✅ `test_relative_return_decimal_precision` - Maintains Decimal precision in calculations
- ✅ `test_relative_return_consistency_formula` - Validates formula across 5 scenarios

### 7. **Fund & Benchmark Variations**
- ✅ `test_relative_return_passive_fund_lower_than_benchmark` - Passive: 7.8% vs Benchmark: 8% (-0.2%)
- ✅ `test_relative_return_multiple_benchmarks_comparison` - Portfolio vs Tech Index vs Market Index
- ✅ `test_relative_return_zero_benchmark_return` - 5% portfolio vs 0% benchmark (+5%)
- ✅ `test_relative_return_negative_benchmark_zero_portfolio` - 0% portfolio vs -5% benchmark (+5%)

### 8. **Extreme Cases**
- ✅ `test_relative_return_extreme_positive_alpha` - 50% portfolio vs 10% benchmark (+40% alpha)
- ✅ `test_relative_return_extreme_negative_alpha` - -20% portfolio vs 10% benchmark (-30% alpha)

---

## Relative Return Formula

```
Relative Return (Alpha) = Portfolio Return - Benchmark Return

Interpretation:
- Positive α (+): Portfolio outperforms benchmark
- Negative α (-): Portfolio underperforms benchmark
- Zero α (0): Portfolio matches benchmark exactly
```

---

## Key Relative Return Concepts Tested

### ✅ Alpha Definition
Relative return = Alpha in active portfolio management
- Measures fund manager skill and outperformance
- Positive alpha indicates value creation above market
- Negative alpha indicates value destruction below market

### ✅ Market Context Matters
Same return different contexts:
- **Bull Market (20% market)**: 2% return = terrible (-18% alpha)
- **Bear Market (-20% market)**: 2% return = excellent (+22% alpha)
- Context determines if return is good or bad

### ✅ Transaction Costs Impact
Invesco Global Opportunities Fund example:
| Metric | Value | Calculation |
|--------|-------|-------------|
| Fund Return (no fees) | 30.48% | — |
| Fund Return (with fees) | 22.97% | -7.51 percentage points |
| Benchmark (MSCI) | 18.65% | — |
| Alpha (no fees) | 11.83% | 30.48% - 18.65% |
| Alpha (with fees) | 4.32% | 22.97% - 18.65% |

### ✅ Benchmark Selection
Different benchmarks, same portfolio:
- Portfolio: 12%
- Tech Index Benchmark: 15% → Relative Return: -3%
- Market Index Benchmark: 10% → Relative Return: +2%

### ✅ Fund Types
| Fund Type | Typical Pattern | Example |
|-----------|-----------------|---------|
| Passive (Index) | Slightly underperform | 7.8% vs 8% benchmark (-0.2%) |
| Active (Managed) | Variable | Can beat or underperform |
| Exceptional | Significant outperformance | 30.48% vs 18.65% (+11.83%) |

### ✅ Negative Market Preservation
In bear markets, losing less is actually winning:
- Portfolio: -5% loss, Market: -10% loss
- Relative Return: -5% - (-10%) = +5% alpha
- Preserving capital beats the market

---

## Test Run Commands

### Run All Relative Return Tests
```bash
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -k "relative_return" -v
```

### Run Specific Test Category
```bash
# Market context tests
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -k "bull_market or bear_market" -v

# Real-world examples
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -k "invesco" -v

# Extreme cases
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -k "extreme" -v
```

### Run All Return Metrics Tests (CAGR, TWR, MWR, Relative Return)
```bash
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -v
```

---

## Coverage Breakdown

| Category | Tests | Coverage |
|----------|-------|----------|
| Foundation | 3 | Basic alpha scenarios |
| Real Examples | 3 | Documented fund data |
| Market Context | 2 | Bull vs bear markets |
| Performance | 3 | Various outperformance levels |
| Negative Markets | 2 | Loss scenarios |
| Precision | 2 | Formula validation |
| Fund Types | 3 | Passive, active, benchmarks |
| Extreme | 2 | Boundary conditions |
| **Total** | **22** | **100%** |

---

## Sources & Documentation

- **Investopedia**: [Relative Return Definition](https://www.investopedia.com/terms/r/relativereturn.asp)
- **Implementation**: `src/portfolio.py:399-413` - `calculate_relative_return()` method
- **Alternative Name**: Alpha (in context of active portfolio management)
- **Real Example**: Invesco Global Opportunities Fund (Sept 30, 2017)

---

## Integration with Test Suite

Relative Return tests are part of the comprehensive performance metrics test suite:

- **CAGR Tests**: 15 tests
- **TWR Tests**: 13 tests
- **MWR Tests**: 15 tests
- **Relative Return Tests**: 22 tests
- **Other Tests**: 5 tests
- **Total**: 70 tests ✅ All Passing

Run all together:
```bash
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -v
```

---

## Example Test Scenarios

### Invesco Fund Without Fees
```python
# Fund: 30.48% return
# Benchmark: 18.65% return
# Alpha: 11.83%

# This is excellent outperformance
fund_return = Decimal("30.48")
benchmark_return = Decimal("18.65")
alpha = fund_return - benchmark_return  # 11.83%
```

### Invesco Fund With Fees
```python
# Fund: 22.97% return (after fees)
# Benchmark: 18.65% return
# Alpha: 4.32%

# Fees reduced alpha from 11.83% to 4.32%
# Fee impact: -7.51 percentage points
fund_return_with_fees = Decimal("22.97")
benchmark_return = Decimal("18.65")
alpha = fund_return_with_fees - benchmark_return  # 4.32%
```

### Bull Market Context
```python
# Portfolio: 2% return
# Bull Market (S&P 500): 20% return
# Alpha: -18%

# In bull market, 2% is terrible
portfolio_return = Decimal("2")
bull_market = Decimal("20")
alpha = portfolio_return - bull_market  # -18%
```

### Bear Market Context
```python
# Portfolio: 2% return (preserved capital!)
# Bear Market (S&P 500): -20% return
# Alpha: +22%

# In bear market, 2% is fantastic
portfolio_return = Decimal("2")
bear_market = Decimal("-20")
alpha = portfolio_return - bear_market  # +22%
```

---

## Key Insights

1. **Alpha is Contextual**: Same 2% return is terrible in bull markets, excellent in bear markets

2. **Fees Matter**: Invesco example shows fees reduce alpha by 7.51 percentage points (11.83% → 4.32%)

3. **Multiple Benchmarks**: Same portfolio can have +2% alpha vs one benchmark and -3% vs another

4. **Preservation is Victory**: In down markets, losing less (-5% vs -10%) = +5% alpha

5. **Formula Precision**: Simple but powerful: Portfolio Return - Benchmark Return = Alpha

6. **Manager Evaluation**: Relative return (alpha) is THE metric to evaluate active managers

---

## Notes

- Relative Return = Alpha in active portfolio management context
- **Positive alpha**: Fund manager adds value, deserves higher fees
- **Negative alpha**: Fund manager destroys value, consider index funds instead
- **Passive funds**: Typically -0.2% to -0.5% alpha due to operational expenses
- **Active funds**: Seek +1% to +3% alpha to justify higher management fees
- **Context matters**: Same return value has different meaning based on market conditions
- All tests validate **Decimal precision** for financial accuracy

---

## Related Metrics

| Metric | Purpose | Relationship to Relative Return |
|--------|---------|----------------------------------|
| Absolute Return | Portfolio standalone return | Numerator in relative calculation |
| Benchmark Return | Market performance | Denominator in relative calculation |
| Alpha | Outperformance vs market | **Same as Relative Return** |
| CAGR | Annualized growth over time | Can be compared (CAGR vs CAGR benchmark) |
| TWR | Time-weighted for manager comparison | Could have its own relative return |
| MWR | Investor-weighted return | Could be compared to benchmark MWR |
