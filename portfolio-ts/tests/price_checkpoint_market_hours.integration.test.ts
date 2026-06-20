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
