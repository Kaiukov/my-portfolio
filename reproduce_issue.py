
from src.prices import PriceFetcher

fetcher = PriceFetcher()

print("Checking EUR exchange rate...")
rate_eur = fetcher.get_exchange_rate("EUR", "USD")
print(f"EUR -> USD Rate: {rate_eur}")

print("\nChecking GBP exchange rate...")
rate_gbp = fetcher.get_exchange_rate("GBP", "USD")
print(f"GBP -> USD Rate: {rate_gbp}")
