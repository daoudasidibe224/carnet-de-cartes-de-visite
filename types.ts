import type { Request, RequestHandler } from "express";
import type { ParamsDictionary } from "express-serve-static-core";
import type { UserDocument } from "./models/user.model";
export type Controller = RequestHandler<ParamsDictionary, unknown, unknown>;
declare module "express-session" {
  interface SessionData {
    csrfToken?: string;
    userId?: string;
    notice?: string;
  }
}
declare module "express-serve-static-core" {
  interface Request {
    user?: UserDocument | null;
  }
}
export function authenticatedUser(
  req: Request<ParamsDictionary, unknown, unknown>,
): UserDocument {
  if (!req.user) throw new Error("Connexion nécessaire");
  return req.user;
}
