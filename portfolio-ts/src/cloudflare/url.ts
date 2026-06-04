import { loadLocalConfig } from "./config.js";

interface UrlResult {
  ok: boolean;
  url?: string;
  error?: string;
}

export function getWidgetUrl(projectRoot?: string): UrlResult {
  const config = loadLocalConfig(projectRoot);
  if (!config || !config.widget_url) {
    return {
      ok: false,
      error: "Not deployed yet. Run `portfolio cloudflare deploy` first.",
    };
  }
  return { ok: true, url: config.widget_url };
}
