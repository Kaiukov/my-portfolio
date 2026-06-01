# Database Schema

## transactions

| Column | Type | Description |
|---|---|---|
| id | SERIAL | Primary key |
| date | DATE | Transaction date |
| asset | VARCHAR(50) | Asset or cash ticker |
| action | VARCHAR(20) | Transaction action |
| quantity | DOUBLE PRECISION | Signed quantity |
| asset_type | VARCHAR(20) | Type classification |
| price | DOUBLE PRECISION | Price (null for cash actions) |
| currency | VARCHAR(10) | Transaction currency |
| fees | DOUBLE PRECISION | Fee amount |
| fee_currency | VARCHAR(10) | Fee currency (defaults to currency) |
| exchange | VARCHAR | Broker or exchange |
| data_source | VARCHAR | Source system |
| account | VARCHAR | Optional account label |
| created_at | TIMESTAMP | Auto-set on insert |
| updated_at | TIMESTAMP | Set on edit |

## daily_returns

| Column | Type | Description |
|---|---|---|
| date | DATE | Return date |
| total_value | DOUBLE PRECISION | Portfolio value |
| daily_return | DOUBLE PRECISION | Daily return percentage |
| investment_return | DOUBLE PRECISION | Return excluding cash flows |
| cash_balance | DOUBLE PRECISION | Cash component |
| deposits | DOUBLE PRECISION | External deposits |
| withdrawals | DOUBLE PRECISION | External withdrawals |
| income | DOUBLE PRECISION | Dividend/interest income |
| fees_taxes | DOUBLE PRECISION | Fees and taxes paid |
| net_contributions | DOUBLE PRECISION | deposits - withdrawals |

## price_cache

| Column | Type | Description |
|---|---|---|
| ticker | VARCHAR(20) | Asset ticker |
| date | DATE | Price date |
| close | DOUBLE PRECISION | Closing price |
| currency | VARCHAR(10) | Price currency |
| data_source | VARCHAR | Source (yfinance) |

## state

Key-value store: key VARCHAR(50), value TEXT. Tracks stale_data, price refresh state, recalculation state.
