/**
 * Round a number to a given number of decimal places.
 * Uses Math.round with multiplier to avoid floating-point drift.
 */
export function roundTo(n: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
