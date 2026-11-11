import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ErrorResponse } from "@ahq/api-contracts";
import { AppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(AppError.notFound("This endpoint does not exist."));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let appErr: AppError;
    if (err instanceof AppError) {
      appErr = err;
    } else if (err?.type === "entity.parse.failed") {
      appErr = AppError.badRequest("Request body is not valid JSON.");
    } else if (err?.type === "entity.too.large") {
      appErr = new AppError(413, "VALIDATION_ERROR", "Request body is too large.");
    } else if (err instanceof URIError) {
      // Malformed percent-encoding in the URL (e.g. "%E0%A4%A"): a client error, not a server fault.
      appErr = AppError.badRequest("The request URL is not valid.");
    } else if (err?.code === 11000) {
      appErr = AppError.conflict("This record already exists.");
    } else {
      logger.error({ err, requestId: req.requestId }, "unhandled error");
      appErr = new AppError(500, "INTERNAL", "Something went wrong. Please try again.");
    }
    if (appErr.status >= 500 && err instanceof AppError)
      logger.error({ err, requestId: req.requestId }, appErr.message);
    const body: ErrorResponse = {
      error: {
        code: appErr.code,
        message: appErr.message,
        ...(appErr.details ? { details: appErr.details } : {}),
        requestId: req.requestId,
      },
    };
    res.status(appErr.status).json(body);
  };
}
