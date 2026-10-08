import type { Controller } from "../types";
import User from "../models/user.model";
export const checkUser: Controller = async (req, res, next) => {
  try {
    req.user = req.session.userId
      ? await User.findById(req.session.userId).select("-password")
      : null;
    res.locals.user = req.user;
    next();
  } catch (error) {
    next(error);
  }
};
export const requireAuth: Controller = (req, res, next) => {
  if (req.user) return next();
  res.redirect("/login");
};
