import path from "node:path";
import { existsSync } from "node:fs";
import crypto from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import session from "express-session";
import helmet from "helmet";
import { checkUser } from "./middleware/auth.middleware";
import userRoutes from "./routes/user.routes";
import cardRoutes from "./routes/businessCard.routes";
import { formValues } from "./utils/errors.utils";
import "./types";
export function createApp({
  secret,
  store,
}: {
  secret: string;
  store?: session.Store;
}) {
  if (!secret || secret.length < 32)
    throw new Error(
      "Un secret de session de 32 caractères minimum est nécessaire",
    );
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          upgradeInsecureRequests:
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use(express.json({ limit: "16kb" }));
  const publicDirectory = path.resolve(
    __dirname,
    existsSync(path.join(__dirname, "public")) ? "public" : "../public",
  );
  for (const folder of ["js", "css", "images", "fonts"])
    app.use(`/${folder}`, express.static(path.join(publicDirectory, folder)));
  app.set("views", path.join(publicDirectory, "views"));
  app.set("view engine", "pug");
  app.use(
    session({
      name: "carnet.sid",
      secret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 3 * 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.use(checkUser);
  app.use((req, res, next) => {
    if (!req.session.csrfToken)
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    res.locals.csrfToken = req.session.csrfToken;
    res.locals.notice = req.session.notice;
    delete req.session.notice;
    res.locals.errors = undefined;
    res.locals.currentPath = req.path;
    res.locals.values = {};
    if (
      req.method === "POST" &&
      formValues(req.body)._csrf !== req.session.csrfToken
    )
      return res.status(403).render("error", {
        title: "Formulaire expiré",
        message: "Rechargez la page et réessayez.",
      });
    next();
  });
  app.get("/", (req, res) =>
    res.redirect(req.user ? "/businessCard" : "/login"),
  );
  app.get("/login", (req, res) =>
    req.user ? res.redirect("/businessCard") : res.render("login"),
  );
  app.get("/register", (req, res) =>
    req.user ? res.redirect("/businessCard") : res.render("register"),
  );
  app.use("/api/user", userRoutes);
  app.use("/businessCard", cardRoutes);
  app.use((req, res) =>
    res.status(404).render("error", {
      title: "Page introuvable",
      message: "Cette page n’existe pas.",
    }),
  );
  const onError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(error instanceof Error ? error.message : "Erreur inconnue");
    res
      .status(
        error instanceof Error &&
          "status" in error &&
          typeof error.status === "number"
          ? error.status
          : 500,
      )
      .render("error", {
        title: "Une erreur est survenue",
        message: "Réessayez dans quelques instants.",
      });
  };
  app.use(onError);
  return app;
}
