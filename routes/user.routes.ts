import { Router } from "express";
const router = Router();
import { rateLimit } from "express-rate-limit";
import * as auth from "../controllers/auth.controller";
import * as user from "../controllers/user.controller";
import { requireAuth } from "../middleware/auth.middleware";
const limit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: "Trop de tentatives. Réessayez dans quelques minutes.",
});
router.post("/register", limit, auth.signUp);
router.post("/login", limit, auth.signIn);
router.post("/logout", auth.logout);
router.use(requireAuth);
router.get("/", user.getAllUsers);
router.get("/:id", user.userInfo);
router.post("/profile", user.updateProfile);
export default router;
