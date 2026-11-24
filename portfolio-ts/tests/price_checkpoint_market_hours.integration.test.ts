import { describe, expect, test } from "bun:test";
import { SQL } from "bun";

const DB_URL = process.env.PORTFOLIO_DB_URL;
const MAYBE_SKIP = DB_URL ? describe : describe.skip;

async function loadMissingCheckpoints(tx: any, asOf: string) {
  return await tx.unsafe(
    `SELECT c.ticker, c.checkpoint_date::text AS checkpoint_date
     FROM get_required_price_checkpoints_sql($1::date) c
     WHERE NOT EXISTS (
       SELECT 1
       FROM prices p
       WHERE p.ticker = c.ticker
         AND p.date = c.checkpoint_date
     )
     ORDER BY c.ticker, c.checkpoint_date`,
    [asOf],
  ) as Array<{ ticker: string; checkpoint_date: string }>;
}

async function loadCheckpoints(tx: any, asOf: string) {
  return await tx.unsafe(
    `SELECT ticker, checkpoint_date::text AS checkpoint_date
     FROM get_required_price_checkpoints_sql($1::date)
     ORDER BY ticker, checkpoint_date`,
    [asOf],
  ) as Array<{ ticker: string; checkpoint_date: string }>;
}

function sqlLiteralList(values: string[]) {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
}

async function assetType(tx: any, ticker: string) {
  const rows = (await tx.unsafe("SELECT get_asset_type_sql($1) AS t", [ticker])) as Array<{ t: string }>;
  return rows[0]?.t;
}

async function clearFixtureRows(tx: any, tickers: string[], dates: string[]) {
  const tickerList = sqlLiteralList(tickers);
  const dateList = sqlLiteralList(dates);
  await tx.unsafe(
    `DELETE FROM prices
     WHERE ticker IN (${tickerList})
       AND date IN (${dateList})`,
  );
  await tx.unsafe(
    `DELETE FROM transactions
     WHERE asset IN (${tickerList})
       AND date IN (${dateList})`,
  );
}

