import type { AuthResult } from "./types.js";

export async function detectAuth(env: typeof process.env = process.env): Promise<AuthResult> {
  const token = env["CLOUDFLARE_API_TOKEN"];

  if (token) {
    let accountId: string | null = env["CLOUDFLARE_ACCOUNT_ID"] ?? null;
    if (!accountId) {
      accountId = await tryWranglerAccountId();
    }
    return { authenticated: true, method: "api_token", accountId };
  }

  const wranglerOk = await tryWranglerWhoami();
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

async function tryWranglerWhoami(): Promise<boolean> {
  try {
    const proc = Bun.spawnSync(["wrangler", "whoami"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: process.env.PATH },
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
    const match = output.match(/Account ID\s*\|\s*([a-f0-9]{32})/i);
    if (match) return match[1];

    const altMatch = output.match(/\|([a-f0-9]{32})\|/);
    if (altMatch) return altMatch[1];

    return null;
  } catch {
    return null;
  }
}

export interface AccountIdValid {
  ok: true;
  id: string;
}

export interface AccountIdInvalid {
  ok: false;
  error: string;
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
