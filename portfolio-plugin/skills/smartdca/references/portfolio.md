# Smart DCA Portfolio Checks

## How to check portfolio state

Run the portfolio CLI from this repository. All commands emit pure JSON.

### Status (total value, invested, gain)

```bash
# From portfolio-ts/:
bun src/cli.ts status

# Or via linked binary:
portfolio status
```

### Allocation (cash / asset split)

```bash
portfolio allocation
```

### Cash + SGOV position

Cash is a separate currency in the portfolio. SGOV is a holding. Combine both:

```bash
portfolio cash
portfolio status  # shows total value; subtract invested for cash component
```

### Performance vs benchmark

```bash
portfolio performance --benchmark SPY
```

If `performance` fails due to price staleness, run the sync command first:

```bash
portfolio sync
```

### Technical data per asset

```bash
portfolio asset_analysis --ticker SPYM
portfolio asset_analysis --ticker XLU
portfolio asset_analysis --ticker SCHD
```

Always verify before the final answer if the portfolio CLI is available:

```bash
portfolio health
```

Report:

- status: value, invested, gain
- allocation: cash / asset split
- performance: returns, risk, and benchmark relation

If the portfolio is temporarily unavailable, say that directly.
