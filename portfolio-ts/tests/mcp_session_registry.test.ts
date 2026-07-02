import { describe, test, expect, beforeEach, mock } from "bun:test";

// Mock the transport class
class MockTransport {
  public sessionId?: string;
  public closeCalls = 0;

  constructor(sid?: string) {
    this.sessionId = sid;
  }

  close() {
    this.closeCalls++;
  }
}

// Import after defining mock
import { McpSessionRegistry, MCP_MAX_SESSIONS, MCP_SESSION_IDLE_MS } from "../src/api/mcp_session_registry.js";

describe("McpSessionRegistry", () => {
  let registry: McpSessionRegistry;
  let transports: MockTransport[];

  beforeEach(() => {
    registry = new McpSessionRegistry(3, 100); // Small values for testing
    transports = [];
  });

  function createTransport(sid?: string): MockTransport {
    const transport = new MockTransport(sid);
    transports.push(transport);
    return transport;
  }

  test("set adds a transport and get retrieves it", () => {
    const transport = createTransport("session-1");
    registry.set("session-1", transport as any);

    expect(registry.size).toBe(1);
    expect(registry.get("session-1")).toBe(transport as any);
  });

  test("get marks entry as most-recently-used", async () => {
    const t1 = createTransport("session-1");
    const t2 = createTransport("session-2");
    const t3 = createTransport("session-3");

    // Insert in order with small delays to ensure timestamps differ
    registry.set("session-1", t1 as any);
    await new Promise(resolve => setTimeout(resolve, 1));
    registry.set("session-2", t2 as any);
    await new Promise(resolve => setTimeout(resolve, 1));
    registry.set("session-3", t3 as any);
    await new Promise(resolve => setTimeout(resolve, 1));

    // Access oldest to make it most recent
    registry.get("session-1");

    // Insert a 4th session - should evict session-2 (now oldest since 1 was accessed)
    const t4 = createTransport("session-4");
    registry.set("session-4", t4 as any);

    expect(registry.size).toBe(3);
    expect(registry.get("session-1")).toBe(t1 as any); // Was accessed, still there
    expect(registry.get("session-2")).toBeUndefined(); // Was evicted (oldest)
    expect(registry.get("session-3")).toBe(t3 as any); // Still there
    expect(registry.get("session-4")).toBe(t4 as any); // Newly inserted
  });

  test("evicts least-recently-used when at capacity", () => {
    const t1 = createTransport("session-1");
    const t2 = createTransport("session-2");
    const t3 = createTransport("session-3");

    registry.set("session-1", t1 as any);
    registry.set("session-2", t2 as any);
    registry.set("session-3", t3 as any);

    expect(registry.size).toBe(3);

    // Add a 4th transport - should evict session-1 (oldest)
    const t4 = createTransport("session-4");
    registry.set("session-4", t4 as any);

    expect(registry.size).toBe(3);
    expect(registry.get("session-1")).toBeUndefined(); // Evicted
    expect(registry.get("session-2")).toBe(t2 as any); // Still there
    expect(registry.get("session-3")).toBe(t3 as any); // Still there
    expect(registry.get("session-4")).toBe(t4 as any); // Newly inserted

    // Check that evicted transport was closed
    expect(t1.closeCalls).toBe(1);
    expect(t2.closeCalls).toBe(0);
    expect(t3.closeCalls).toBe(0);
    expect(t4.closeCalls).toBe(0);
  });

  test("delete removes transport and clears idle timer", () => {
    const transport = createTransport("session-1");
    registry.set("session-1", transport as any);

    expect(registry.size).toBe(1);

    registry.delete("session-1");

    expect(registry.size).toBe(0);
    expect(registry.get("session-1")).toBeUndefined();
  });

  test("delete returns false for non-existent session", () => {
    expect(registry.delete("non-existent")).toBe(false);
  });

  test("replacing existing session clears old idle timer", () => {
    const transport = createTransport("session-1");
    registry.set("session-1", transport as any);

    // Replace with new transport
    const transport2 = createTransport("session-1");
    registry.set("session-1", transport2 as any);

    expect(registry.size).toBe(1);
    expect(registry.get("session-1")).toBe(transport2 as any);
  });

  test("idle timer removes session after timeout", async () => {
    const transport = createTransport("session-1");

    // Create registry with 50ms idle timeout
    const fastRegistry = new McpSessionRegistry(10, 50);
    fastRegistry.set("session-1", transport as any);

    expect(fastRegistry.size).toBe(1);
    expect(fastRegistry.get("session-1")).toBe(transport as any);

    // Wait for idle timer to fire
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(fastRegistry.size).toBe(0);
    expect(fastRegistry.get("session-1")).toBeUndefined();
    expect(transport.closeCalls).toBe(1);
  });

  test("get resets idle timer", async () => {
    const transport = createTransport("session-1");

    // Create registry with 100ms idle timeout
    const fastRegistry = new McpSessionRegistry(10, 100);
    fastRegistry.set("session-1", transport as any);

    // Wait 50ms (within idle window)
    await new Promise(resolve => setTimeout(resolve, 50));

    // Access the session to reset timer
    expect(fastRegistry.get("session-1")).toBe(transport as any);

    // Wait another 80ms (total 130ms, should still be alive due to reset)
    await new Promise(resolve => setTimeout(resolve, 80));

    // Session should still be alive
    expect(fastRegistry.size).toBe(1);
    expect(fastRegistry.get("session-1")).toBe(transport as any);
    expect(transport.closeCalls).toBe(0);
  });

  test("clear removes all sessions and closes transports", () => {
    const t1 = createTransport("session-1");
    const t2 = createTransport("session-2");
    const t3 = createTransport("session-3");

    registry.set("session-1", t1 as any);
    registry.set("session-2", t2 as any);
    registry.set("session-3", t3 as any);

    expect(registry.size).toBe(3);

    registry.clear();

    expect(registry.size).toBe(0);
    expect(t1.closeCalls).toBe(1);
    expect(t2.closeCalls).toBe(1);
    expect(t3.closeCalls).toBe(1);
  });

  test("inserting MAX_SESSIONS + 10 leaves exactly MAX_SESSIONS", () => {
    // Use default max sessions from env
    const defaultRegistry = new McpSessionRegistry();

    const allTransports: MockTransport[] = [];

    // Insert MAX_SESSIONS + 10 sessions
    for (let i = 0; i < MCP_MAX_SESSIONS + 10; i++) {
      const transport = createTransport(`session-${i}`);
      allTransports.push(transport);
      defaultRegistry.set(`session-${i}`, transport as any);
    }

    // Size should be exactly MAX_SESSIONS
    expect(defaultRegistry.size).toBe(MCP_MAX_SESSIONS);

    // First 10 sessions should be evicted (LRU order)
    for (let i = 0; i < 10; i++) {
      expect(defaultRegistry.get(`session-${i}`)).toBeUndefined();
      expect(allTransports[i].closeCalls).toBe(1);
    }

    // Remaining sessions should be present
    for (let i = 10; i < MCP_MAX_SESSIONS + 10; i++) {
      expect(defaultRegistry.get(`session-${i}`)).not.toBeUndefined();
      expect(allTransports[i].closeCalls).toBe(0);
    }
  });

  test("uses default env config when not specified", () => {
    // Should use MCP_MAX_SESSIONS and MCP_SESSION_IDLE_MS from env
    const defaultRegistry = new McpSessionRegistry();

    // Can't easily verify the exact values without checking internals,
    // but we can verify it works
    const transport = createTransport("session-1");
    defaultRegistry.set("session-1", transport as any);

    expect(defaultRegistry.size).toBe(1);
    expect(defaultRegistry.get("session-1")).toBe(transport as any);
  });

  test("close handles errors gracefully", () => {
    const badTransport = {
      sessionId: "bad-session",
      close: () => {
        throw new Error("Close failed");
      },
    };

    registry.set("bad-session", badTransport as any);

    // Should not throw even if close() errors
    expect(() => registry.delete("bad-session")).not.toThrow();
    expect(registry.size).toBe(0);
  });

  test("multiple get calls update LRU order correctly", async () => {
    const t1 = createTransport("session-1");
    const t2 = createTransport("session-2");
    const t3 = createTransport("session-3");

    registry.set("session-1", t1 as any);
    await new Promise(resolve => setTimeout(resolve, 1));
    registry.set("session-2", t2 as any);
    await new Promise(resolve => setTimeout(resolve, 1));
    registry.set("session-3", t3 as any);
    await new Promise(resolve => setTimeout(resolve, 1));

    // Access in order to establish LRU: 3, 2, 1 (most recent last)
    registry.get("session-3");
    await new Promise(resolve => setTimeout(resolve, 1));
    registry.get("session-2");
    await new Promise(resolve => setTimeout(resolve, 1));
    registry.get("session-1");

    // Add 4th - should evict session-3 (now oldest after the accesses)
    const t4 = createTransport("session-4");
    registry.set("session-4", t4 as any);

    expect(registry.size).toBe(3);
    expect(registry.get("session-3")).toBeUndefined(); // Evicted (oldest)
    expect(registry.get("session-1")).toBe(t1 as any); // Most recent, still there
    expect(registry.get("session-2")).toBe(t2 as any); // Still there
    expect(registry.get("session-4")).toBe(t4 as any); // Newly inserted
  });
});