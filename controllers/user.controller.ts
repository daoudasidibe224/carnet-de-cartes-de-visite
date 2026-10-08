import { authenticatedUser, type Controller } from "../types";
import User from "../models/user.model";
import {
  contactValues,
  validateContact,
  databaseErrors,
  isDuplicate,
} from "../utils/errors.utils";
export const getAllUsers: Controller = async (req, res) => {
  // L'endpoint historique ne publie pas la liste des comptes.
  res.json([
    {
      _id: authenticatedUser(req).id,
      name: authenticatedUser(req).name,
      companyName: authenticatedUser(req).companyName,
    },
  ]);
};
export const userInfo: Controller = (req, res) => {
  if (req.params.id !== authenticatedUser(req).id)
    return res.status(403).render("error", {
      title: "Profil privé",
      message: "Vous pouvez consulter et modifier votre propre profil.",
    });
  res.render("profil", { values: req.user });
};
export const updateProfile: Controller = async (req, res) => {
  const values = contactValues(req.body);
  const errors = validateContact(values);
  if (Object.keys(errors).length)
    return res.status(422).render("profil", { values, errors });
  try {
    await User.findByIdAndUpdate(
      authenticatedUser(req).id,
      { $set: values },
      { runValidators: true },
    );
    req.session.notice = "Votre profil a été enregistré.";
    res.redirect(`/api/user/${authenticatedUser(req).id}`);
  } catch (error) {
    res
      .status(isDuplicate(error) ? 409 : 422)
      .render("profil", { values, errors: databaseErrors(error) });
  }
};
