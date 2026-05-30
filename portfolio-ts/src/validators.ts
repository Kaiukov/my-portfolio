export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export function parseDate(dateStr: string, flagName: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (iso) {
    return dateStr;
  }
  const legacy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dateStr);
  if (legacy) {
    console.warn(
      `[deprecated] ${flagName}: DD-MM-YYYY format is deprecated, use YYYY-MM-DD instead`,
    );
    return `${legacy[3]}-${legacy[2]}-${legacy[1]}`;
  }
  throw new ValidationError(
    `${flagName}: expected ISO 8601 format YYYY-MM-DD, got ${JSON.stringify(dateStr)}`,
  );
}

export function validatePositiveFloat(
  val: number | undefined,
  flagName: string,
  command: string,
): void {
  if (val === undefined || !Number.isFinite(val) || val <= 0) {
    throw new ValidationError(`${flagName} must be a positive number (command: ${command})`);
  }
}

export function validateNonNegativeFloat(
  val: number | undefined,
  flagName: string,
  command: string,
): void {
  if (val === undefined || !Number.isFinite(val) || val < 0) {
    throw new ValidationError(
      `${flagName} must be a non-negative number (command: ${command})`,
    );
  }
}

export function validatePositiveInt(
  val: number | undefined,
  flagName: string,
  command: string,
): void {
  if (val === undefined || !Number.isInteger(val) || val <= 0) {
    throw new ValidationError(`${flagName} must be a positive integer (command: ${command})`);
  }
}
