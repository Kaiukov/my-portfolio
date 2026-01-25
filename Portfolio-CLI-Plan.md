# Portfolio CLI App - Implementation Plan

## 🎯 Project Overview

**Goal**: Python CLI tool to track investment portfolio with multi-currency support
**MVP**: Display portfolio table (assets, quantity, purchase price, purchase currency)
**Approach**: Quick & dirty prototype → iterate and add features
**Data Storage**: JSON files
**APIs**: yfinance (stocks), Binance (crypto), Firefly exchange_rate (currency conversion)

---

## 📋 Stage 1: Portfolio Asset Table (MVP)

### Goal
Display a table of all assets with:
- Asset name/ticker
- Quantity owned
- Purchase price
- Purchase currency
- Current price (live)
- Current value in portfolio currency
- Unrealized P&L

### Deliverables

#### 1.1 Project Setup
- [ ] Create git repo: `portfolio-cli`
- [ ] Python 3.13 with `uv` package manager
- [ ] Initial dependencies: `requests`, `click` (CLI)
- [ ] Create `.env` template with API keys
- [ ] Directory structure:
  ```
  portfolio-cli/
  ├── src/
  │   ├── __init__.py
  │   ├── cli.py              # CLI entry point
  │   ├── portfolio.py        # Portfolio class
  │   ├── assets.py           # Asset management
  │   └── rates.py            # Exchange rates & prices
  ├── data/
  │   ├── assets.json         # Asset holdings
  │   └── transactions.json   # Transaction history
  ├── tests/
  │   ├── test_portfolio.py
  │   └── test_rates.py
  ├── .env.example
  ├── pyproject.toml
  └── README.md
  ```

#### 1.2 Data Model (JSON)
**File**: `data/assets.json`
```json
{
  "assets": [
    {
      "id": "BTC-1",
      "symbol": "BTC",
      "quantity": 0.5,
      "purchase_price": 45000,
      "purchase_currency": "USD",
      "purchase_date": "2024-06-15",
      "category": "crypto"
    },
    {
      "id": "AAPL-1",
      "symbol": "AAPL",
      "quantity": 10,
      "purchase_price": 150,
      "purchase_currency": "USD",
      "purchase_date": "2024-01-10",
      "category": "stock"
    }
  ],
  "base_currency": "USD",
  "portfolio_currency": "UAH"
}
```

#### 1.3 CLI Commands (Stage 1)
```bash
portfolio status              # Show portfolio table
portfolio add BTC 0.5 45000   # Add asset
portfolio list                # List all assets
portfolio show BTC            # Show asset details
```

#### 1.4 Core Modules

**`rates.py`** - Price & Exchange Rate Fetching
```python
class RatesFetcher:
  - get_stock_price(symbol) -> float  # yfinance
  - get_crypto_price(symbol) -> float # Binance
  - get_exchange_rate(from_cur, to_cur) -> float  # Firefly API
  - get_portfolio_rates() -> dict  # All needed rates
```

**`portfolio.py`** - Portfolio Logic
```python
class Portfolio:
  - load_assets()
  - add_asset(symbol, qty, price, currency)
  - get_portfolio_table()
  - calculate_total_value()
  - export_to_json()
```

**`cli.py`** - CLI Interface
```bash
@click.group()
def cli():
  pass

@cli.command()
def status():  # portfolio status
  # Show table with current prices and values

@cli.command()
@click.argument('symbol')
def show(symbol):  # portfolio show BTC
  # Show single asset details
```

#### 1.5 Environment Setup (`.env.example`)
```
# Firefly III
FIREFLY_API_URL=http://firefly.neon-chuckwalla.ts.net:8001
SYNC_SERVICE_API_KEY=uIh7mUVvMvpejQ24z4IAcHrwPTb7DRsg19pwjESg6RUeEH6lEy9PoLhfRfwaQxpV7k9bpvbGjAop5H5GzbAe2RF7b2ZAwVgAg5ve
SYNC_ANON_API_KEY=oiOBXKc0WAlqCFmKp6sxaciVGwfMBPVDsZ009vlccr6y2a3pQmhi2hk0aS4MZjFazKawKyW43ZeSYkXV7mIpjZ3s3ymEV3brP8Ra0EkSXMf8JzyP9AC9mSXq0DRAC0qeImaP6I5gVLuVD7w5iaAwCeGKfdywspKvZxtRrTwpTfw89CTflqYgI9hCsSfVH1HX895bpmSx

# Portfolio Settings
PORTFOLIO_BASE_CURRENCY=USD
PORTFOLIO_DISPLAY_CURRENCY=UAH
```

