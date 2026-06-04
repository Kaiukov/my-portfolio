import { describe, expect, test, beforeAll, afterAll } from "bun:test";

const DB_URL = process.env.PORTFOLIO_DB_URL;
const MAYBE_SKIP = DB_URL ? describe : describe.skip;

MAYBE_SKIP("asset_metadata integration (DB-gated)", () => {
  let sql: any;

  beforeAll(async () => {
    const { connect, getSql } = await import("../src/db.js");
    connect(DB_URL);
    sql = getSql();

    // Run the new SQL function to ensure it parses and executes cleanly
    await sql.unsafe(`SET check_function_bodies = off;`);
    await sql.unsafe(`CREATE OR REPLACE FUNCTION portfolio_asset_metadata_sql(
    p_asset TEXT DEFAULT NULL,
    p_max_age_days INTEGER DEFAULT 5
)
RETURNS TABLE(
    asset TEXT,
    asset_kind TEXT,
    sector TEXT,
    industry TEXT,
    region TEXT,
    sector_weights JSONB,
    source TEXT,
    fetched_at TEXT,
    is_stale BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        am.ticker::TEXT,
        am.asset_kind,
        am.sector,
        am.industry,
        am.region,
        am.sector_weights,
        am.source,
        to_char(am.fetched_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')::TEXT,
        (am.fetched_at < (CURRENT_DATE - p_max_age_days) OR am.fetched_at IS NULL) AS is_stale
    FROM asset_metadata am
    WHERE (p_asset IS NULL OR upper(am.ticker) = upper(p_asset))
    ORDER BY am.ticker;
$$;`);
    await sql.unsafe(`SET check_function_bodies = on;`);
  });

  afterAll(async () => {
    // Clean up test data
    if (sql) {
      await sql.unsafe(`DELETE FROM asset_metadata WHERE ticker = 'TEST_INTEGRATION'`);
      await sql.unsafe(`DELETE FROM asset_metadata WHERE ticker = 'TEST_INTEGRATION_OLD'`);
    }
  });

  test("portfolio_asset_metadata_sql parses and executes without error", async () => {
    const rows = await sql.unsafe(`SELECT * FROM portfolio_asset_metadata_sql(NULL, 5)`);
    expect(Array.isArray(rows)).toBe(true);
  });

  test("upsertAssetMetadata + portfolio_asset_metadata_sql round-trip", async () => {
    const { upsertAssetMetadata } = await import("../src/db.js");

    await upsertAssetMetadata("TEST_INTEGRATION", {
      asset_kind: "stock",
      sector: "Technology",
      industry: "Software",
      region: "US",
      sector_weights: [],
      source: "yahoo",
    });

    const rows = await sql.unsafe(
      `SELECT * FROM portfolio_asset_metadata_sql($1, 5)`,
      ["TEST_INTEGRATION"],
    );
    expect(rows).toBeInstanceOf(Array);
    expect(rows.length).toBe(1);
    expect(rows[0].asset).toBe("TEST_INTEGRATION");
    expect(rows[0].sector).toBe("Technology");
    expect(rows[0].industry).toBe("Software");
    expect(rows[0].region).toBe("US");
    expect(rows[0].source).toBe("yahoo");
    expect(typeof rows[0].is_stale).toBe("boolean");
    expect(rows[0].is_stale).toBe(false);
  });

  test("staleness flag is true for old fetched_at", async () => {
    const { upsertAssetMetadata } = await import("../src/db.js");

    await upsertAssetMetadata("TEST_INTEGRATION_OLD", {
      asset_kind: "etf",
      sector: "Finance",
      source: "yahoo",
    });

    // Manually backdate fetched_at to trigger staleness
    await sql.unsafe(
      `UPDATE asset_metadata SET fetched_at = $1 WHERE ticker = $2`,
      ["2020-01-01T00:00:00Z", "TEST_INTEGRATION_OLD"],
    );

    const rows = await sql.unsafe(
      `SELECT * FROM portfolio_asset_metadata_sql($1, 5)`,
      ["TEST_INTEGRATION_OLD"],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].is_stale).toBe(true);
  });

  test("getAssetMetadata reads all assets (NULL asset)", async () => {
    const { getAssetMetadata } = await import("../src/db.js");

    await getAssetMetadata(); // smoke: doesn't throw
    // If rows exist, verify shape
  });

  test("sector_weights JSONB round-trips correctly", async () => {
    const { upsertAssetMetadata } = await import("../src/db.js");

    const sw = [{ sector: "Tech", weight: 30 }, { sector: "Finance", weight: 20 }];

    await upsertAssetMetadata("TEST_INTEGRATION", {
      asset_kind: "etf",
      sector_weights: sw,
      source: "yahoo",
    });

    const rows = await sql.unsafe(
      `SELECT sector_weights FROM portfolio_asset_metadata_sql($1, 5)`,
      ["TEST_INTEGRATION"],
    );
    expect(rows.length).toBe(1);

    let parsed = rows[0].sector_weights;
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed.length).toBe(2);
    expect(parsed[0].sector).toBe("Tech");
    expect(parsed[0].weight).toBe(30);
  });
});
