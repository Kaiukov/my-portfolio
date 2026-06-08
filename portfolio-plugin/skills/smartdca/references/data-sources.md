# Smart DCA Data Sources

## Workflow order

1. Load `rules.md`
2. Fetch macro data
3. Fetch technicals
4. Check portfolio metrics
5. Compute the buy map
6. Route every unspent dollar to SGOV
7. Record the actual sources and timestamps

## Macro data

Primary command:

```bash
uv run --with yfinance python3 portfolio-plugin/skills/smartdca/scripts/macro_indicators.py
```

This fetches all 4 indicators (CAPE, Fear & Greed, UNRATE, SPX vs SMA200) and returns JSON with the regime, PEAK count, and per-indicator details.

Do not use `r.jina.ai` as a proxy or source.

### Per-indicator sources

**CAPE** — multpl.com is SSR (no JS required), parse with regex:

```bash
curl -s "https://www.multpl.com/shiller-pe" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" \
  | python3 -c "
import sys, re
html = sys.stdin.read()
m = re.search(r'Current Shiller PE Ratio[^0-9]*([0-9]+\.[0-9]+)', html)
print('CAPE:', m.group(1) if m else 'NOT FOUND')
"
```

PEAK threshold: CAPE > 30

**Fear & Greed** — CNN API requires `Referer` header:

```bash
curl -s "https://production.dataviz.cnn.io/index/fearandgreed/graphdata" \
  -H "Referer: https://edition.cnn.com/markets/fear-and-greed" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['fear_and_greed']['score'], d['fear_and_greed']['rating'])"
```

PEAK threshold: score > 75

**UNRATE** — FRED CSV, no auth:

```bash
curl -s "https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE" | tail -2
```

PEAK threshold: UNRATE ≤ 3.8. OK band: 3.8–4.8. Macro warning: > 4.8

**SPX vs SMA200** — yfinance:

```python
import yfinance as yf
hist = yf.download("^GSPC", period="1y", interval="1d", progress=False, auto_adjust=True)
closes = hist["Close"].dropna().squeeze().tolist()
price, sma200 = closes[-1], sum(closes[-200:]) / 200
print(f"SPX {price:.0f} vs SMA200 {sma200:.0f} → above={price > sma200}")
```

PEAK threshold: SPX < SMA200

## Technical data

Use the project's `asset_analysis` CLI command (replaces the old `yf-analyse-asset.py` that was intentionally not ported — the project already provides equivalent TypeScript analysis).

Run once per risk asset:

```bash
# From portfolio-ts/ (development)
bun src/cli.ts asset_analysis --ticker SPYM
bun src/cli.ts asset_analysis --ticker XLU
bun src/cli.ts asset_analysis --ticker SCHD

# Or via linked binary (global)
portfolio asset_analysis --ticker SPYM
portfolio asset_analysis --ticker XLU
portfolio asset_analysis --ticker SCHD
```

The output is JSON. Extract these fields for technical filter evaluation:

| Field | Filter usage |
|-------|-------------|
| `data.rsi` | RSI(14) value |
| `data.sma_90` or `data.ma_90` | 90-day simple moving average |
| `data.price` | Latest close price |

**Technical filter rules** (from `rules.md`):

- SPYM: `RSI(14) < 65 OR Price < SMA90` → pass, else fail
- XLU/SCHD: `RSI(14) < 58 OR Price < SMA90` → pass, else fail

If technical data cannot be fetched, say so explicitly and do not invent filter results.
