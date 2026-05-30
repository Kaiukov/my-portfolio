import { describe, expect, test } from "bun:test";
import { success, error, buildPagination, nowUtc } from "../src/response.js";

describe("success envelope", () => {
  test("returns correct shape with data", () => {
    const env = success("test", { key: "value" });
    expect(env.ok).toBe(true);
    expect(env.command).toBe("test");
    expect(env.data).toEqual({ key: "value" });
    expect(env.meta.generated_at).toBeDefined();
    expect(env.meta.count).toBeNull();
  });

  test("includes count when provided", () => {
    const env = success("test", [1, 2, 3], 3);
    expect(env.meta.count).toBe(3);
  });

  test("includes pagination when provided", () => {
    const pagination = buildPagination(10, 0, 25);
    const env = success("test", [], 0, pagination);
    expect(env.meta.pagination).toEqual(pagination);
  });

  test("includes extra meta when provided", () => {
    const env = success("test", {}, null, undefined, { as_of_date: "2026-01-15" });
    expect(env.meta.as_of_date).toBe("2026-01-15");
  });

  test("generated_at is ISO 8601", () => {
    const env = success("test", null);
    const date = new Date(env.meta.generated_at);
    expect(date.toISOString()).toBe(env.meta.generated_at);
  });
});

describe("error envelope", () => {
  test("returns correct shape", () => {
    const env = error("test", "DB_ERROR", "Something went wrong");
    expect(env.ok).toBe(false);
    expect(env.command).toBe("test");
    expect(env.error.code).toBe("DB_ERROR");
    expect(env.error.message).toBe("Something went wrong");
    expect(env.meta.count).toBeNull();
    expect(env.meta.generated_at).toBeDefined();
  });
});

describe("buildPagination", () => {
  test("has_more true when more results exist", () => {
    const p = buildPagination(10, 0, 25);
    expect(p.has_more).toBe(true);
    expect(p.next_offset).toBe(10);
  });

  test("has_more false at the end", () => {
    const p = buildPagination(10, 20, 25);
    expect(p.has_more).toBe(false);
    expect(p.next_offset).toBeNull();
  });

  test("total is zero", () => {
    const p = buildPagination(10, 0, 0);
    expect(p.has_more).toBe(false);
    expect(p.next_offset).toBeNull();
  });
});

describe("nowUtc", () => {
  test("returns valid ISO string", () => {
    const ts = nowUtc();
    const d = new Date(ts);
    expect(d.toISOString()).toBe(ts);
  });
});