MAYBE_SKIP("integration: market-closed checkpoint filtering (#315, #318)", () => {
  test("Juneteenth fixture drops the false US holiday gap but keeps a real weekday gap", async () => {
    const sql = new SQL(DB_URL!, { max: 1 });
    try {
      await sql.begin(async (tx: any) => {
        await tx.unsafe("SAVEPOINT price_checkpoint_juneteenth");
        try {
          const tickers = ["TESTQQQ315", "TESTIWM315", "TESTVGEU315.DE", "EURUSD=X"];
          const dates = ["2026-06-17", "2026-06-18", "2026-06-19"];
          await clearFixtureRows(tx, tickers, dates);

          await tx.unsafe(`
            INSERT INTO transactions (date, asset, action, quantity, price, fees, currency, fee_currency, exchange)
            VALUES
              ('2026-06-17', 'TESTQQQ315',     'BUY', 10, 500, 0, 'USD', NULL, 'nasdaq'),
              ('2026-06-17', 'TESTVGEU315.DE', 'BUY',  5, 100, 0, 'EUR', NULL, 'xetra')
          `);

          await tx.unsafe(`
            INSERT INTO prices (ticker, date, price)
            VALUES
              ('TESTIWM315',     '2026-06-17', 220),
              ('TESTQQQ315',     '2026-06-18', 505),
              ('TESTIWM315',     '2026-06-18', 221),
              ('TESTVGEU315.DE', '2026-06-17', 100),
              ('TESTVGEU315.DE', '2026-06-18', 101),
              ('TESTVGEU315.DE', '2026-06-19', 102),
              ('EURUSD=X',       '2026-06-17', 1.12),
              ('EURUSD=X',       '2026-06-18', 1.11),
              ('EURUSD=X',       '2026-06-19', 1.10)
          `);

          const asOf = "2026-06-20";
          const checkpoints = await loadCheckpoints(tx, asOf);
          const missing = await loadMissingCheckpoints(tx, asOf);
          const qqqDates = checkpoints
            .filter((row) => row.ticker === "TESTQQQ315")
            .map((row) => row.checkpoint_date);
          const vgeuDates = checkpoints
            .filter((row) => row.ticker === "TESTVGEU315.DE")
            .map((row) => row.checkpoint_date);

          expect(qqqDates).toContain("2026-06-17");
          expect(qqqDates).toContain("2026-06-18");
          expect(qqqDates).not.toContain("2026-06-19");
          expect(vgeuDates).toContain("2026-06-17");
          expect(vgeuDates).toContain("2026-06-19");

          // Hand check:
          // - TESTQQQ315 on 2026-06-19 is NOT required because the US market bucket had no prints that day.
          // - TESTQQQ315 on 2026-06-17 IS still a real gap because TESTIWM315 proves the US bucket traded that day.
          expect(missing).toContainEqual({ ticker: "TESTQQQ315", checkpoint_date: "2026-06-17" });
          expect(missing).not.toContainEqual({ ticker: "TESTQQQ315", checkpoint_date: "2026-06-19" });
          expect(missing).not.toContainEqual({ ticker: "TESTVGEU315.DE", checkpoint_date: "2026-06-19" });
        } finally {
          await tx.unsafe("ROLLBACK TO SAVEPOINT price_checkpoint_juneteenth");
        }
      });
    } finally {
      await sql.end();
    }
  }, { timeout: 15000 });

  test("weekend FX fixture drops Saturday gaps but keeps a weekday same-group gap", async () => {
    const sql = new SQL(DB_URL!, { max: 1 });
    try {
      await sql.begin(async (tx: any) => {
        await tx.unsafe("SAVEPOINT price_checkpoint_weekend_fx");
        try {
          const tickers = ["EUR", "EURUSD=X", "GBPUSD=X"];
          const dates = ["2026-02-05", "2026-02-06", "2026-02-07"];
          await clearFixtureRows(tx, tickers, dates);

          await tx.unsafe(`
            INSERT INTO transactions (date, asset, action, quantity, price, fees, currency, fee_currency, exchange)
            VALUES
              ('2026-02-05', 'EUR', 'DEPOSIT', 1000, NULL, 0, 'USD', NULL, 'bank'),
              ('2026-02-07', 'EUR', 'DEPOSIT',  500, NULL, 0, 'USD', NULL, 'bank')
          `);

          await tx.unsafe(`
            INSERT INTO prices (ticker, date, price)
            VALUES
              ('GBPUSD=X', '2026-02-05', 1.25),
              ('EURUSD=X', '2026-02-06', 1.08),
              ('GBPUSD=X', '2026-02-06', 1.26)
          `);

          const asOf = "2026-02-07";
          const checkpoints = await loadCheckpoints(tx, asOf);
          const missing = await loadMissingCheckpoints(tx, asOf);
          const fxFixtureDates = checkpoints
            .filter((row) => row.ticker === "EURUSD=X" && row.checkpoint_date >= "2026-02-05" && row.checkpoint_date <= "2026-02-07")
            .map((row) => row.checkpoint_date);

          expect(fxFixtureDates).toContain("2026-02-05");
          expect(fxFixtureDates).toContain("2026-02-06");
          expect(fxFixtureDates).not.toContain("2026-02-07");

          // Hand check:
          // - 2026-02-07 is Saturday, so the FX bucket has no observed activity and the requirement is dropped.
          // - 2026-02-05 is a weekday with GBPUSD=X data, so EURUSD=X missing that day is a real gap.
          expect(missing).toContainEqual({ ticker: "EURUSD=X", checkpoint_date: "2026-02-05" });
          expect(missing).not.toContainEqual({ ticker: "EURUSD=X", checkpoint_date: "2026-02-07" });
        } finally {
          await tx.unsafe("ROLLBACK TO SAVEPOINT price_checkpoint_weekend_fx");
        }
      });
    } finally {
      await sql.end();
    }
  }, { timeout: 15000 });
});

