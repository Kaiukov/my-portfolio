import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

// Configurable constants with defaults for a single-user tool
export const MCP_MAX_SESSIONS = parseInt(process.env.MCP_MAX_SESSIONS ?? "64", 10);
export const MCP_SESSION_IDLE_MS = parseInt(process.env.MCP_SESSION_IDLE_MS ?? "1800000", 10); // 30 min

interface SessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  idleTimer: NodeJS.Timeout;
  timestamp: number; // For LRU tracking
}

/**
 * Bounded LRU session registry for MCP transports.
 *
 * Features:
 * - Maximum session cap with LRU eviction
 * - Per-session idle TTL that auto-closes/removes inactive sessions
 * - Thread-safe get/set/delete operations
 *
 * This fixes issues #302 (unbounded memory growth) and #304 (unbounded streams)
 * by ensuring sessions are capped at MAX_SESSIONS and closed after IDLE_MS of inactivity.
 */
export class McpSessionRegistry {
  private readonly map = new Map<string, SessionEntry>();
  private readonly maxSessions: number;
  private readonly idleMs: number;

  constructor(maxSessions: number = MCP_MAX_SESSIONS, idleMs: number = MCP_SESSION_IDLE_MS) {
    this.maxSessions = maxSessions;
    this.idleMs = idleMs;
  }

  /** Get the number of active sessions */
  get size(): number {
    return this.map.size;
  }

  /**
   * Insert or replace a session.
   * If at capacity, evicts the least-recently-used session first.
   */
  set(sid: string, transport: WebStandardStreamableHTTPServerTransport): void {
    // Evict LRU if at capacity (and this isn't replacing an existing session)
    if (!this.map.has(sid) && this.map.size >= this.maxSessions) {
      this.evictLeastRecentlyUsed();
    }

    // Clear any existing idle timer if replacing
    const existing = this.map.get(sid);
    if (existing) {
      clearTimeout(existing.idleTimer);
    }

    // Create new entry with idle timer
    const idleTimer = setTimeout(() => {
      this.closeAndDelete(sid);
    }, this.idleMs);

    // Unref to allow Node to exit even if timer is pending
    idleTimer.unref();

    this.map.set(sid, {
      transport,
      idleTimer,
      timestamp: Date.now(),
    });
  }

  /**
   * Get a session by ID.
   * Marks it as most-recently-used and resets its idle timer.
   */
  get(sid: string): WebStandardStreamableHTTPServerTransport | undefined {
    const entry = this.map.get(sid);
    if (!entry) {
      return undefined;
    }

    // Reset idle timer on activity
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      this.closeAndDelete(sid);
    }, this.idleMs);
    entry.idleTimer.unref();

    // Update LRU timestamp
    entry.timestamp = Date.now();

    return entry.transport;
  }

  /**
   * Remove a session and clear its idle timer.
   * Does NOT close the transport (caller may need to do cleanup first).
   */
  delete(sid: string): boolean {
    const entry = this.map.get(sid);
    if (!entry) {
      return false;
    }

    clearTimeout(entry.idleTimer);
    this.map.delete(sid);
    return true;
  }

  /**
   * Close the transport and delete the session.
   * Used by idle timer and LRU eviction.
   */
  private closeAndDelete(sid: string): void {
    const entry = this.map.get(sid);
    if (!entry) {
      return;
    }

    clearTimeout(entry.idleTimer);

    // Close the transport if it has a close method
    if (entry.transport.close && typeof entry.transport.close === "function") {
      try {
        entry.transport.close();
      } catch {
        // Ignore errors during cleanup
      }
    }

    this.map.delete(sid);
  }

  /**
   * Evict the least-recently-used session.
   * Finds the entry with the oldest timestamp and closes/removes it.
   */
  private evictLeastRecentlyUsed(): void {
    if (this.map.size === 0) {
      return;
    }

    let oldestSid: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [sid, entry] of this.map.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestSid = sid;
      }
    }

    if (oldestSid) {
      this.closeAndDelete(oldestSid);
    }
  }

  /**
   * Clear all sessions (useful for testing or shutdown).
   */
  clear(): void {
    for (const sid of this.map.keys()) {
      this.closeAndDelete(sid);
    }
  }
}

// Global registry instance for use in server.ts
export const mcpSessionRegistry = new McpSessionRegistry();