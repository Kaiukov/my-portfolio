# MWR (Money-Weighted Return) Test Suite

## Test Overview

**Total MWR Tests: 15** ✅ All Passing

---

## MWR Test Categories

### 1. **Foundation Tests**
- ✅ `test_mwr_empty_portfolio` - Empty portfolio returns 0
- ✅ `test_mwr_single_investment` - Basic single investment scenario ($1k→$1.1k = 10%)
- ✅ `test_mwr_no_growth` - Portfolio value equals total invested (0% return)

### 2. **Deposit Timing Impact**
- ✅ `test_mwr_early_deposit_impact` - Early deposits weighted more heavily
- ✅ `test_mwr_late_deposit_impact` - Late deposits weighted less heavily
- ✅ `test_mwr_multiple_deposits` - Multiple deposits at different times

### 3. **Withdrawal Handling**
- ✅ `test_mwr_withdrawal_timing` - Withdrawals reduce portfolio capital

### 4. **Comparison & Equivalence**
- ✅ `test_mwr_vs_twr_with_deposits` - MWR vs TWR comparison with cash flows
- ✅ `test_mwr_irr_equivalence` - MWR is equivalent to IRR calculation

### 5. **Return Scenarios**
- ✅ `test_mwr_negative_return` - Loss scenarios (-10% return)
- ✅ `test_mwr_breakeven_after_deposit` - 0% return with deposits

### 6. **Edge Cases & Precision**
- ✅ `test_mwr_very_short_period` - Portfolio < 0.1 years returns 0
- ✅ `test_mwr_decimal_precision` - Decimal type precision maintained

### 7. **Real-World Use Cases**
- ✅ `test_mwr_use_case_personal_investor` - Personal investor decision making
- ✅ `test_mwr_annual_calculation` - Annualized MWR over multiple years

---

## MWR Formula

```
0 = C₀ + C₁/(1+r)^t₁ + C₂/(1+r)^t₂ + ... + Cₙ/(1+r)^tₙ + Cₙ₊₁/(1+r)^tₙ₊₁

Where:
- C₀ = Initial investment (negative)
- C₁, C₂, ... = Cash flows (deposits negative, withdrawals positive)
- Cₙ₊₁ = Final value
- t = Time periods (in years)
- r = Money-Weighted Rate of Return (IRR)
```

---

## Key MWR Concepts Tested

### ✅ Cash Flow Timing Impact
MWR considers when deposits and withdrawals occur:
- **Early deposits** → weighted more → larger impact on return
- **Late deposits** → weighted less → smaller impact on return
- **Withdrawals** → reduce capital available to grow

### ✅ IRR Equivalence
MWR is the Internal Rate of Return (IRR) that makes NPV = 0

### ✅ Investor-Centric Metric
Shows the actual return an investor experiences based on:
- When they invest money
- How much they invest
- Final portfolio value

### ✅ Differences from TWR
| Aspect | MWR | TWR |
|--------|-----|-----|
| **Timing Impact** | ✅ Includes | ❌ Excludes |
| **Use Case** | Personal investor | Manager evaluation |
| **Cash Flows** | Weighted by time | Removed entirely |

---

## Test Run Commands

### Run All MWR Tests
```bash
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -k mwr -v
```

### Run All Return Metrics Tests (CAGR, TWR, MWR)
```bash
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -k "cagr or twr or mwr" -v
```

### Run Specific Test
```bash
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics::test_mwr_early_deposit_impact -v
```

---

## Coverage Breakdown

| Category | Tests | Coverage |
|----------|-------|----------|
| Foundation | 3 | Basic scenarios |
| Deposit Timing | 3 | Cash flow weight analysis |
| Withdrawals | 1 | Portfolio reduction |
| Comparisons | 2 | MWR vs other metrics |
| Returns | 2 | Positive/negative scenarios |
| Edge Cases | 2 | Boundaries & precision |
| Use Cases | 2 | Real-world applications |
| **Total** | **15** | **100%** |

---

## Sources & Documentation

- **WealthArc**: [Money-Weighted Return (MWR)](https://www.wealtharc.com/insights-articles/what-is-money-weighted-return-mwr-how-to-calculate-it)
- **Implementation**: `src/portfolio.py:359-397` - `calculate_mwr()` method
- **Alternative Name**: Internal Rate of Return (IRR)

---

## Integration with Test Suite

MWR tests are part of the comprehensive performance metrics test suite:

- **CAGR Tests**: 15 tests
- **TWR Tests**: 13 tests
- **MWR Tests**: 15 tests
- **Total**: 43 tests ✅ All Passing

Run all together:
```bash
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -v
```

---

## Example Test Scenarios

### Early Deposit Impact
```python
# Initial: $10,000
# Deposit: $1,000 at 6-month mark
# Final: $12,000

# Early deposit is weighted more (affects overall return more)
weighted_capital = 10,000 + (1,000 × 0.5)  # = 10,500
mwr_impact: Higher weight on this deposit
```

### Late Deposit Impact
```python
# Initial: $10,000
# Deposit: $1,000 at 11-month mark
# Final: $12,000

# Late deposit is weighted less (affects overall return less)
weighted_capital = 10,000 + (1,000 × 0.1)  # = 10,010
mwr_impact: Lower weight on this deposit
```

---

## Notes

- MWR is **ideal for personal investors** assessing their own performance
- MWR **cannot compare** different investment managers (use TWR instead)
- MWR **equals IRR** - they are mathematically equivalent
- MWR **considers deposit timing** - crucial for investor decision-making
- All tests validate **Decimal precision** for financial accuracy
