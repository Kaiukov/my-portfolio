import { describe, expect, test, mock, jest, beforeEach, afterEach } from "bun:test";

const mockBunFile = mock(() => ({
  size: 1234,
  arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
}));
const mockBunWrite = mock(async (_path: string, _data: Uint8Array) => {});

mock.module("../src/commands/bun_io.js", () => ({
  readFile: mockBunFile,
  writeFile: mockBunWrite,
}));

const fakeBackupDb = mock(async (_params: { dbUrl: string; outPath?: string }) => ({
  source: "postgresql",
  backup: "/tmp/portfolio.backup-2026-05-31.sql",
  size_bytes: 5678,
}));

mock.module("../src/commands/backup.js", () => ({
  backupDb: fakeBackupDb,
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

function setS3Env(usePortfolioPrefix: boolean) {
  const prefix = usePortfolioPrefix ? "PORTFOLIO_" : "";
  process.env[`${prefix}S3_ENDPOINT`] = "https://r2.example.com";
  process.env[`${prefix}S3_BUCKET`] = "my-bucket";
  process.env[`${prefix}S3_ACCESS_KEY_ID`] = "key123";
  process.env[`${prefix}S3_SECRET_ACCESS_KEY`] = "secret123";
  process.env[`${prefix}S3_REGION`] = "auto";
}

function clearAllS3Env() {
  delete process.env["PORTFOLIO_S3_ENDPOINT"];
  delete process.env["PORTFOLIO_S3_BUCKET"];
  delete process.env["PORTFOLIO_S3_ACCESS_KEY_ID"];
  delete process.env["PORTFOLIO_S3_SECRET_ACCESS_KEY"];
  delete process.env["PORTFOLIO_S3_REGION"];
  delete process.env["S3_ENDPOINT"];
  delete process.env["S3_BUCKET"];
  delete process.env["S3_ACCESS_KEY_ID"];
  delete process.env["S3_SECRET_ACCESS_KEY"];
  delete process.env["S3_REGION"];
}

describe("loadS3Config", () => {
  let envBackup: Record<string, string | undefined>;

  beforeEach(() => {
    envBackup = { ...process.env };
    clearAllS3Env();
  });

  afterEach(() => {
    process.env = envBackup;
  });

  test("reads PORTFOLIO_S3_* as primary", async () => {
    setS3Env(true);
    delete process.env["S3_ENDPOINT"];
    delete process.env["S3_BUCKET"];
    delete process.env["S3_ACCESS_KEY_ID"];
    delete process.env["S3_SECRET_ACCESS_KEY"];

    const { loadS3Config } = await import("../src/commands/backup_s3.js");
    const result = loadS3Config();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.endpoint).toBe("https://r2.example.com");
      expect(result.config.bucket).toBe("my-bucket");
    }
  });

  test("falls back to bare S3_* when PORTFOLIO_S3_* not set", async () => {
    setS3Env(false);

    const { loadS3Config } = await import("../src/commands/backup_s3.js");
    const result = loadS3Config();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.endpoint).toBe("https://r2.example.com");
      expect(result.config.bucket).toBe("my-bucket");
    }
  });

  test("PORTFOLIO_S3_* takes precedence over S3_*", async () => {
    process.env["S3_ENDPOINT"] = "https://bare.example.com";
    process.env["S3_BUCKET"] = "bare-bucket";
    process.env["S3_ACCESS_KEY_ID"] = "bare-key";
    process.env["S3_SECRET_ACCESS_KEY"] = "bare-secret";
    process.env["PORTFOLIO_S3_ENDPOINT"] = "https://pfx.example.com";
    process.env["PORTFOLIO_S3_BUCKET"] = "pfx-bucket";
    process.env["PORTFOLIO_S3_ACCESS_KEY_ID"] = "pfx-key";
    process.env["PORTFOLIO_S3_SECRET_ACCESS_KEY"] = "pfx-secret";

    const { loadS3Config } = await import("../src/commands/backup_s3.js");
    const result = loadS3Config();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.endpoint).toBe("https://pfx.example.com");
      expect(result.config.bucket).toBe("pfx-bucket");
      expect(result.config.accessKeyId).toBe("pfx-key");
      expect(result.config.secretAccessKey).toBe("pfx-secret");
    }
  });

  test("defaults S3_REGION to auto when not set", async () => {
    setS3Env(true);
    delete process.env["PORTFOLIO_S3_REGION"];
    delete process.env["S3_REGION"];

    const { loadS3Config } = await import("../src/commands/backup_s3.js");
    const result = loadS3Config();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.region).toBe("auto");
    }
  });

  test("error message lists PORTFOLIO_S3_* names", async () => {
    const { loadS3Config } = await import("../src/commands/backup_s3.js");
    const result = loadS3Config();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("PORTFOLIO_S3_ENDPOINT");
      expect(result.error).toContain("PORTFOLIO_S3_BUCKET");
      expect(result.error).toContain("PORTFOLIO_S3_ACCESS_KEY_ID");
      expect(result.error).toContain("PORTFOLIO_S3_SECRET_ACCESS_KEY");
    }
  });

  test("error message lists specific missing vars", async () => {
    process.env["PORTFOLIO_S3_ENDPOINT"] = "https://r2.example.com";
    process.env["PORTFOLIO_S3_BUCKET"] = "my-bucket";

    const { loadS3Config } = await import("../src/commands/backup_s3.js");
    const result = loadS3Config();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("PORTFOLIO_S3_ACCESS_KEY_ID");
      expect(result.error).toContain("PORTFOLIO_S3_SECRET_ACCESS_KEY");
      expect(result.error).not.toContain("PORTFOLIO_S3_ENDPOINT");
      expect(result.error).not.toContain("PORTFOLIO_S3_BUCKET");
    }
  });
});

