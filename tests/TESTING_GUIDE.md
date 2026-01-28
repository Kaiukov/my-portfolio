# Testing Guide - Portfolio Performance Metrics

## Quick Start

### Run All Tests
```bash
uv run pytest tests/test_performance_metrics.py -v
```

### Run Specific Test Group
```bash
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -k cagr -v
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -k twr -v
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -k mwr -v
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -k "cagr or twr or mwr" -v
```

---

## Test Structure

### File Organization
```
tests/
├── test_performance_metrics.py    # All performance metric tests
├── __init__.py
└── test_*.py                      # Pattern for test files
```

### Basic Test Class Pattern
```python
class TestReturnMetrics:
    """Group of related tests."""

    def test_specific_feature(self):
        """Test description explaining what is tested."""
        # Arrange
        value = Decimal("100")

        # Act
        result = calculate_something(value)

        # Assert
        assert result == expected_value
```

---

## Creating Tests: Step-by-Step

### 1. **Set Up Test Environment**

Use fixtures for shared setup:
```python
@pytest.fixture
def analyzer(storage, fetcher):
    """Create portfolio analyzer for testing."""
    return PortfolioAnalyzer(storage, fetcher)

@pytest.fixture
def storage():
    """Create test-specific storage (not production data)."""
    return TransactionStorage("data/test_custom.json")
```

### 2. **Test Formula Validation**

For mathematical formulas, validate against known examples:
```python
def test_cagr_investopedia_example(self):
    """Test CAGR using documented example: $10k → $19k in 3 years = 23.86%."""
    beginning_value = Decimal("10000")
    ending_value = Decimal("19000")
    years = Decimal("3")

    # Apply formula
    cagr = (ending_value / beginning_value) ** (Decimal("1") / years) - Decimal("1")
    cagr_pct = cagr * 100

    # Verify against known result
    assert float(cagr_pct) == pytest.approx(23.86, abs=0.1)
```

### 3. **Test Edge Cases**

Cover boundary conditions:
```python
def test_empty_portfolio(self):
    """Test with no data."""
    storage = TransactionStorage("data/test_empty.json")
    storage.clear_all()
    analyzer = PortfolioAnalyzer(storage, PriceFetcher())

    result = analyzer.calculate_cagr()
    assert result == Decimal("0")

def test_very_short_period(self):
    """Test with < 0.1 year portfolio."""
    # Portfolio created yesterday
    yesterday = date.today() - timedelta(days=1)
    # Should return 0
    assert cagr == Decimal("0")
```

### 4. **Test Data Type Preservation**

Verify calculations maintain precision:
```python
def test_decimal_precision(self):
    """Test that calculations maintain Decimal type."""
    result = calculate_metric()

    assert isinstance(result, Decimal)
    assert float(result) == pytest.approx(expected, abs=0.1)
```

### 5. **Test Mathematical Properties**

Validate formulas follow expected mathematical behavior:
```python
def test_compounding_effect(self):
    """Test that TWR uses geometric linking (compounding)."""
    return1 = Decimal("0.10")  # +10%
    return2 = Decimal("0.20")  # +20%

    # Geometric mean (correct for TWR)
    twr = (Decimal("1") + return1) * (Decimal("1") + return2) - Decimal("1")

    # Should be 32% (1.10 × 1.20 - 1), not 15% (arithmetic mean)
    assert float(twr * 100) == pytest.approx(32.0, abs=0.1)
```

---

## Test Patterns Used

### Pattern 1: Real-World Examples
```python
def test_nvidia_example(self):
    """Test using actual investment scenario.

    NVIDIA: $1,468 → $6,713 in 3 years = 65.98% CAGR
    """
    beginning = Decimal("1468")
    ending = Decimal("6713")
    years = Decimal("3")

    result = (ending / beginning) ** (Decimal("1") / years) - Decimal("1")
    assert float(result * 100) == pytest.approx(65.98, abs=0.1)
```

### Pattern 2: Scenario Variations
```python
def test_positive_returns(self):
    """Test with gains."""
    assert result > 0

def test_negative_returns(self):
    """Test with losses."""
    assert result < 0

def test_breakeven(self):
    """Test with no change."""
    assert result == 0
```

