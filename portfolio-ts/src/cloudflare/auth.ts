import type { AuthResult, WhoamiInfo } from "./types.js";
import { spawnWrangler } from "./spawn.js";

export async function detectAuth(env: typeof process.env = process.env): Promise<AuthResult> {
  const token = env["CLOUDFLARE_API_TOKEN"];

  if (token) {
    let accountId: string | null = env["CLOUDFLARE_ACCOUNT_ID"] ?? null;
    if (!accountId) {
      accountId = await tryWranglerAccountId();
    }
    return { authenticated: true, method: "api_token", accountId };
  }

  const wranglerOk = await tryWranglerWhoami(env);
  if (wranglerOk) {
    const accountId = env["CLOUDFLARE_ACCOUNT_ID"] ?? await tryWranglerAccountId();
    return { authenticated: true, method: "wrangler", accountId };
  }

  return {
    authenticated: false,
    method: null,
    accountId: null,
    error: "No Cloudflare authentication detected. Run `wrangler login` or set CLOUDFLARE_API_TOKEN env variable.",
  };
}

async function tryWranglerWhoami(
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  try {
    const proc = Bun.spawnSync(["wrangler", "whoami"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: env.PATH ?? process.env.PATH },
    });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

async function tryWranglerAccountId(): Promise<string | null> {
  try {
    const proc = Bun.spawnSync(["wrangler", "whoami"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: process.env.PATH },
    });
    if (proc.exitCode !== 0) return null;

    const output = new TextDecoder().decode(proc.stdout);
    return parseWranglerWhoami(output);
  } catch {
    return null;
  }
}

export function parseWranglerWhoami(output: string): string | null {
  const boxMatch = output.match(/[\│\|]\s*([a-f0-9]{32})\s*[\│\|]/i);
  if (boxMatch) return boxMatch[1];

  const labelMatch = output.match(/Account\s+ID[^│|a-f0-9]*[│|]\s*([a-f0-9]{32})/i);
  if (labelMatch) return labelMatch[1];

  const hexMatch = output.match(/\b([a-f0-9]{32})\b/i);
  if (hexMatch) return hexMatch[1];

  return null;
}

export interface AccountIdValid {
  ok: true;
  id: string;
}

export interface AccountIdInvalid {
  ok: false;
  error: string;
}

export function runWranglerLogin(): { success: boolean; error?: string } {
  const proc = spawnWrangler(["login"], { inherit: true });
  if (proc.exitCode !== 0) {
    return { success: false, error: "wrangler login failed. Run `wrangler login` manually." };
  }
  return { success: true };
}

export function runWranglerLogout(): { success: boolean; error?: string } {
  const proc = spawnWrangler(["logout"], { inherit: true });
  if (proc.exitCode !== 0) {
    return { success: false, error: "wrangler logout failed. Run `wrangler logout` manually." };
  }
  return { success: true };
}

export function runWranglerWhoami(): WhoamiInfo {
  const proc = spawnWrangler(["whoami"]);
  if (proc.exitCode !== 0) {
    return {
      authenticated: false,
      error: "wrangler whoami failed. Run `wrangler login` first.",
    };
  }
  return parseWhoamiOutput(proc.stdout);
}

export function parseWhoamiOutput(output: string): WhoamiInfo {
  if (/not authenticated/i.test(output)) {
    return { authenticated: false, error: "Not authenticated. Run `wrangler login` first." };
  }

  const accountId = parseWranglerWhoami(output);
  const emailMatch = output.match(/email\s+([^\s,<>!]+@[^\s,<>!]+)/i);
  const accountNameMatch = output.match(
    /Account\s+Name[^│]*[│|]\s*([^│|\n]+)/i,
  );

  return {
    authenticated: !!accountId || !!emailMatch,
    accountName: accountNameMatch ? accountNameMatch[1].trim() : undefined,
    accountId: accountId ?? undefined,
    email: emailMatch ? emailMatch[1] : undefined,
  };
}

export type AccountIdResult = AccountIdValid | AccountIdInvalid;

export function validateAccountId(
  accountId: string | null,
  providedAccountId?: string,
): AccountIdResult {
  const id = providedAccountId ?? accountId;
  if (!id) {
    return {
      ok: false,
      error: "CLOUDFLARE_ACCOUNT_ID is required. Set it via env variable or provide --account-id.",
    };
  }
  if (!/^[a-f0-9]{32}$/.test(id)) {
    return {
      ok: false,
      error: `Invalid CLOUDFLARE_ACCOUNT_ID: "${id}". Expected 32-character hex string.`,
    };
  }
  return { ok: true, id };
}
