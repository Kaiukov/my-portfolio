import { spawnWrangler } from "./spawn.js";
import { loadLocalConfig } from "./config.js";
import type { PublishResult, PortfolioSnapshot } from "./types.js";
import {
  buildPortfolioSnapshotFromContext,
  buildPublishSnapshotContext,
} from "../commands/publish_snapshot.js";
import { putKvValueViaApi, type FetchLike } from "./kv_api.js";

interface PublishOptions {
  fetchImpl?: FetchLike;
  spawnWrangler?: typeof spawnWrangler;
  putKvValueViaApi?: typeof putKvValueViaApi;
  buildSnapshot?: typeof buildSnapshot;
}

export async function buildSnapshot(): Promise<PortfolioSnapshot> {
  const context = await buildPublishSnapshotContext();
  return buildPortfolioSnapshotFromContext(context);
}

export function validateSnapshot(snapshot: PortfolioSnapshot): string | null {
  if (typeof snapshot.portfolio_value_usd !== "number" || !Number.isFinite(snapshot.portfolio_value_usd)) {
    return "portfolio_value_usd is missing or NaN";
  }
  if (typeof snapshot.today?.abs !== "number" || !Number.isFinite(snapshot.today.abs)) {
    return "today.abs is missing or NaN";
  }
  if (typeof snapshot.today?.pct !== "number" || !Number.isFinite(snapshot.today.pct)) {
    return "today.pct is missing or NaN";
  }
  if (typeof snapshot.total?.abs !== "number" || !Number.isFinite(snapshot.total.abs)) {
    return "total.abs is missing or NaN";
  }
  if (typeof snapshot.total?.pct !== "number" || !Number.isFinite(snapshot.total.pct)) {
    return "total.pct is missing or NaN";
  }
  if (!Array.isArray(snapshot.history)) {
    return "history is missing or not an array";
  }
  if (!snapshot.as_of_date) {
    return "as_of_date is missing or empty";
  }
  if (!snapshot.updatedAt) {
    return "updatedAt is missing or empty";
  }
  return null;
}

export async function publishToKv(projectRoot?: string, deps: PublishOptions = {}): Promise<PublishResult> {
  const root = projectRoot ?? process.cwd();
  const config = loadLocalConfig(root);
  const key = process.env.PORTFOLIO_KV_KEY ?? "portfolio";
  const spawn = deps.spawnWrangler ?? spawnWrangler;
  const putValueViaApi = deps.putKvValueViaApi ?? putKvValueViaApi;
  const buildSnapshotFn = deps.buildSnapshot ?? buildSnapshot;

  if (!config) {
    return {
      success: false,
      key,
      namespaceId: null,
      snapshot: null,
      error:
        "Not initialized. Run `portfolio cloudflare init` and `portfolio cloudflare deploy` first.",
    };
  }

  const namespaceId = config.kv_namespace_id;
  if (!namespaceId) {
    return {
      success: false,
      key,
      namespaceId: null,
      snapshot: null,
      error:
        "KV namespace not configured. Run `portfolio cloudflare init` or set kv_namespace_id in .portfolio/config.json.",
    };
  }

  const snapshot = await buildSnapshotFn();

  const validationError = validateSnapshot(snapshot);
  if (validationError) {
    return {
      success: false,
      key,
      namespaceId,
      snapshot,
      error: `Validation failed: ${validationError}`,
    };
  }

  const payload = JSON.stringify(snapshot);
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (apiToken) {
    const configAccountId = (config as Partial<typeof config>).account_id;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || configAccountId;

    if (!accountId) {
      return {
        success: false,
        key,
        namespaceId,
        snapshot,
        error: "CLOUDFLARE_ACCOUNT_ID/account_id required for API publish",
      };
    }

    const apiResult = await putValueViaApi({
      accountId,
      namespaceId,
      key,
      value: payload,
      apiToken,
      fetchImpl: deps.fetchImpl,
    });

    if (!apiResult.ok) {
      return {
        success: false,
        key,
        namespaceId,
        snapshot,
        error: apiResult.error,
      };
    }

    return {
      success: true,
      key,
      namespaceId,
      snapshot,
    };
  }

  const proc = spawn([
    "kv",
    "key",
    "put",
    key,
    payload,
    "--namespace-id",
    namespaceId,
    "--remote",
  ]);

  if (proc.exitCode !== 0) {
    return {
      success: false,
      key,
      namespaceId,
      snapshot,
      error: `wrangler kv key put failed (exit code ${proc.exitCode}): ${proc.stderr}`.trim(),
    };
  }

  return {
    success: true,
    key,
    namespaceId,
    snapshot,
  };
}
