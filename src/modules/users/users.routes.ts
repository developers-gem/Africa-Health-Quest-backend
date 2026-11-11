import { UpdateProfileRequestSchema } from "@ahq/api-contracts";
import { Router, type RequestHandler } from "express";
import { parseBody, requireAuth } from "../../lib/http.js";
import { toUserDto } from "./user.mapper.js";

export function usersRouter(deps: { authenticate: RequestHandler }) {
  const r = Router();
  r.use(deps.authenticate);

  r.get("/me", (req, res) => {
    res.json(toUserDto(requireAuth(req).user));
  });

  r.patch("/me", async (req, res) => {
    const { user } = requireAuth(req);
    user.displayName = parseBody(req, UpdateProfileRequestSchema).displayName;
    await user.save();
    res.json(toUserDto(user));
  });

  return r;
}
