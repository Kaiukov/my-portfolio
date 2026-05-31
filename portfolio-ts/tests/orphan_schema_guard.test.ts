import { describe, expect, test } from "bun:test";
import { SQL } from "bun";

const DB_URL = process.env.PORTFOLIO_DB_URL;
const MAYBE_SKIP = DB_URL ? describe : describe.skip;

MAYBE_SKIP("regression guard: no orphaned test schemas (#117)", () => {
  test("no pytest_* or test_* schemas exist in the database", async () => {
    const sql = new SQL(DB_URL!, { max: 1 });
    try {
      const rows = await sql.unsafe(
        `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'pytest\\_%' OR nspname LIKE 'test\\_%'`,
      ) as { nspname: string }[];
      const names = rows.map((r: { nspname: string }) => r.nspname);
      expect(rows.length).toBe(0);
      if (names.length > 0) {
        expect(names.join(", ")).toBe("");
      }
    } finally {
      await sql.end();
    }
  });
});
