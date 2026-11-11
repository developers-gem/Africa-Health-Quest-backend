import type { ErrorCode } from "@ahq/api-contracts";

export type ErrorDetail = { path: string; message: string };

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "AppError";
  }

  static badRequest(message: string, details?: ErrorDetail[]) {
    return new AppError(400, "VALIDATION_ERROR", message, details);
  }
  static unauthenticated(message = "Please sign in to continue.") {
    return new AppError(401, "UNAUTHENTICATED", message);
  }
  static tokenInvalid(message = "This link or token is invalid or has expired.") {
    return new AppError(401, "TOKEN_INVALID", message);
  }
  static forbidden(message = "You don't have permission to do that.") {
    return new AppError(403, "FORBIDDEN", message);
  }
  static notFound(message = "Not found.") {
    return new AppError(404, "NOT_FOUND", message);
  }
  static conflict(message: string) {
    return new AppError(409, "CONFLICT", message);
  }
  static unavailable(message: string) {
    return new AppError(503, "SERVICE_UNAVAILABLE", message);
  }
}
