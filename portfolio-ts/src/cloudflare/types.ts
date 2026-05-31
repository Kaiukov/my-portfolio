export interface CloudflareConfig {
  account_id: string;
  kv_namespace_id?: string;
  wrangler_project_name: string;
  initialized_at: string;
}

export interface AuthResult {
  authenticated: boolean;
  method: "wrangler" | "api_token" | null;
  accountId: string | null;
  error?: string;
}

export interface InitResult {
  auth: AuthResult;
  config: CloudflareConfig | null;
  files: {
    wranglerJsonc: string;
    workerJs: string;
  };
  warnings: string[];
}

export interface InitOptions {
  projectName?: string;
  accountId?: string;
  force?: boolean;
}
