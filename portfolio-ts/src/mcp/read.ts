import type { Envelope } from "../response.js";
import { dispatchRead } from "../adapters/read_shared.js";

type JsonObject = Record<string, unknown>;

export async function mcpRead(
  toolName: string,
  args: JsonObject,
): Promise<Envelope> {
  return dispatchRead(toolName, args);
}
