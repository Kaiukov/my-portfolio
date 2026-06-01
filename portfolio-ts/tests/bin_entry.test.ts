import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const PACKAGE_ROOT = join(import.meta.dir, "..");
const PACKAGE_JSON_PATH = join(PACKAGE_ROOT, "package.json");

interface PackageJson {
  name?: string;
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
}

describe("package.json bin entry (#141)", () => {
  test("package.json declares a `portfolio` bin entry", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8")) as PackageJson;
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin).not.toBeNull();
    expect(typeof pkg.bin).toBe("object");
    expect(pkg.bin!["portfolio"]).toBeDefined();
    expect(typeof pkg.bin!["portfolio"]).toBe("string");
    expect(pkg.bin!["portfolio"].length).toBeGreaterThan(0);
  });

  test("bin target file exists and is a non-empty file", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8")) as PackageJson;
    const target = pkg.bin!["portfolio"]!;
    const abs = join(PACKAGE_ROOT, target);
    expect(existsSync(abs)).toBe(true);
    const st = statSync(abs);
    expect(st.isFile()).toBe(true);
    expect(st.size).toBeGreaterThan(0);
  });

  test("bin target is the CLI entrypoint (src/cli.ts)", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8")) as PackageJson;
    const target = pkg.bin!["portfolio"]!;
    // Normalise: strip leading "./" for comparison
    const normalised = target.replace(/^\.\//, "");
    expect(normalised).toBe("src/cli.ts");
  });

  test("bin target has `#!/usr/bin/env bun` shebang (Bun runs .ts via shebang)", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8")) as PackageJson;
    const target = pkg.bin!["portfolio"]!;
    const abs = join(PACKAGE_ROOT, target);
    const firstLine = readFileSync(abs, "utf-8").split("\n", 1)[0] ?? "";
    expect(firstLine.startsWith("#!")).toBe(true);
    expect(firstLine).toContain("bun");
  });

  test("bin target guards execution with `import.meta.main`", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8")) as PackageJson;
    const target = pkg.bin!["portfolio"]!;
    const abs = join(PACKAGE_ROOT, target);
    const src = readFileSync(abs, "utf-8");
    expect(src).toContain("import.meta.main");
  });
});