#### 1.6 Example Output
```bash
$ portfolio status

📊 Portfolio Summary
═══════════════════════════════════════════════════════════

Symbol  | Qty    | Buy Price | Buy Curr | Current  | UAH Value | P&L
────────┼────────┼───────────┼──────────┼──────────┼───────────┼──────
BTC     | 0.5    | 45,000    | USD      | 98,500   | 4,247,160 | +$26,750
AAPL    | 10     | 150       | USD      | 228      | 98,400    | +$780
ETH     | 2      | 2,500     | USD      | 3,850    | 331,776   | +$2,700
═══════════════════════════════════════════════════════════

Total Value: 4,677,336 UAH | Total P&L: +$30,230
```

---

## 📊 Stage 2-5 Roadmap (Post-MVP)

### Stage 2: Performance Analytics
- [ ] Add transaction history tracking
- [ ] Calculate returns (TWR, MWR, CAGR)
- [ ] Per-period returns (1D, 1W, 1M, YTD, 1Y, all-time)
- [ ] Command: `portfolio performance --period 1y`

### Stage 3: Risk Metrics
- [ ] Calculate volatility
- [ ] Sharpe ratio
- [ ] Max drawdown
- [ ] Beta calculation
- [ ] Command: `portfolio risk --benchmark SPY`

### Stage 4: Rebalancing Recommendations
- [ ] Define target allocation (e.g., 60% stocks, 40% crypto)
- [ ] Show current vs target distribution
- [ ] Generate rebalancing trades
- [ ] Command: `portfolio rebalance`

### Stage 5: Advanced Features
- [ ] Dividend tracking and forecasting
- [ ] Tax lot tracking (FIFO, LIFO)
- [ ] CSV export
- [ ] Dashboard/web UI
- [ ] Firefly III integration for transactions

---

## 🚀 Getting Started

### Development Steps
1. Create project structure
2. Initialize uv environment with Python 3.13
3. Create `assets.json` with sample data
4. Build `rates.py` with mock data first
5. Build `portfolio.py` - core logic
6. Build `cli.py` - user interface
7. Test manually with `uv run src/cli.py status`
8. Add pytest tests
9. Document with README

### Quick Start Command
```bash
# Create project
uv init portfolio-cli
cd portfolio-cli

# Create structure
mkdir -p src tests data

# Install dependencies
uv pip install click requests python-dotenv

# Test it
uv run src/cli.py status
```

---

## 🔗 Integration Points

| Component | API | Purpose |
|-----------|-----|---------|
| Stock Prices | yfinance | Real-time AAPL, MSFT, etc. |
| Crypto Prices | Binance API | Real-time BTC, ETH, etc. |
| Exchange Rates | Firefly III `/exchange_rate` | USD ↔ UAH, EUR, etc. |
| Persistence | JSON files | `data/assets.json` |

---

## ✅ Definition of Done (Stage 1)

- [x] Data model designed (assets.json)
- [x] rates.py fetches prices and exchange rates
- [x] portfolio.py loads and calculates totals
- [x] CLI commands work: `status`, `add`, `show`
- [x] Portfolio table displays correctly
- [x] `.env` configuration works
- [x] Manual testing passes
- [ ] Unit tests written
- [ ] README documentation done
- [ ] Git repo initialized with clean history

---

## 📝 Notes

- **Priority**: Get working code fast, polish later
- **Testing**: Start with manual testing, add pytest after MVP works
- **API Keys**: Already have Firefly creds, need to test yfinance and Binance
- **Error Handling**: Basic try/catch for API failures
- **Caching**: Consider caching prices (update every 5-15 min)
