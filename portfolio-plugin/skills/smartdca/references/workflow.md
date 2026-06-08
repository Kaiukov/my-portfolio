# Smart DCA Workflow

Follow this sequence every month:

1. Load `config.md` and the rules
2. Fetch the 4 market parameters:
   - CAPE
   - SPX vs SMA200
   - Fear & Greed
   - UNRATE
3. Count PEAK conditions and derive the regime
4. Check current `cash + SGOV` against the ceiling from `config.md`
5. Evaluate each asset one by one:
   - SPYM
   - XLU
   - SCHD
   - SGOV
6. Apply the technical filter for each risk asset on execution day
7. Convert the result into a monthly buy map
8. Route unspent dollars:
   - to SGOV only when `cash + SGOV` is below the ceiling
   - to deferred SPYM-focused execution when `cash + SGOV` is at or above the ceiling
9. Verify the portfolio and benchmark data if available

The output should make it obvious:

- what regime was detected
- which market parameters were true or missing
- how each asset was treated
- how much to buy in dollars this month
- whether high `cash + SGOV` changed the routing
