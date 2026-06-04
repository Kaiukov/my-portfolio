import { spawnWrangler } from "./spawn.js";
import { loadLocalConfig } from "./config.js";
import { putKvValueViaApi, type FetchLike } from "./kv_api.js";
import {
  buildDashboardSnapshot,
  type DashboardSnapshot,
} from "../commands/dashboard.js";

export interface DashboardPublishResult {
  success: boolean;
  key: string;
  namespaceId: string | null;
  snapshot: DashboardSnapshot | null;
  error?: string;
}

interface PublishOptions {
  fetchImpl?: FetchLike;
  spawnWrangler?: typeof spawnWrangler;
  putKvValueViaApi?: typeof putKvValueViaApi;
  buildSnapshot?: typeof buildDashboardSnapshot;
}

export function validateDashboardSnapshot(
  s: DashboardSnapshot,
): string | null {
  if (
    typeof s.summary?.portfolio_value_usd !== "number" ||
    !Number.isFinite(s.summary.portfolio_value_usd)
  ) {
    return "summary.portfolio_value_usd is missing or NaN";
  }
  if (!s.status || typeof s.status !== "object") {
    return "status is missing";
  }
  if (!Array.isArray(s.allocation_rows)) {
    return "allocation_rows is missing or not an array";
  }
  if (!Array.isArray(s.history)) {
    return "history is missing or not an array";
  }
  if (!s.updatedAt) {
    return "updatedAt is missing or empty";
  }
  return null;
}

export async function publishDashboardToKv(
  projectRoot?: string,
  deps: PublishOptions = {},
): Promise<DashboardPublishResult> {
  const root = projectRoot ?? process.cwd();
  const config = loadLocalConfig(root);
  const key = process.env.PORTFOLIO_DASHBOARD_KV_KEY ?? "dashboard";
  const spawn = deps.spawnWrangler ?? spawnWrangler;
  const putValueViaApi = deps.putKvValueViaApi ?? putKvValueViaApi;
  const buildSnapshotFn = deps.buildSnapshot ?? buildDashboardSnapshot;

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

  const validationError = validateDashboardSnapshot(snapshot);
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
