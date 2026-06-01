export interface CloudflareConfig {
  account_id: string;
  kv_namespace_id?: string;
  kv_key?: string;
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
  kvNamespaceId?: string;
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

export interface TodaySnapshot {
  abs: number;
  pct: number;
}

export interface TotalSnapshot {
  abs: number;
  pct: number;
}

export interface HistoryPoint {
  date: string;
  value: number;
}

export interface PortfolioSnapshot {
  portfolio_value_usd: number;
  today: TodaySnapshot;
  total: TotalSnapshot;
  history: HistoryPoint[];
  prices_as_of: string;
  as_of_date: string;
  updatedAt: string;
}

export interface PublishResult {
  success: boolean;
  key: string;
  namespaceId: string | null;
  snapshot: PortfolioSnapshot | null;
  error?: string;
}
