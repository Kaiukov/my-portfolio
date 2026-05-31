import { describe, expect, test, mock, jest, beforeEach, afterEach } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(fn: (tx: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>): Promise<T> => {
    return fn({ unsafe: async (_sql: string, _params?: unknown[]) => [] });
  },
}));

const s3SendMock = mock();
const s3DestroyMock = mock();

mock.module("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = s3SendMock;
    destroy = s3DestroyMock;
  },
  PutObjectCommand: class {
    public readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  GetObjectCommand: class {
    public readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

function makeStatusRow(overrides: Record<string, unknown> = {}) {
  return {
    transactions_count: 42,
    start_date: "2025-01-01",
    end_date: "2026-01-15",
    portfolio_value: 25000,
    total_invested: 20000,
    deposits: 22000,
    withdrawals: 2000,
    income: 500,
    fees: 100,
    taxes: 50,
    total_gain: 369.03,
    total_gain_pct: 2.91,
    cost_basis: 24000,
    realized_gain: 200,
    unrealized_gain: 800,
    total_profit: 1000,
    as_of_date: "2026-01-15",
    ...overrides,
  };
}

function makeSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    holding_count: 5,
    total_cash_usd: 5000,
    portfolio_value_usd: 15424.58,
    last_transaction_date: "2026-01-15",
    transaction_count: 42,
    as_of_date: "2026-01-15",
    ...overrides,
  };
}

function makePriceFreshnessRows(pricesAsOf: string | null) {
  return pricesAsOf ? { prices_as_of: pricesAsOf } : { prices_as_of: null };
}

function makeDailyReturnsRows() {
  return [
    { date: "2026-01-15", portfolio_value: 15500, investment_return: -1.12 },
    { date: "2026-01-14", portfolio_value: 15700, investment_return: 0.5 },
    { date: "2026-01-13", portfolio_value: 15600, investment_return: -0.3 },
  ];
}

function makeCheckpointRows() {
  return [] as { ticker: string }[];
}

function makeStaleTickersRows() {
  return [] as { ticker: string }[];
}

describe("loadS3Config", () => {
  let envBackup: Record<string, string | undefined>;

  beforeEach(() => {
    envBackup = { ...process.env };
    delete process.env["S3_ENDPOINT"];
    delete process.env["S3_BUCKET"];
    delete process.env["S3_ACCESS_KEY_ID"];
    delete process.env["S3_SECRET_ACCESS_KEY"];
    delete process.env["S3_REGION"];
  });

  afterEach(() => {
    process.env = envBackup;
  });

  test("returns ok with full config", async () => {
    process.env["S3_ENDPOINT"] = "https://r2.cloudflarestorage.com";
    process.env["S3_BUCKET"] = "my-bucket";
    process.env["S3_ACCESS_KEY_ID"] = "key123";
    process.env["S3_SECRET_ACCESS_KEY"] = "secret123";
    process.env["S3_REGION"] = "auto";

    const { loadS3Config } = await import("../src/commands/backup_s3.js");
    const result = loadS3Config();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.endpoint).toBe("https://r2.cloudflarestorage.com");
      expect(result.config.bucket).toBe("my-bucket");
      expect(result.config.accessKeyId).toBe("key123");
      expect(result.config.secretAccessKey).toBe("secret123");
      expect(result.config.region).toBe("auto");
    }
  });

  test("defaults S3_REGION to auto when not set", async () => {
    process.env["S3_ENDPOINT"] = "https://r2.cloudflarestorage.com";
    process.env["S3_BUCKET"] = "my-bucket";
    process.env["S3_ACCESS_KEY_ID"] = "key123";
    process.env["S3_SECRET_ACCESS_KEY"] = "secret123";

    const { loadS3Config } = await import("../src/commands/backup_s3.js");
    const result = loadS3Config();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.region).toBe("auto");
    }
  });

  test("returns error when S3_ENDPOINT is missing", async () => {
    process.env["S3_BUCKET"] = "my-bucket";
    process.env["S3_ACCESS_KEY_ID"] = "key123";
    process.env["S3_SECRET_ACCESS_KEY"] = "secret123";

    const { loadS3Config } = await import("../src/commands/backup_s3.js");
    const result = loadS3Config();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("S3_ENDPOINT");
    }
  });

  test("returns error when S3_BUCKET is missing", async () => {
    process.env["S3_ENDPOINT"] = "https://r2.cloudflarestorage.com";
    process.env["S3_ACCESS_KEY_ID"] = "key123";
    process.env["S3_SECRET_ACCESS_KEY"] = "secret123";

    const { loadS3Config } = await import("../src/commands/backup_s3.js");
    const result = loadS3Config();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("S3_BUCKET");
    }
  });

  test("returns error when S3_ACCESS_KEY_ID is missing", async () => {
    process.env["S3_ENDPOINT"] = "https://r2.cloudflarestorage.com";
    process.env["S3_BUCKET"] = "my-bucket";
    process.env["S3_SECRET_ACCESS_KEY"] = "secret123";

    const { loadS3Config } = await import("../src/commands/backup_s3.js");
    const result = loadS3Config();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("S3_ACCESS_KEY_ID");
    }
  });

  test("returns error when S3_SECRET_ACCESS_KEY is missing", async () => {
    process.env["S3_ENDPOINT"] = "https://r2.cloudflarestorage.com";
    process.env["S3_BUCKET"] = "my-bucket";
    process.env["S3_ACCESS_KEY_ID"] = "key123";

    const { loadS3Config } = await import("../src/commands/backup_s3.js");
    const result = loadS3Config();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("S3_SECRET_ACCESS_KEY");
    }
  });

  test("lists all missing vars in error message", async () => {
    const { loadS3Config } = await import("../src/commands/backup_s3.js");
    const result = loadS3Config();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("S3_ENDPOINT");
      expect(result.error).toContain("S3_BUCKET");
      expect(result.error).toContain("S3_ACCESS_KEY_ID");
      expect(result.error).toContain("S3_SECRET_ACCESS_KEY");
    }
  });
});

