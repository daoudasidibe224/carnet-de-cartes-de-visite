import { type Controller } from "../types";
import User, { login, type UserDocument } from "../models/user.model";
import {
  contactValues,
  validateContact,
  databaseErrors,
  isDuplicate,
  formValues,
} from "../utils/errors.utils";
export const signUp: Controller = async (req, res) => {
  const values = contactValues(req.body);
  if (!values.name) values.name = "Membre";
  const password = formValues(req.body).password;
  const errors = validateContact(values);
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    Buffer.byteLength(password) > 72
  )
    errors.password = "Utilisez au moins 8 caractères et au maximum 72 octets.";
  if (
    formValues(req.body).confirmPassword !== undefined &&
    password !== formValues(req.body).confirmPassword
  )
    errors.confirmPassword = "Les mots de passe ne correspondent pas.";
  if (typeof password !== "string" || Object.keys(errors).length)
    return res.status(422).render("register", { values, errors });
  try {
    await User.create({
      ...values,
      password,
    });
    req.session.notice = "Compte créé. Vous pouvez maintenant vous connecter.";
    res.redirect("/login");
  } catch (error) {
    res
      .status(isDuplicate(error) ? 409 : 422)
      .render("register", { values, errors: databaseErrors(error) });
  }
};
export const signIn: Controller = async (req, res, next) => {
  const email = formValues(req.body).email?.trim().toLowerCase() || "";
  const password = formValues(req.body).password;
  if (!email || typeof password !== "string" || !password)
    return res.status(422).render("login", {
      values: { email },
      errors: { login: "Saisissez un email et un mot de passe." },
    });
  let user: UserDocument;
  try {
    user = await login(email, password);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "Identifiants incorrects"
    )
      throw error;
    return res.status(401).render("login", {
      values: { email },
      errors: { login: "Email ou mot de passe incorrect." },
    });
  }
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.userId = user.id;
    req.session.save((err) =>
      err ? next(err) : res.redirect("/businessCard"),
    );
  });
};
export const logout: Controller = (req, res, next) =>
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("carnet.sid");
    res.redirect("/login");
  });