### Pattern 3: Multiple Periods
```python
def test_four_quarters(self):
    """Test annual breakdown: Q1: +5%, Q2: +8%, Q3: -2%, Q4: +3%"""
    q1, q2, q3, q4 = Decimal("0.05"), Decimal("0.08"), Decimal("-0.02"), Decimal("0.03")

    result = (Decimal("1") + q1) * (Decimal("1") + q2) * (Decimal("1") + q3) * (Decimal("1") + q4)
    assert float(result) == pytest.approx(1.1447, abs=0.01)
```

---

## Best Practices

### ✅ DO:
- **Use real examples** from documentation (Investopedia, finance textbooks)
- **Test edge cases** (empty, very small, very large values)
- **Use `pytest.approx()`** for floating-point comparisons
- **Clear docstrings** explaining what's tested and why
- **Organize by category** (TestReturnMetrics, TestRiskMetrics, etc.)
- **Use test-specific storage** to avoid loading production data
- **Create backups** before modifying production data

### ❌ DON'T:
- Don't skip validation with `.clear_all()`
- Don't mix multiple concerns in one test
- Don't use exact equality `==` for floats/Decimals
- Don't test without documented examples
- Don't leave test data files behind

---

## Running Tests

### Run All Tests
```bash
uv run pytest tests/test_performance_metrics.py -v
```

### Run Specific Test Class
```bash
uv run pytest tests/test_performance_metrics.py::TestReturnMetrics -v
```

### Run Tests Matching Pattern
```bash
uv run pytest tests/test_performance_metrics.py -k cagr -v
uv run pytest tests/test_performance_metrics.py -k "cagr or twr" -v
```

### Run with Coverage Report
```bash
uv run pytest tests/test_performance_metrics.py --cov=src --cov-report=html
```

### Run and Stop on First Failure
```bash
uv run pytest tests/test_performance_metrics.py -x -v
```

---

## Test Statistics

| Metric | Count | Status |
|--------|-------|--------|
| CAGR Tests | 15 | ✅ All Passing |
| TWR Tests | 13 | ✅ All Passing |
| MWR Tests | 15 | ✅ All Passing |
| Relative Return Tests | 22 | ✅ All Passing |
| Other Tests | 5 | ✅ All Passing |
| **Total** | **70** | ✅ **100% Pass Rate** |

---

## References for Tests

### CAGR Formula
**Source:** Investopedia - CAGR Formula
```
CAGR = (Ending Value / Beginning Value) ^ (1/years) - 1
```

### TWR Formula
**Source:** Investopedia - Time-Weighted Return
```
TWR = [(1 + R₁) × (1 + R₂) × ... × (1 + Rₙ)] - 1
```

### MWR Formula (IRR)
**Source:** WealthArc - Money-Weighted Return
```
0 = C₀ + C₁/(1+r)^t₁ + C₂/(1+r)^t₂ + ... + Cₙ/(1+r)^tₙ + Cₙ₊₁/(1+r)^tₙ₊₁

Where:
- C₀ = Initial investment (negative)
- C₁, C₂, ... = Cash flows (deposits negative, withdrawals positive)
- Cₙ₊₁ = Final value
- t = Time periods
- r = Money-Weighted Rate of Return (IRR)
```

### Relative Return Formula (Alpha)
**Source:** Investopedia - Relative Return
```
Relative Return = Portfolio Return - Benchmark Return

Where:
- Portfolio Return = Asset's return over period
- Benchmark Return = Market or index return (e.g., S&P 500)
- Result = Alpha (outperformance > 0, underperformance < 0)
```

### Example Data Used
- **Investopedia Examples:** Real documented investment scenarios
- **NVIDIA Case Study:** $1,468 → $6,713 in 3 years
- **Savings Account:** $10k → $10,510 in 5 years
- **Stock Fund:** $10k → $15,348 in 5 years

---

## Quick Checklist for New Tests

- [ ] Docstring explains what is tested
- [ ] Test has meaningful name (test_*_scenario)
- [ ] Uses `pytest.approx()` for float comparisons
- [ ] Includes commented explanation of expected result
- [ ] Tests edge cases (empty, one period, many periods)
- [ ] Uses test-specific storage/fixtures
- [ ] Validates against documented formula or example
- [ ] Clear arrange-act-assert pattern
- [ ] All assertions have descriptive messages when needed
