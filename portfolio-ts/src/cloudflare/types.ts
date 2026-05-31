export interface CloudflareConfig {
  account_id: string;
  kv_namespace_id?: string;
  wrangler_project_name: string;
  initialized_at: string;
  widget_url?: string;
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
  fileActions: {
    wranglerJsonc: "written" | "skipped" | "none";
    workerJs: "written" | "skipped" | "none";
  };
  warnings: string[];
}

export interface InitOptions {
  projectName?: string;
  accountId?: string;
  force?: boolean;
}

export interface DeployResult {
  success: boolean;
  url: string | null;
  error?: string;
  stdout?: string;
  stderr?: string;
}

export interface WhoamiInfo {
  authenticated: boolean;
  accountName?: string;
  accountId?: string;
  email?: string;
  error?: string;
}
