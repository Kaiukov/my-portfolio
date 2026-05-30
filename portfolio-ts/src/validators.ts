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

export function parseWriteDate(dateStr: string, flagName: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dateStr);
  if (!m) {
    throw new ValidationError(
      `${flagName}: expected DD-MM-YYYY format, got ${JSON.stringify(dateStr)}`,
    );
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
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