describe("buildSnapshot", () => {
  test("composes snapshot from shared services", async () => {
    mockQuerySingle.mockImplementation((sql: string) => {
      if (sql.includes("portfolio_status_sql")) return makeStatusRow();
      if (sql.includes("portfolio_summary_sql")) return makeSummaryRow();
      if (sql.includes("MAX(date)")) return makePriceFreshnessRows("2026-01-15");
      if (sql.includes("SELECT COUNT(*)")) return { count: 3 };
      return null;
    });

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("daily_returns")) return makeDailyReturnsRows();
      if (sql.includes("get_required_price_checkpoints_sql")) return makeCheckpointRows();
      if (sql.includes("stale_tickers_sql")) return makeStaleTickersRows();
      return [];
    });

    const { buildSnapshot } = await import("../src/commands/backup_s3.js");
    const snapshot = await buildSnapshot();

    expect(snapshot.portfolio_value_usd).toBe(15424.58);
    expect(snapshot.today.abs).toBe(-200);
    expect(snapshot.today.pct).toBe(-1.12);
    expect(snapshot.total.abs).toBe(369.03);
    expect(snapshot.total.pct).toBe(2.91);
    expect(snapshot.history).toHaveLength(3);
    expect(snapshot.history[0].date).toBe("2026-01-13");
    expect(snapshot.history[0].value).toBe(15600);
    expect(snapshot.prices_as_of).toBe("2026-01-15");
    expect(snapshot.as_of_date).toBe("2026-01-15");
    expect(snapshot.updatedAt).toBeDefined();
    expect(snapshot.updatedAt).toContain("T");
  });
});

