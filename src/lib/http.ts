import type { Request } from "express";
import type { z } from "@ahq/api-contracts";
import { AppError } from "./errors.js";

function toDetails(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown, what: string): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw AppError.badRequest(`Invalid ${what}.`, toDetails(r.error));
  return r.data;
}

export const parseBody = <T extends z.ZodTypeAny>(req: Request, s: T) =>
  parse(s, req.body ?? {}, "request body");
export const parseQuery = <T extends z.ZodTypeAny>(req: Request, s: T) =>
  parse(s, req.query, "query parameters");
export const parseParams = <T extends z.ZodTypeAny>(req: Request, s: T) =>
  parse(s, req.params, "path parameters");

/** Narrow req.auth for handlers mounted behind `authenticate`. */
export function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthenticated();
  return req.auth;
}