describe("pushBackupToS3", () => {
  beforeEach(() => {
    s3SendMock.mockClear();
    s3SendMock.mockResolvedValue({});
    fakeBackupDb.mockClear();
    mockBunFile.mockClear();
  });

  test("runs pg_dump and uploads timestamped + latest.sql to S3", async () => {
    const { pushBackupToS3, createS3Client } = await import("../src/commands/backup_s3.js");

    const client = createS3Client({
      endpoint: "https://r2.example.com",
      bucket: "my-bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "auto",
    });

    const result = await pushBackupToS3(client, "my-bucket", "postgresql://localhost/db");

    expect(fakeBackupDb).toHaveBeenCalledWith({ dbUrl: "postgresql://localhost/db" });
    expect(result.bucket).toBe("my-bucket");
    expect(result.dump_path).toContain(".sql");
    expect(result.dump_size_bytes).toBe(5678);
    expect(result.objects).toHaveLength(2);

    const keys = result.objects;
    expect(keys.some((k) => k === "latest.sql")).toBe(true);
    const timestamped = keys.find((k) => k !== "latest.sql");
    expect(timestamped).toBeDefined();
    expect(timestamped!.endsWith(".sql")).toBe(true);

    expect(s3SendMock).toHaveBeenCalledTimes(2);

    const firstCall = s3SendMock.mock.calls[0][0];
    expect(firstCall.input.Bucket).toBe("my-bucket");
    expect(firstCall.input.ContentType).toBe("application/sql");

    const secondCall = s3SendMock.mock.calls[1][0];
    expect(secondCall.input.Key).toBe("latest.sql");
  });
});

