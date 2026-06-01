import { describe, expect, test, mock, beforeEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mockQuery = mock(async (_sqlText: string, _params?: unknown[]) => []);
const mockQuerySingle = mock(
  async (_sqlText: string, _params?: unknown[]) => ({ count: 4 } as Record<string, unknown>),
);

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: async () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(),
}));

function makeSqlDir(prefix: string): string {
  const dir = join(import.meta.dir, `__init_test_${prefix}__`);
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeStub(dir: string, name: string, marker: string): void {
  writeFileSync(
    join(dir, name),
    `-- stub ${name}\nSELECT '${marker}';\n`,
    "utf-8",
  );
}

describe("initDb (#140) — unit tests with mocked db", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async () => []);
    mockQuerySingle.mockReset();
    mockQuerySingle.mockImplementation(async () => ({ count: 4 }));
  });

  test("applies 5 SQL files in the required order and reports ready when 4 tables exist", async () => {
    const { initDb } = await import("../src/commands/init.js");
    const result = await initDb();

    expect(mockQuery).toHaveBeenCalledTimes(5);
    expect(result.applied).toEqual([
      "schema.sql",
      "functions.sql",
      "procedures.sql",
      "views.sql",
      "triggers.sql",
    ]);
    expect(result.sql_files).toEqual([
      "schema.sql",
      "functions.sql",
      "procedures.sql",
      "views.sql",
      "triggers.sql",
    ]);
    expect(result.status).toBe("ready");
    expect(result.tables_found).toBe(4);
    expect(result.db_target).toBe("postgresql");
    expect(result.sql_dir).toContain("portfolio_db");
    expect(result.sql_dir).toContain("sql");

    const calls = mockQuery.mock.calls;
    for (let i = 0; i < 5; i++) {
      const sqlText = calls[i][0] as string;
      expect(typeof sqlText).toBe("string");
      expect(sqlText.length).toBeGreaterThan(0);
    }
  });

  test("queries the readiness count exactly once and only after all SQL is applied", async () => {
    const callOrder: string[] = [];
    const expectedOrder = [
      "schema.sql",
      "functions.sql",
      "procedures.sql",
      "views.sql",
      "triggers.sql",
    ];
    let applyIndex = 0;
    mockQuery.mockImplementation(async () => {
      const name = expectedOrder[applyIndex] ?? "unknown";
      applyIndex += 1;
      callOrder.push(name);
      return [];
    });
    mockQuerySingle.mockImplementation(async () => {
      callOrder.push("readiness_count");
      return { count: 4 };
    });

    const { initDb } = await import("../src/commands/init.js");
    const result = await initDb();

    expect(result.status).toBe("ready");
    expect(callOrder).toEqual([
      "schema.sql",
      "functions.sql",
      "procedures.sql",
      "views.sql",
      "triggers.sql",
      "readiness_count",
    ]);
    expect(mockQuerySingle).toHaveBeenCalledTimes(1);
  });

  test("reports schema_incomplete when readiness count is below 4", async () => {
    mockQuerySingle.mockReset();
    mockQuerySingle.mockImplementation(async () => ({ count: 2 }));

    const { initDb } = await import("../src/commands/init.js");
    const result = await initDb();

    expect(result.applied).toHaveLength(5);
    expect(result.status).toBe("schema_incomplete");
    expect(result.tables_found).toBe(2);
  });

  test("throws a clear error when a SQL file is missing (stops before that file)", async () => {
    const dir = makeSqlDir("missing");
    try {
      for (const f of ["schema.sql", "functions.sql", "procedures.sql", "views.sql"]) {
        writeStub(dir, f, "ok");
      }

      const { applySqlFiles } = await import("../src/sql_apply.js");
      let caught: unknown;
      try {
        await applySqlFiles({ sqlDir: dir });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      const msg = (caught as Error).message;
      expect(msg).toContain("init:");
      expect(msg).toContain("missing SQL file");
      expect(msg).toContain("triggers.sql");
      expect(msg).toContain(dir);

      expect(mockQuery).toHaveBeenCalledTimes(4);
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    }
  });

  test("stops on first query() failure with a clear error message and preserves order", async () => {
    const dir = makeSqlDir("failure");
    try {
      for (const f of ["schema.sql", "functions.sql", "procedures.sql", "views.sql", "triggers.sql"]) {
        writeStub(dir, f, f.replace(".sql", ""));
      }

      mockQuery.mockReset();
      mockQuery
        .mockImplementationOnce(async () => [])
        .mockImplementationOnce(async () => [])
        .mockImplementationOnce(async () => {
          throw new Error("syntax error at or near 'foo'");
        });

      const { applySqlFiles } = await import("../src/sql_apply.js");
      let caught: unknown;
      try {
        await applySqlFiles({ sqlDir: dir });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      const msg = (caught as Error).message;
      expect(msg).toContain("init:");
      expect(msg).toContain("failed to apply procedures.sql");
      expect(msg).toContain("syntax error");

      expect(mockQuery).toHaveBeenCalledTimes(3);
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    }
  });

  test("applySqlFiles is idempotent on a real file (calling twice succeeds without throwing)", async () => {
    const dir = makeSqlDir("idempotent");
    try {
      writeStub(dir, "schema.sql", "ok");
      writeStub(dir, "functions.sql", "ok");
      writeStub(dir, "procedures.sql", "ok");
      writeStub(dir, "views.sql", "ok");
      writeStub(dir, "triggers.sql", "ok");

      mockQuery.mockReset();
      mockQuery.mockImplementation(async () => []);

      const { applySqlFiles } = await import("../src/sql_apply.js");
      const first = await applySqlFiles({ sqlDir: dir });
      const second = await applySqlFiles({ sqlDir: dir });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(first.applied).toHaveLength(5);
      expect(second.applied).toHaveLength(5);
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    }
  });

  test("resolveSqlDir returns a path containing portfolio_db/sql", async () => {
    const { resolveSqlDir } = await import("../src/sql_apply.js");
    const resolved = resolveSqlDir();
    expect(resolved).toContain("portfolio_db");
    expect(resolved).toContain("sql");
  });

  test("readiness query uses inline IN list, not bind params (#154 regression guard)", async () => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async () => []);
    mockQuerySingle.mockReset();
    mockQuerySingle.mockImplementation(async () => ({ count: 4 }));

    const { initDb } = await import("../src/commands/init.js");
    await initDb();

    expect(mockQuerySingle).toHaveBeenCalledTimes(1);
    const call = mockQuerySingle.mock.calls[0] as readonly [string, unknown[]?];
    const sqlText = call[0];
    const params = call[1];

    expect(sqlText).toContain("IN (");
    expect(sqlText).not.toContain("$1");
    expect(sqlText).not.toContain("ANY(");
    expect(sqlText).toContain("'transactions'");
    expect(sqlText).toContain("'daily_returns'");
    expect(sqlText).toContain("'prices'");
    expect(sqlText).toContain("'service_state'");

    expect(params === undefined || (Array.isArray(params) && params.length === 0)).toBe(true);
  });
});
