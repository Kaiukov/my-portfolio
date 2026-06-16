import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as { version?: string };

export const APP_VERSION: string =
  typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "0.0.0";