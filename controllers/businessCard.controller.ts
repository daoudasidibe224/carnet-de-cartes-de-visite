import ContactAnnotation from "../models/contactAnnotation.model";
import { annotationSchema } from "../shared/contracts";
import { organizeContact, removeContact } from "../services/cards.service";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createContactCard,
  CardConflict,
  deleteOwnedCard,
  saveContactCard,
} from "../services/cards.service";
import { authenticatedUser, type Controller } from "../types";
import mongoose from "mongoose";
import Card from "../models/businessCard.model";
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
  const tag =
    typeof req.query.tag === "string"
      ? req.query.tag.trim().toLowerCase().slice(0, 24)
      : "";
  const favorites = req.query.favorites === "1";
  const annotations =
    mode === "saved"
      ? await ContactAnnotation.find({ userId: authenticatedUser(req).id })
      : [];
  const annotationMap = Object.fromEntries(
    annotations.map((value) => [value.cardId, value]),
  );
  const allowed = annotations
    .filter(
      (value) =>
        (!tag || value.tags.includes(tag)) && (!favorites || value.favorite),
    )
    .map((value) => value.cardId);
  const privateMatches = q
    ? annotations
        .filter((value) =>
          `${value.note} ${value.tags.join(" ")}`
            .toLowerCase()
            .includes(q.toLowerCase()),
        )
        .map((value) => value.cardId)
    : [];

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
  const where =
    mode === "saved"
      ? {
          ...filter,
          ...(tag || favorites
            ? {
                _id: {
                  $in: authenticatedUser(req).library.filter((id) =>
                    allowed.includes(id),
                  ),
                },
              }
            : {}),
          ...(q
            ? { $or: [...(search.$or || []), { _id: { $in: privateMatches } }] }
            : {}),
        }
      : { ...filter, ...search };
  const [businessCards, total] = await Promise.all([
    Card.find(where)
      .sort({ createdAt: -1 })
      .skip((page - 1) * 12)
      .limit(12),
    Card.countDocuments(where),
  ]);
  res.render("businessCard", {
    businessCards,
    annotationMap,
    tag,
    favorites,
    availableTags: [
      ...new Set(annotations.flatMap((value) => value.tags)),
    ].sort(),
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
    creationKey: randomUUID(),
    values: {
      name: authenticatedUser(req).name,
      companyName: authenticatedUser(req).companyName,
      email: authenticatedUser(req).email,
      tel: authenticatedUser(req).tel,
    },
  });
