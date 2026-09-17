export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireCondition(
  condition: unknown,
  status: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
export function found<T>(value: T | undefined): T {
  if (value === undefined)
    throw new AppError(
      404,
      "NOT_FOUND",
      "This record is not available in this workspace.",
    );
  return value;
}
