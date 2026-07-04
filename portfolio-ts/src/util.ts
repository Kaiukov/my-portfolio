/**
 * Round a number to a given number of decimal places.
 */
export function roundTo(n: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
