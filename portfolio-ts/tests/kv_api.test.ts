import { describe, expect, test } from "bun:test";
import { putKvValueViaApi, type FetchLike } from "../src/cloudflare/kv_api.js";

describe("putKvValueViaApi", () => {
  test("sends the correct request and returns ok on 200", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push([input, init]);
      return new Response("", { status: 200 });
    };

    const result = await putKvValueViaApi({
      accountId: "abcdef1234567890abcdef1234567890",
      namespaceId: "kv-namespace-12345",
      key: "portfolio",
      value: '{"ok":true}',
      apiToken: "api-token-123",
      fetchImpl,
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);

    const [input, init] = calls[0];
    expect(String(input)).toBe(
      "https://api.cloudflare.com/client/v4/accounts/abcdef1234567890abcdef1234567890/storage/kv/namespaces/kv-namespace-12345/values/portfolio",
    );
    expect(init?.method).toBe("PUT");

    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer api-token-123");
    expect(headers.get("content-type")).toBe("text/plain");
    expect(init?.body).toBe('{"ok":true}');
  });

  test("returns an error string on non-2xx responses", async () => {
    const fetchImpl: FetchLike = async () => new Response("denied", { status: 403 });

    const result = await putKvValueViaApi({
      accountId: "abcdef1234567890abcdef1234567890",
      namespaceId: "kv-namespace-12345",
      key: "portfolio",
      value: "payload",
      apiToken: "api-token-123",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("KV API put failed (status 403)");
      expect(result.error).toContain("denied");
    }
  });

  test("returns an error string on thrown network failure", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("network down");
    };

    const result = await putKvValueViaApi({
      accountId: "abcdef1234567890abcdef1234567890",
      namespaceId: "kv-namespace-12345",
      key: "portfolio",
      value: "payload",
      apiToken: "api-token-123",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("network down");
    }
  });
});
