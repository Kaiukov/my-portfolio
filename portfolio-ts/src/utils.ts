// ponytail: rounding util — used across rebalance, projection, mwr, macro
export function roundTo(n: number, dp = 2): number {
  const factor = 10 ** dp;
  return Math.round(n * factor) / factor;
}
