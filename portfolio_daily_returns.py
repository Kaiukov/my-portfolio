import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta
import numpy as np

# Read transactions
df = pd.read_csv('yfiance-transactions/transactions.csv', sep=';')

# Parse dates - handle DD-MM-YYYY format
df['date'] = pd.to_datetime(df['date'], format='%d-%m-%Y')

# Sort by date
df = df.sort_values('date').reset_index(drop=True)

# Get date range
start_date = df['date'].min()
end_date = df['date'].max()

print(f"Portfolio period: {start_date.date()} to {end_date.date()}")
print(f"Total transactions: {len(df)}\n")

# Get unique assets
assets = df['asset'].unique()
print(f"Assets in portfolio: {assets}\n")

# Map assets to yfinance tickers
ticker_map = {}
for asset in assets:
    if asset == 'CASH EUR':
        ticker_map[asset] = 'EURUSD=X'
    elif asset == 'CASH USD':
        ticker_map[asset] = 'USD'
    elif asset == 'CASH GBP':
        ticker_map[asset] = 'GBPUSD=X'
    elif asset.endswith('.L'):
        ticker_map[asset] = asset
    elif asset.endswith('.DE'):
        ticker_map[asset] = asset
    else:
        ticker_map[asset] = asset

# Download historical prices for all assets
print("Downloading historical prices...")
prices_data = {}

for asset, ticker in ticker_map.items():
    try:
        if ticker == 'USD':
            prices_data[asset] = pd.Series(1.0, index=pd.date_range(start=start_date, end=end_date))
        else:
            data = yf.download(ticker, start=start_date - timedelta(days=10), end=end_date + timedelta(days=1), progress=False)
            if isinstance(data, pd.DataFrame):
                prices = data['Close']
            else:
                prices = data['Close']
            prices.index = pd.to_datetime(prices.index)
            prices_data[asset] = prices.sort_index()
            print(f"✓ {asset} ({ticker})")
    except Exception as e:
        print(f"✗ {asset} ({ticker}): {e}")

# Create daily portfolio
date_range = pd.date_range(start=start_date, end=end_date, freq='D')
holdings = {}

for date in date_range:
    holdings[date] = {}

# Process each transaction
for _, row in df.iterrows():
    trans_date = row['date']
    asset = row['asset']
    action = row['action'].lower()
    quantity = float(row['quantity'])

    if action == 'buy':
        for date in date_range:
            if date >= trans_date:
                if asset not in holdings[date]:
                    holdings[date][asset] = 0
                holdings[date][asset] += quantity
    elif action == 'sell':
        for date in date_range:
            if date >= trans_date:
                if asset not in holdings[date]:
                    holdings[date][asset] = 0
                holdings[date][asset] -= quantity
    elif action == 'deposit':
        for date in date_range:
            if date >= trans_date:
                if asset not in holdings[date]:
                    holdings[date][asset] = 0
                holdings[date][asset] += quantity

# Calculate portfolio value for each date
results = []

for date in date_range:
    total_value = 0.0

    for asset, quantity in holdings[date].items():
        if quantity == 0:
            continue

        if asset in prices_data:
            price_series = prices_data[asset]

            try:
                price_value = price_series.asof(pd.Timestamp(date))
                if isinstance(price_value, pd.Series):
                    price = price_value.iloc[0] if len(price_value) > 0 else None
                else:
                    price = price_value
            except:
                price = None

            if price is None or (isinstance(price, float) and np.isnan(price)):
                continue

            price = float(price)

            if asset.startswith('CASH'):
                asset_value = quantity
            elif asset.endswith('.L') or asset.endswith('.DE'):
                if asset.endswith('.L'):
                    try:
                        fx_data = yf.download('GBPUSD=X', start=date - timedelta(days=5), end=date, progress=False)
                        fx_rate = float(fx_data['Close'].iloc[-1]) if len(fx_data) > 0 else 1.3769
                    except:
                        fx_rate = 1.3769
                else:
                    try:
                        fx_data = yf.download('EURUSD=X', start=date - timedelta(days=5), end=date, progress=False)
                        fx_rate = float(fx_data['Close'].iloc[-1]) if len(fx_data) > 0 else 1.196
                    except:
                        fx_rate = 1.196
                asset_value = quantity * price * fx_rate
            else:
                asset_value = quantity * price

            total_value += float(asset_value)

    results.append({
        'date': date.date(),
        'portfolio_value': total_value
    })

# Calculate daily returns
results_df = pd.DataFrame(results)
results_df['portfolio_daily_return'] = results_df['portfolio_value'].pct_change() * 100

# Display results
print("\n" + "="*60)
print("PORTFOLIO ACCOUNT VALUE")
print("="*60 + "\n")

display_df = results_df[results_df['portfolio_value'] > 0].copy()
display_df['portfolio_daily_return'] = display_df['portfolio_daily_return'].fillna(0)

pd.set_option('display.max_rows', None)
pd.set_option('display.float_format', '{:.2f}'.format)

output_df = display_df[['date', 'portfolio_value', 'portfolio_daily_return']].copy()
output_df['portfolio_value'] = output_df['portfolio_value'].apply(lambda x: f'${x:,.2f}')
output_df['portfolio_daily_return'] = output_df['portfolio_daily_return'].apply(lambda x: f'{x:.2f}%')
print(output_df.to_string(index=False))

print("\n" + "="*60)
print(f"Total days tracked: {len(display_df)}")
print(f"Portfolio start date: {display_df['date'].iloc[0]}")
print(f"Portfolio end date: {display_df['date'].iloc[-1]}")

unformatted_df = results_df[results_df['portfolio_value'] > 0].copy()
print(f"Current portfolio value: ${unformatted_df['portfolio_value'].iloc[-1]:,.2f}")
print(f"Starting portfolio value: ${unformatted_df['portfolio_value'].iloc[0]:,.2f}")
print(f"Total gain/loss: ${unformatted_df['portfolio_value'].iloc[-1] - unformatted_df['portfolio_value'].iloc[0]:,.2f}")
print(f"Average daily return: {unformatted_df['portfolio_daily_return'].mean():.4f}%")
print("="*60)

# Save results to JSON
import json
output_data = []
for _, row in unformatted_df.iterrows():
    output_data.append({
        'date': str(row['date']),
        'portfolio_value': float(row['portfolio_value']),
        'portfolio_daily_return': float(row['portfolio_daily_return']) if pd.notna(row['portfolio_daily_return']) else 0.0
    })

with open('portfolio_daily_returns.json', 'w') as f:
    json.dump(output_data, f, indent=2)

print("\n✓ Results saved to portfolio_daily_returns.json")
