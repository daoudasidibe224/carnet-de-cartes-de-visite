import { deleteOwnedCard, saveContactCard } from "../services/cards.service";
import { authenticatedUser, type Controller } from "../types";
import mongoose from "mongoose";
import Card from "../models/businessCard.model";
import User from "../models/user.model";
import {
  contactValues,
  validateContact,
  databaseErrors,
} from "../utils/errors.utils";
const missing = (res: import("express").Response) =>
  res.status(404).render("error", {
    title: "Carte introuvable",
    message: "Cette carte n’existe plus ou ne vous appartient pas.",
  });
const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function getQuery(req: import("express").Request) {
  const q =
    typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const page = Math.max(
    1,
    Math.min(
      10000,
      parseInt(typeof req.query.page === "string" ? req.query.page : "1", 10) ||
        1,
    ),
  );
  const search = q
    ? {
        $or: ["name", "companyName", "email"].map((field) => ({
          [field]: { $regex: escapeRegex(q), $options: "i" },
        })),
      }
    : {};
  return { q, page, search };
}
async function list(
  req: import("express").Request,
  res: import("express").Response,
  mode: "mine" | "saved" | "directory",
) {
  const { q, page, search } = getQuery(req);
  const filter =
    mode === "mine"
      ? { userId: authenticatedUser(req).id }
      : mode === "saved"
        ? {
            _id: {
              $in: authenticatedUser(req).library.filter((id) =>
                mongoose.isObjectIdOrHexString(id),
              ),
            },
          }
        : { userId: { $ne: authenticatedUser(req).id } };
  const where = { ...filter, ...search };
  const [businessCards, total] = await Promise.all([
    Card.find(where)
      .sort({ createdAt: -1 })
      .skip((page - 1) * 12)
      .limit(12),
    Card.countDocuments(where),
  ]);
  res.render("businessCard", {
    businessCards,
    mode,
    q,
    page,
    total,
    pages: Math.ceil(total / 12),
  });
}
export const getAllbusinessCard: Controller = (req, res) =>
  list(req, res, "directory");
export const getMySavedBusinessCard: Controller = (req, res) =>
  list(req, res, "saved");
export const getMyCards: Controller = (req, res) => list(req, res, "mine");
export const newCard: Controller = (req, res) =>
  res.render("addBusinessCard", {
    card: null,
    values: {
      name: authenticatedUser(req).name,
      companyName: authenticatedUser(req).companyName,
      email: authenticatedUser(req).email,
      tel: authenticatedUser(req).tel,
    },
  });
export const addBusinessCard: Controller = async (req, res) => {
  const values = contactValues(req.body);
  const errors = validateContact(values);
  if (Object.keys(errors).length)
    return res
      .status(422)
      .render("addBusinessCard", { card: null, values, errors });
  try {
    await Card.create({ ...values, userId: authenticatedUser(req).id });
    req.session.notice = "Votre carte est publiée dans l’annuaire.";
    res.redirect("/businessCard/mine");
  } catch (error) {
    res.status(422).render("addBusinessCard", {
      card: null,
      values,
      errors: databaseErrors(error),
    });
  }
};
export const editCard: Controller = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return missing(res);
  const card = await Card.findOne({
    _id: req.params.id,
    userId: authenticatedUser(req).id,
  });
  if (!card) return missing(res);
  res.render("addBusinessCard", { card, values: card });
};
export const updateCard: Controller = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return missing(res);
  const card = await Card.findOne({
    _id: req.params.id,
    userId: authenticatedUser(req).id,
  });
  if (!card) return missing(res);
  const values = contactValues(req.body);
  const errors = validateContact(values);
  if (Object.keys(errors).length)
    return res.status(422).render("addBusinessCard", { card, values, errors });
  await Card.updateOne(
    { _id: card.id, userId: authenticatedUser(req).id },
    { $set: values },
    { runValidators: true },
  );
  req.session.notice = "Votre carte a été mise à jour.";
  res.redirect("/businessCard/mine");
};
export const deleteCard: Controller = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return missing(res);
  if (
    !(await deleteOwnedCard(String(req.params.id), authenticatedUser(req).id))
  )
    return missing(res);
  req.session.notice =
    "La carte a été supprimée de l’annuaire et des bibliothèques.";
  res.redirect("/businessCard/mine");
};
export const saveToLibrary: Controller = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return missing(res);
  if (
    !(await saveContactCard(String(req.params.id), authenticatedUser(req).id))
  )
    return missing(res);
  req.session.notice = "Carte ajoutée à votre bibliothèque.";
  res.redirect("/businessCard/savedBusinessCard");
};
export const removeFromLibrary: Controller = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return missing(res);
  await User.updateOne(
    { _id: authenticatedUser(req).id },
    { $pull: { library: req.params.id } },
  );
  req.session.notice = "Carte retirée de votre bibliothèque.";
  res.redirect("/businessCard/savedBusinessCard");
};
const vEscape = (value: string | null | undefined = "") =>
  String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
export const exportCard: Controller = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return missing(res);
  const card = await Card.findById(req.params.id);
  if (!card) return missing(res);
  const content = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${vEscape(card.name)}`,
    `N:;${vEscape(card.name)};;;`,
    `ORG:${vEscape(card.companyName)}`,
    `EMAIL;TYPE=INTERNET:${vEscape(card.email)}`,
    `TEL:${vEscape(card.tel)}`,
    "END:VCARD",
    "",
  ].join("\r\n");
  res.attachment(`contact-${card.id}.vcf`).type("text/vcard").send(content);
};