// #360: bucket-level activity used to resurrect weekend checkpoints. A single
// Saturday print from any ticker in the pricing bucket (bare crypto symbols land
// in stock_usd; dirty FX rows land in cash_fx) made every other ticker in that
// bucket require a Saturday close, which no market produces.
MAYBE_SKIP("integration: #360 weekend checkpoints are not valuation points", () => {
  test("Saturday equity trades map to the prior trading day even when a 24/7 ticker prints in the same bucket", async () => {
    const sql = new SQL(DB_URL!, { max: 1 });
    try {
      await sql.begin(async (tx: any) => {
        await tx.unsafe("SAVEPOINT price_checkpoint_360_qqq");
        try {
          const tickers = ["TESTQQQ360", "TESTETH360", "TESTIWM360"];
          const dates = ["2025-10-23", "2025-10-24", "2025-10-25", "2026-01-29", "2026-01-30", "2026-01-31"];
          await clearFixtureRows(tx, tickers, dates);

          await tx.unsafe(`
            INSERT INTO transactions (date, asset, action, quantity, price, fees, currency, fee_currency, exchange)
            VALUES
              ('2025-10-25', 'TESTQQQ360', 'BUY', 10, 305, 0, 'USD', NULL, 'nasdaq'),
              ('2026-01-31', 'TESTQQQ360', 'BUY',  5, 311, 0, 'USD', NULL, 'nasdaq')
          `);

          await tx.unsafe(`
            INSERT INTO prices (ticker, date, price)
            VALUES
              ('TESTQQQ360',   '2025-10-23', 300),
              ('TESTQQQ360',   '2025-10-24', 302),
              ('TESTQQQ360',   '2026-01-29', 309),
              ('TESTQQQ360',   '2026-01-30', 310),
              -- bare 'TESTETH360' falls back to stock_usd, so its 24/7 prints land in the US bucket
              ('TESTETH360',   '2025-10-24', 4010),
              ('TESTETH360',   '2025-10-25', 4020),
              ('TESTETH360',   '2026-01-30', 3000),
              ('TESTETH360',   '2026-01-31', 3010)
          `);

          const asOf = "2026-11-24";
          const checkpoints = await loadCheckpoints(tx, asOf);
          const missing = await loadMissingCheckpoints(tx, asOf);
          const qqqDates = checkpoints
            .filter((row) => row.ticker === "TESTQQQ360")
            .map((row) => row.checkpoint_date);

          expect(await assetType(tx, "TESTETH360")).toBe("stock_usd");

          // Saturday trades are valued at Friday's close, so that is the checkpoint.
          expect(qqqDates).toContain("2025-10-24");
          expect(qqqDates).toContain("2026-01-30");
          expect(qqqDates).not.toContain("2025-10-25");
          expect(qqqDates).not.toContain("2026-01-31");

          expect(missing).not.toContainEqual({ ticker: "TESTQQQ360", checkpoint_date: "2025-10-25" });
          expect(missing).not.toContainEqual({ ticker: "TESTQQQ360", checkpoint_date: "2026-01-31" });
        } finally {
          await tx.unsafe("ROLLBACK TO SAVEPOINT price_checkpoint_360_qqq");
        }
      });
    } finally {
      await sql.end();
    }
  }, { timeout: 15000 });

  test("Saturday FX trade does not require a Saturday quote while a dirty same-bucket weekend row exists", async () => {
    const sql = new SQL(DB_URL!, { max: 1 });
    try {
      await sql.begin(async (tx: any) => {
        await tx.unsafe("SAVEPOINT price_checkpoint_360_fx");
        try {
          const tickers = ["EUR", "EURUSD=X", "GBPUSD=X"];
          const dates = ["2026-03-19", "2026-03-20", "2026-03-21"];
          await clearFixtureRows(tx, tickers, dates);

          await tx.unsafe(`
            INSERT INTO transactions (date, asset, action, quantity, price, fees, currency, fee_currency, exchange)
            VALUES
              ('2026-03-19', 'EUR', 'DEPOSIT', 1000, NULL, 0, 'USD', NULL, 'bank'),
              ('2026-03-21', 'EUR', 'DEPOSIT',  500, NULL, 0, 'USD', NULL, 'bank')
          `);

          await tx.unsafe(`
            INSERT INTO prices (ticker, date, price)
            VALUES
              ('EURUSD=X', '2026-03-19', 1.08),
              ('EURUSD=X', '2026-03-20', 1.09),
              -- dirty weekend FX row: proves the bucket is "active", not that EURUSD traded
              ('GBPUSD=X', '2026-03-20', 1.27),
              ('GBPUSD=X', '2026-03-21', 1.28)
          `);

          const asOf = "2026-03-21";
          const checkpoints = await loadCheckpoints(tx, asOf);
          const missing = await loadMissingCheckpoints(tx, asOf);
          const fxDates = checkpoints
            .filter((row) => row.ticker === "EURUSD=X")
            .map((row) => row.checkpoint_date);

          expect(fxDates).toContain("2026-03-19");
          expect(fxDates).toContain("2026-03-20");
          expect(fxDates).not.toContain("2026-03-21");

          expect(missing).not.toContainEqual({ ticker: "EURUSD=X", checkpoint_date: "2026-03-21" });
        } finally {
          await tx.unsafe("ROLLBACK TO SAVEPOINT price_checkpoint_360_fx");
        }
      });
    } finally {
      await sql.end();
    }
  }, { timeout: 15000 });

  test("a Saturday trade still surfaces a real gap on its valuation (Friday) close", async () => {
    const sql = new SQL(DB_URL!, { max: 1 });
    try {
      await sql.begin(async (tx: any) => {
        await tx.unsafe("SAVEPOINT price_checkpoint_360_gap");
        try {
          const tickers = ["TESTQQQ360", "TESTIWM360"];
          const dates = ["2026-01-28", "2026-01-29", "2026-01-30", "2026-01-31", "2026-02-02"];
          await clearFixtureRows(tx, tickers, dates);

          await tx.unsafe(`
            INSERT INTO transactions (date, asset, action, quantity, price, fees, currency, fee_currency, exchange)
            VALUES
              ('2026-01-29', 'TESTQQQ360', 'BUY', 10, 309, 0, 'USD', NULL, 'nasdaq'),
              ('2026-01-31', 'TESTQQQ360', 'BUY',  5, 311, 0, 'USD', NULL, 'nasdaq')
          `);

          // The US bucket traded on 01-29, 01-30 and 02-02, but TESTQQQ360 has no prints for any of them.
          // 02-02 is the bucket's latest print, so 01-30 can only be required by mapping the Saturday trade.
          await tx.unsafe(`
            INSERT INTO prices (ticker, date, price)
            VALUES
              ('TESTQQQ360', '2026-01-28', 308),
              ('TESTIWM360', '2026-01-29', 220),
              ('TESTIWM360', '2026-01-30', 221),
              ('TESTIWM360', '2026-02-02', 222)
          `);

          const asOf = "2026-02-02";
          const checkpoints = await loadCheckpoints(tx, asOf);
          const missing = await loadMissingCheckpoints(tx, asOf);
          const qqqDates = checkpoints
            .filter((row) => row.ticker === "TESTQQQ360")
            .map((row) => row.checkpoint_date);

          expect(qqqDates).toContain("2026-01-29");
          expect(qqqDates).toContain("2026-01-30");
          expect(missing).toContainEqual({ ticker: "TESTQQQ360", checkpoint_date: "2026-01-29" });
          expect(missing).toContainEqual({ ticker: "TESTQQQ360", checkpoint_date: "2026-01-30" });
          expect(missing).not.toContainEqual({ ticker: "TESTQQQ360", checkpoint_date: "2026-01-31" });
        } finally {
          await tx.unsafe("ROLLBACK TO SAVEPOINT price_checkpoint_360_gap");
        }
      });
    } finally {
      await sql.end();
    }
  }, { timeout: 15000 });

  test("crypto keeps 24/7 checkpoints while equities do not require weekend closes", async () => {
    const sql = new SQL(DB_URL!, { max: 1 });
    try {
      await sql.begin(async (tx: any) => {
        await tx.unsafe("SAVEPOINT price_checkpoint_360_crypto");
        try {
          const tickers = ["TESTETHUSD360-USD", "TESTQQQ360", "TESTETH360", "TESTBTC360-USD"];
          const dates = ["2026-02-05", "2026-02-06", "2026-02-07"];
          await clearFixtureRows(tx, tickers, dates);

          await tx.unsafe(`
            INSERT INTO transactions (date, asset, action, quantity, price, fees, currency, fee_currency, exchange)
            VALUES
              ('2026-02-07', 'TESTETHUSD360-USD', 'BUY', 2, 2500, 0, 'USD', NULL, 'kraken'),
              ('2026-02-07', 'TESTQQQ360',        'BUY', 1,  305, 0, 'USD', NULL, 'nasdaq')
          `);

          await tx.unsafe(`
            INSERT INTO prices (ticker, date, price)
            VALUES
              -- crypto trades 24/7: the bucket printed on Saturday, our ticker did not -> real 24/7 gap
              ('TESTBTC360-USD',    '2026-02-07', 60000),
              ('TESTETHUSD360-USD', '2026-02-05', 2480),
              ('TESTETHUSD360-USD', '2026-02-06', 2490),
              -- equity bucket: Friday close is what the Saturday trade needs
              ('TESTQQQ360', '2026-02-06', 304),
              -- bare symbol lands in stock_usd and prints on Saturday
              ('TESTETH360', '2026-02-06', 2495),
              ('TESTETH360', '2026-02-07', 2505)
          `);

          const asOf = "2026-02-09";
          const checkpoints = await loadCheckpoints(tx, asOf);
          const missing = await loadMissingCheckpoints(tx, asOf);
          const cryptoDates = checkpoints
            .filter((row) => row.ticker === "TESTETHUSD360-USD")
            .map((row) => row.checkpoint_date);
          const qqqDates = checkpoints
            .filter((row) => row.ticker === "TESTQQQ360")
            .map((row) => row.checkpoint_date);

          expect(await assetType(tx, "TESTETHUSD360-USD")).toBe("crypto");

          // crypto trades on Saturday, so the missing Saturday print must stay visible
          expect(cryptoDates).toContain("2026-02-07");
          expect(missing).toContainEqual({ ticker: "TESTETHUSD360-USD", checkpoint_date: "2026-02-07" });

          // the equity Saturday trade is satisfied by Friday's close, not by a Saturday quote
          expect(qqqDates).toContain("2026-02-06");
          expect(qqqDates).not.toContain("2026-02-07");
          expect(missing).not.toContainEqual({ ticker: "TESTQQQ360", checkpoint_date: "2026-02-07" });
        } finally {
          await tx.unsafe("ROLLBACK TO SAVEPOINT price_checkpoint_360_crypto");
        }
      });
    } finally {
      await sql.end();
    }
  }, { timeout: 15000 });
});