describe("pullBackupFromS3", () => {
  beforeEach(() => {
    s3SendMock.mockClear();
    s3SendMock.mockResolvedValue({
      Body: {
        transformToByteArray: async () => new Uint8Array([1, 2, 3, 4]),
      },
    });
    mockBunWrite.mockClear();
  });

  test("downloads latest.sql and returns restore path + command", async () => {
    const { pullBackupFromS3, createS3Client } = await import("../src/commands/backup_s3.js");

    const client = createS3Client({
      endpoint: "https://r2.example.com",
      bucket: "my-bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "auto",
    });

    const result = await pullBackupFromS3(client, "my-bucket", "postgresql://localhost/db");

    expect(result.bucket).toBe("my-bucket");
    expect(result.key).toBe("latest.sql");
    expect(result.local_path).toContain("portfolio.restored");
    expect(result.size_bytes).toBe(4);
    expect(result.restore_command).toContain("psql");
    expect(result.restore_command).toContain("postgresql://localhost/db");

    expect(s3SendMock).toHaveBeenCalledTimes(1);
    const call = s3SendMock.mock.calls[0][0];
    expect(call.input.Bucket).toBe("my-bucket");
    expect(call.input.Key).toBe("latest.sql");

    expect(mockBunWrite).toHaveBeenCalled();
  });

  test("accepts a custom key for pull", async () => {
    const { pullBackupFromS3, createS3Client } = await import("../src/commands/backup_s3.js");

    const client = createS3Client({
      endpoint: "https://r2.example.com",
      bucket: "my-bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "auto",
    });

    const result = await pullBackupFromS3(
      client,
      "my-bucket",
      "postgresql://localhost/db",
      "backup-2026.sql",
    );

    expect(result.key).toBe("backup-2026.sql");
  });

  test("throws when response body is empty", async () => {
    s3SendMock.mockResolvedValue({
      Body: {
        transformToByteArray: async () => new Uint8Array(0),
      },
    });

    const { pullBackupFromS3, createS3Client } = await import("../src/commands/backup_s3.js");

    const client = createS3Client({
      endpoint: "https://r2.example.com",
      bucket: "my-bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "auto",
    });

    await expect(pullBackupFromS3(client, "my-bucket", "postgresql://localhost/db")).rejects.toThrow(
      "Empty response body",
    );
  });
});

describe("CLI integration — backup push", () => {
  let envBackup: Record<string, string | undefined>;

  beforeEach(() => {
    envBackup = { ...process.env };
    setS3Env(true);
    process.env["PORTFOLIO_DB_URL"] = "postgresql://localhost/db";
    s3SendMock.mockClear();
    s3SendMock.mockResolvedValue({});
    s3DestroyMock.mockClear();
    fakeBackupDb.mockClear();
    mockBunFile.mockClear();
  });

  afterEach(() => {
    process.env = envBackup;
  });

  test("dispatches backup push and returns success envelope", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "backup", "push"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("backup:push");
    expect(output.data.bucket).toBe("my-bucket");
    expect(output.data.objects).toHaveLength(2);
    expect(s3SendMock).toHaveBeenCalledTimes(2);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("returns config error when PORTFOLIO_S3_* vars missing", async () => {
    clearAllS3Env();

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "backup", "push"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("backup:push");
    expect(output.error.code).toBe("CONFIG_ERROR");
    expect(output.error.message).toContain("PORTFOLIO_S3_ENDPOINT");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("returns config error when PORTFOLIO_DB_URL missing", async () => {
    delete process.env["PORTFOLIO_DB_URL"];

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "backup", "push"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.error.code).toBe("CONFIG_ERROR");
    expect(output.error.message).toContain("PORTFOLIO_DB_URL");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("CLI integration — backup pull", () => {
  let envBackup: Record<string, string | undefined>;

  beforeEach(() => {
    envBackup = { ...process.env };
    setS3Env(true);
    process.env["PORTFOLIO_DB_URL"] = "postgresql://localhost/db";
    s3SendMock.mockClear();
    s3SendMock.mockResolvedValue({
      Body: {
        transformToByteArray: async () => new Uint8Array([1, 2, 3, 4]),
      },
    });
    s3DestroyMock.mockClear();
    mockBunWrite.mockClear();
  });

  afterEach(() => {
    process.env = envBackup;
  });

  test("dispatches backup pull and returns success envelope", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "backup", "pull"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("backup:pull");
    expect(output.data.bucket).toBe("my-bucket");
    expect(output.data.key).toBe("latest.sql");
    expect(output.data.local_path).toContain("portfolio.restored");
    expect(output.data.restore_command).toContain("psql");
    expect(s3SendMock).toHaveBeenCalledTimes(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches backup pull with --key", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "backup", "pull", "--key", "backup-2026.sql"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.data.key).toBe("backup-2026.sql");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("returns config error for pull when S3 vars missing", async () => {
    clearAllS3Env();

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

describe("Help text", () => {
  test("backup push and pull appear in help", async () => {
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