describe("pushSnapshot", () => {
  test("uploads timestamped and latest objects to S3", async () => {
    s3SendMock.mockClear();
    s3SendMock.mockResolvedValue({});

    const { pushSnapshot, createS3Client } = await import("../src/commands/backup_s3.js");

    const client = createS3Client({
      endpoint: "https://r2.cloudflarestorage.com",
      bucket: "my-bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "auto",
    });

    const snapshot = {
      portfolio_value_usd: 15000,
      today: { abs: 100, pct: 0.5 },
      total: { abs: 500, pct: 3.0 },
      history: [{ date: "2026-01-15", value: 15000 }],
      prices_as_of: "2026-01-15",
      as_of_date: "2026-01-15",
      updatedAt: new Date().toISOString(),
    };

    const result = await pushSnapshot(snapshot, client, "my-bucket");

    expect(result.bucket).toBe("my-bucket");
    expect(result.objects).toHaveLength(2);

    const keys = result.objects;
    const latestIdx = keys.findIndex((k) => k === "latest.json");
    const timestampedIdx = keys.findIndex((k) => k.startsWith("backup-") && k.endsWith(".json"));
    expect(latestIdx).not.toBe(-1);
    expect(timestampedIdx).not.toBe(-1);

    expect(s3SendMock).toHaveBeenCalledTimes(2);

    const firstCall = s3SendMock.mock.calls[0][0];
    expect(firstCall.input.Bucket).toBe("my-bucket");
    expect(firstCall.input.ContentType).toBe("application/json");
    expect(firstCall.input.Body).toContain("portfolio_value_usd");

    const secondCall = s3SendMock.mock.calls[1][0];
    expect(secondCall.input.Bucket).toBe("my-bucket");
    expect(secondCall.input.ContentType).toBe("application/json");
  });
});

describe("pullLatest", () => {
  test("downloads and parses latest.json from S3", async () => {
    const snapshotData = {
      portfolio_value_usd: 15000,
      today: { abs: 100, pct: 0.5 },
      total: { abs: 500, pct: 3.0 },
      history: [{ date: "2026-01-15", value: 15000 }],
      prices_as_of: "2026-01-15",
      as_of_date: "2026-01-15",
      updatedAt: "2026-01-15T12:00:00.000Z",
    };

    s3SendMock.mockClear();
    s3SendMock.mockResolvedValue({
      Body: {
        transformToString: async () => JSON.stringify(snapshotData),
      },
    });

    const { pullLatest, createS3Client } = await import("../src/commands/backup_s3.js");

    const client = createS3Client({
      endpoint: "https://r2.cloudflarestorage.com",
      bucket: "my-bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "auto",
    });

    const result = await pullLatest(client, "my-bucket");

    expect(result.bucket).toBe("my-bucket");
    expect(result.key).toBe("latest.json");
    expect(result.snapshot.portfolio_value_usd).toBe(15000);
    expect(result.snapshot.total.abs).toBe(500);

    expect(s3SendMock).toHaveBeenCalledTimes(1);
    const call = s3SendMock.mock.calls[0][0];
    expect(call.input.Bucket).toBe("my-bucket");
    expect(call.input.Key).toBe("latest.json");
  });

  test("throws when response body is empty", async () => {
    s3SendMock.mockClear();
    s3SendMock.mockResolvedValue({
      Body: {
        transformToString: async () => "",
      },
    });

    const { pullLatest, createS3Client } = await import("../src/commands/backup_s3.js");

    const client = createS3Client({
      endpoint: "https://r2.cloudflarestorage.com",
      bucket: "my-bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "auto",
    });

    await expect(pullLatest(client, "my-bucket")).rejects.toThrow("Empty response body");
  });
});