export const addBusinessCard: Controller = async (req, res) => {
  const values = contactValues(req.body);
  const operation = z
    .object({ creationKey: z.string().uuid() })
    .safeParse(req.body);
  const creationKey = operation.success
    ? operation.data.creationKey
    : randomUUID();
  const errors = validateContact(values);
  if (!operation.success)
    errors.form = "Le formulaire a expiré. Rechargez-le avant de publier.";
  if (Object.keys(errors).length)
    return res
      .status(422)
      .render("addBusinessCard", { card: null, creationKey, values, errors });
  try {
    await createContactCard(authenticatedUser(req).id, creationKey, values);
    req.session.notice = "Votre carte est publiée dans l’annuaire.";
    res.redirect("/businessCard/mine");
  } catch (error) {
    res
      .status(error instanceof CardConflict ? 409 : 422)
      .render("addBusinessCard", {
        card: null,
        creationKey,
        values,
        errors:
          error instanceof CardConflict
            ? { form: error.message }
            : databaseErrors(error),
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
  const revision = z
    .object({ revision: z.coerce.number().int().nonnegative() })
    .safeParse(req.body);
  if (!revision.success)
    return res.status(422).render("addBusinessCard", {
      card,
      values,
      errors: { form: "Version de carte invalide. Rechargez la page." },
    });
  const result = await Card.updateOne(
    {
      _id: card.id,
      userId: authenticatedUser(req).id,
      __v: revision.data.revision,
    },
    { $set: values, $inc: { __v: 1 } },
    { runValidators: true },
  );
  if (!result.matchedCount) {
    const latest = await Card.findOne({
      _id: card.id,
      userId: authenticatedUser(req).id,
    });
    if (!latest) return missing(res);
    return res.status(409).render("addBusinessCard", {
      card: latest,
      values,
      errors: {
        form: "La carte a changé dans un autre onglet. Vérifiez vos coordonnées avant d’enregistrer à nouveau.",
      },
    });
  }
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
  await removeContact(String(req.params.id), authenticatedUser(req).id);
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

export const editAnnotation: Controller = async (req, res) => {
  const id = String(req.params.id);
  if (
    !mongoose.isObjectIdOrHexString(id) ||
    !authenticatedUser(req).library.includes(id)
  )
    return missing(res);
  const card = await Card.findById(id);
  if (!card) return missing(res);
  const annotation = await ContactAnnotation.findOne({
    userId: authenticatedUser(req).id,
    cardId: id,
  });
  res.render("organizeContact", {
    card,
    revision: annotation?.__v ?? -1,
    values: {
      note: annotation?.note || "",
      tags: annotation?.tags.join(", ") || "",
      favorite: annotation?.favorite || false,
    },
  });
};
export const saveAnnotation: Controller = async (req, res) => {
  const id = String(req.params.id);
  if (
    !mongoose.isObjectIdOrHexString(id) ||
    !authenticatedUser(req).library.includes(id)
  )
    return missing(res);
  const card = await Card.findById(id);
  if (!card) return missing(res);
  const input = z
    .object({
      note: z.string(),
      tags: z.string(),
      favorite: z.literal("on").optional(),
      revision: z.coerce.number().int().min(-1),
    })
    .safeParse(req.body);
  const raw = input.success
    ? input.data
    : { note: "", tags: "", favorite: undefined, revision: -1 };
  const parsed = annotationSchema.safeParse({
    note: raw.note,
    tags: [
      ...new Set(
        raw.tags
          .split(",")
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean),
      ),
    ],
    favorite: raw.favorite === "on",
  });
  const values = {
    note: raw.note,
    tags: raw.tags,
    favorite: raw.favorite === "on",
  };
  if (!input.success || !parsed.success)
    return res
      .status(422)
      .render("organizeContact", {
        card,
        revision: raw.revision,
        values,
        errors: {
          form: "Une note accepte 2 000 caractères et 8 étiquettes de 24 caractères maximum, séparées par des virgules.",
        },
      });
  try {
    if (
      !(await organizeContact(
        id,
        authenticatedUser(req).id,
        raw.revision,
        parsed.data,
      ))
    )
      return missing(res);
  } catch (error) {
    if (!(error instanceof CardConflict)) throw error;
    const latest = await ContactAnnotation.findOne({
      userId: authenticatedUser(req).id,
      cardId: id,
    });
    return res
      .status(409)
      .render("organizeContact", {
        card,
        revision: latest?.__v ?? -1,
        values,
        latestNote: latest?.note || "",
        errors: { form: error.message },
      });
  }
  req.session.notice = "Les notes privées de ce contact sont enregistrées.";
  res.redirect("/businessCard/savedBusinessCard");
};
export const exportLibrary: Controller = async (req, res) => {
  const user = authenticatedUser(req);
  const cards = await Card.find({
    _id: {
      $in: user.library.filter((id) => mongoose.isObjectIdOrHexString(id)),
    },
  });
  const annotations = await ContactAnnotation.find({ userId: user.id });
  const contacts = cards.map((card) => {
    const annotation = annotations.find((value) => value.cardId === card.id);
    return {
      name: card.name,
      companyName: card.companyName || "",
      email: card.email,
      tel: card.tel || "",
      note: annotation?.note || "",
      tags: annotation?.tags || [],
      favorite: annotation?.favorite || false,
    };
  });
  res
    .attachment("mon-carnet.json")
    .json({ version: 1, exportedAt: new Date().toISOString(), contacts });
};
