import { describe, expect, test, mock, jest, beforeEach, afterEach } from "bun:test";

const mockAddTransaction = mock();
const mockApplyWrap = mock();
const mockApplyUnwrap = mock();

beforeEach(() => {
  mockAddTransaction.mockReset();
  mockApplyWrap.mockReset();
  mockApplyUnwrap.mockReset();
});

afterEach(() => {
  mock.restore();
});

function normalizeEnvelope(envelope: unknown) {
  const e = envelope as {
    ok?: unknown;
    command?: unknown;
    data?: unknown;
    meta?: { count?: unknown } | null;
  };
  return {
    ok: e.ok,
    command: e.command,
    data: e.data,
    meta: {
      count: e.meta?.count ?? null,
    },
  };
}

describe("crypto action parity", () => {
  test("STAKING_REWARD add parity matches across CLI, REST, and MCP", async () => {
    const result = {
      transaction: { id: 901, asset: "BTC-USD", action: "STAKING_REWARD" },
      recalculated: true,
    };
    mockAddTransaction.mockResolvedValue(result);
    mock.module("../src/commands/add.js", () => ({
      addTransaction: mockAddTransaction,
      addDryRun: mock(async () => ({ dry_run: true })),
    }));

    const cacheBust = `?case=add-${Date.now()}`;
    const cliMod = await import(`../src/cli.js${cacheBust}`);
    const apiMod = await import(`../src/api/server.js${cacheBust}`);
    const { mcpWrite } = await import(`../src/mcp/adapter.js${cacheBust}`);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await cliMod.dispatch([
      "bun", "src/cli.ts", "add",
      "--date", "2026-01-02",
      "--asset", "BTC-USD",
      "--action", "STAKING_REWARD",
      "--quantity", "0.00017429",
      "--exchange", "Binance Earn",
    ]);
    const cliEnvelope = normalizeEnvelope(JSON.parse(logSpy.mock.calls[0][0]));

    const apiRes = await apiMod.handleRequest(
      new Request("http://localhost/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: "2026-01-02",
          asset: "BTC-USD",
          action: "STAKING_REWARD",
          quantity: 0.00017429,
          exchange: "Binance Earn",
        }),
      }),
      {
        write: {
          addTransaction: mockAddTransaction,
          addDryRun: mock(async () => ({ dry_run: true })),
        },
      },
    );
    const apiEnvelope = normalizeEnvelope(await apiRes.json());

    const mcpEnvelope = normalizeEnvelope(await mcpWrite("add_transaction", {
      date: "2026-01-02",
      asset: "BTC-USD",
      action: "STAKING_REWARD",
      quantity: 0.00017429,
      exchange: "Binance Earn",
    }, {
      write: {
        addTransaction: mockAddTransaction,
      },
    }));

    expect(cliEnvelope).toEqual(apiEnvelope);
    expect(cliEnvelope).toEqual(mcpEnvelope);

    logSpy.mockRestore();
  });

  test("wrap parity matches across CLI, REST, and MCP", async () => {
    const result = {
      from: { asset: "ETH-USD", quantity: 1 },
      to: { asset: "WBETH-USD", quantity: 1.05 },
      ratio: 1.05,
      date: "2026-01-02",
      transaction_ids: [101, 102],
      exchange_group_id: "wrap-group",
    };
    mockApplyWrap.mockResolvedValue(result);
    mockApplyUnwrap.mockResolvedValue(result);
    mock.module("../src/commands/wrap.js", () => ({
      applyWrap: mockApplyWrap,
      applyUnwrap: mockApplyUnwrap,
    }));

    const cacheBust = `?case=wrap-${Date.now()}`;
    const cliMod = await import(`../src/cli.js${cacheBust}`);
    const apiMod = await import(`../src/api/server.js${cacheBust}`);
    const { mcpWrite } = await import(`../src/mcp/adapter.js${cacheBust}`);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await cliMod.dispatch([
      "bun", "src/cli.ts", "wrap",
      "--date", "2026-01-02",
      "--from", "ETH-USD",
      "--to", "WBETH-USD",
      "--from-quantity", "1",
      "--to-quantity", "1.05",
    ]);
    const cliEnvelope = normalizeEnvelope(JSON.parse(logSpy.mock.calls[0][0]));

    const apiRes = await apiMod.handleRequest(
      new Request("http://localhost/wrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: "2026-01-02",
          fromAsset: "ETH-USD",
          toAsset: "WBETH-USD",
          fromQuantity: 1,
          toQuantity: 1.05,
        }),
      }),
      {
        write: {
          addTransaction: mockAddTransaction,
          addDryRun: mock(async () => ({ dry_run: true })),
          applyWrap: mockApplyWrap,
          applyUnwrap: mockApplyUnwrap,
        },
      },
    );
    const apiEnvelope = normalizeEnvelope(await apiRes.json());

    const mcpEnvelope = normalizeEnvelope(await mcpWrite("wrap", {
      date: "2026-01-02",
      fromAsset: "ETH-USD",
      toAsset: "WBETH-USD",
      fromQuantity: 1,
      toQuantity: 1.05,
    }, {
      write: {
        applyWrap: mockApplyWrap,
      },
    }));

    expect(cliEnvelope).toEqual(apiEnvelope);
    expect(cliEnvelope).toEqual(mcpEnvelope);

    logSpy.mockRestore();
  });

  test("unwrap parity matches across CLI, REST, and MCP", async () => {
    const result = {
      from: { asset: "WBETH-USD", quantity: 1.05 },
      to: { asset: "ETH-USD", quantity: 1 },
      ratio: 0.9523809524,
      date: "2026-01-03",
      transaction_ids: [201, 202],
      exchange_group_id: "unwrap-group",
    };
    mockApplyUnwrap.mockResolvedValue(result);
    mock.module("../src/commands/wrap.js", () => ({
      applyWrap: mockApplyWrap,
      applyUnwrap: mockApplyUnwrap,
    }));

    const cacheBust = `?case=unwrap-${Date.now()}`;
    const cliMod = await import(`../src/cli.js${cacheBust}`);
    const apiMod = await import(`../src/api/server.js${cacheBust}`);
    const { mcpWrite } = await import(`../src/mcp/adapter.js${cacheBust}`);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await cliMod.dispatch([
      "bun", "src/cli.ts", "unwrap",
      "--date", "2026-01-03",
      "--from", "WBETH-USD",
      "--to", "ETH-USD",
      "--from-quantity", "1.05",
      "--to-quantity", "1",
    ]);
    const cliEnvelope = normalizeEnvelope(JSON.parse(logSpy.mock.calls[0][0]));

    const apiRes = await apiMod.handleRequest(
      new Request("http://localhost/unwrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: "2026-01-03",
          fromAsset: "WBETH-USD",
          toAsset: "ETH-USD",
          fromQuantity: 1.05,
          toQuantity: 1,
        }),
      }),
      {
        write: {
          addTransaction: mockAddTransaction,
          addDryRun: mock(async () => ({ dry_run: true })),
          applyWrap: mockApplyWrap,
          applyUnwrap: mockApplyUnwrap,
        },
      },
    );
    const apiEnvelope = normalizeEnvelope(await apiRes.json());

    const mcpEnvelope = normalizeEnvelope(await mcpWrite("unwrap", {
      date: "2026-01-03",
      fromAsset: "WBETH-USD",
      toAsset: "ETH-USD",
      fromQuantity: 1.05,
      toQuantity: 1,
    }, {
      write: {
        applyUnwrap: mockApplyUnwrap,
      },
    }));

    expect(cliEnvelope).toEqual(apiEnvelope);
    expect(cliEnvelope).toEqual(mcpEnvelope);

    logSpy.mockRestore();
  });
});