describe("CLI integration — backup push", () => {
  let envBackup: Record<string, string | undefined>;

  beforeEach(() => {
    envBackup = { ...process.env };
    process.env["S3_ENDPOINT"] = "https://r2.example.com";
    process.env["S3_BUCKET"] = "my-bucket";
    process.env["S3_ACCESS_KEY_ID"] = "key123";
    process.env["S3_SECRET_ACCESS_KEY"] = "secret123";
    process.env["S3_REGION"] = "auto";
  });

  afterEach(() => {
    process.env = envBackup;
  });

  test("dispatches backup push and returns success envelope", async () => {
    mockQuerySingle.mockImplementation((sql: string) => {
      if (sql.includes("portfolio_status_sql")) return makeStatusRow();
      if (sql.includes("portfolio_summary_sql")) return makeSummaryRow();
      if (sql.includes("MAX(date)")) return makePriceFreshnessRows("2026-01-15");
      if (sql.includes("SELECT COUNT(*)")) return { count: 3 };
      return null;
    });

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("daily_returns")) return makeDailyReturnsRows();
      if (sql.includes("get_required_price_checkpoints_sql")) return makeCheckpointRows();
      if (sql.includes("stale_tickers_sql")) return makeStaleTickersRows();
      return [];
    });

    s3SendMock.mockClear();
    s3SendMock.mockResolvedValue({});
    s3DestroyMock.mockClear();

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "backup", "push"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("backup:push");
    expect(output.data.objects).toHaveLength(2);
    expect(output.data.bucket).toBe("my-bucket");
    expect(s3SendMock).toHaveBeenCalledTimes(2);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches backup push with --as-of-date", async () => {
    mockQuerySingle.mockImplementation((sql: string) => {
      if (sql.includes("portfolio_status_sql")) return makeStatusRow();
      if (sql.includes("portfolio_summary_sql")) return makeSummaryRow();
      if (sql.includes("MAX(date)")) return makePriceFreshnessRows("2026-01-15");
      if (sql.includes("SELECT COUNT(*)")) return { count: 3 };
      return null;
    });

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("daily_returns")) return makeDailyReturnsRows();
      if (sql.includes("get_required_price_checkpoints_sql")) return makeCheckpointRows();
      if (sql.includes("stale_tickers_sql")) return makeStaleTickersRows();
      return [];
    });

    s3SendMock.mockClear();
    s3SendMock.mockResolvedValue({});
    s3DestroyMock.mockClear();

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "backup", "push", "--as-of-date", "2026-01-15"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(s3SendMock).toHaveBeenCalledTimes(2);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("returns config error when S3 env vars are missing", async () => {
    delete process.env["S3_ENDPOINT"];
    delete process.env["S3_BUCKET"];
    delete process.env["S3_ACCESS_KEY_ID"];
    delete process.env["S3_SECRET_ACCESS_KEY"];

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "backup", "push"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("backup:push");
    expect(output.error.code).toBe("CONFIG_ERROR");
    expect(output.error.message).toContain("Missing S3 configuration");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("CLI integration — backup pull", () => {
  let envBackup: Record<string, string | undefined>;

  beforeEach(() => {
    envBackup = { ...process.env };
    process.env["S3_ENDPOINT"] = "https://r2.example.com";
    process.env["S3_BUCKET"] = "my-bucket";
    process.env["S3_ACCESS_KEY_ID"] = "key123";
    process.env["S3_SECRET_ACCESS_KEY"] = "secret123";
    process.env["S3_REGION"] = "auto";
  });

  afterEach(() => {
    process.env = envBackup;
  });

  test("dispatches backup pull and returns success envelope", async () => {
    s3SendMock.mockClear();
    s3SendMock.mockResolvedValue({
      Body: {
        transformToString: async () =>
          JSON.stringify({
            portfolio_value_usd: 15000,
            today: { abs: 100, pct: 0.5 },
            total: { abs: 500, pct: 3.0 },
            history: [{ date: "2026-01-15", value: 15000 }],
            prices_as_of: "2026-01-15",
            as_of_date: "2026-01-15",
            updatedAt: "2026-01-15T12:00:00.000Z",
          }),
      },
    });
    s3DestroyMock.mockClear();

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "backup", "pull"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("backup:pull");
    expect(output.data.bucket).toBe("my-bucket");
    expect(output.data.key).toBe("latest.json");
    expect(output.data.snapshot.portfolio_value_usd).toBe(15000);
    expect(s3SendMock).toHaveBeenCalledTimes(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("returns config error for pull when S3 vars are missing", async () => {
    delete process.env["S3_ENDPOINT"];
    delete process.env["S3_BUCKET"];
    delete process.env["S3_ACCESS_KEY_ID"];
    delete process.env["S3_SECRET_ACCESS_KEY"];

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "backup", "pull"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("backup:pull");
    expect(output.error.code).toBe("CONFIG_ERROR");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("CLI integration — backup (legacy pg_dump)", () => {
  test("backup push appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("backup push");
    expect(output).toContain("backup pull");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
