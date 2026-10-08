import { randomUUID } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { z } from "zod";
import Card from "../models/businessCard.model";
import User from "../models/user.model";
import ContactAnnotation from "../models/contactAnnotation.model";
import { annotationSchema, contactSchema } from "../shared/contracts";
import { CardConflict } from "./cards.service";

export const backupSchema = z
  .object({
    version: z.literal(1),
    exportedAt: z.iso.datetime().optional(),
    contacts: z
      .array(contactSchema.extend(annotationSchema.shape).strict())
      .max(200),
  })
  .strict();
type BackupContact = z.infer<typeof backupSchema>["contacts"][number];
export interface BackupPlan {
  key: string;
  userId: string;
  expiresAt: number;
  libraryRevision: number;
  contacts: {
    values: BackupContact;
    id: string;
    cardRevision: number;
    annotationRevision: number;
    saved: boolean;
  }[];
}
export function parseBackup(raw: string) {
  if (Buffer.byteLength(raw, "utf8") > 512 * 1024)
    throw new CardConflict(
      "Le fichier dépasse 512 Ko. Utilisez une sauvegarde de 200 contacts maximum.",
    );
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new CardConflict(
      "Le fichier ne contient pas un document JSON valide.",
    );
  }
  const parsed = backupSchema.safeParse(value);
  if (!parsed.success)
    throw new CardConflict(
      "Cette sauvegarde n’est pas compatible. Utilisez le fichier JSON exporté par le carnet (version 1, 200 contacts maximum).",
    );
  const keys = parsed.data.contacts.map(
    (contact) => `${contact.name}\u0000${contact.email}`,
  );
  if (new Set(keys).size !== keys.length)
    throw new CardConflict(
      "La sauvegarde contient plusieurs fois le même contact. Retirez les doublons avant de réessayer.",
    );
  return parsed.data.contacts;
}
async function resolveContacts(
  userId: string,
  values: BackupContact[],
  session?: ClientSession,
) {
  const result: BackupPlan["contacts"] = [];
  const user = await User.findById(userId).session(session ?? null);
  if (!user) throw new CardConflict("Votre compte n’est plus disponible.");
  for (const contact of values) {
    const cards = await Card.find({
      name: contact.name,
      email: contact.email,
      userId: { $ne: userId },
    })
      .limit(2)
      .session(session ?? null);
    if (cards.length !== 1)
      throw new CardConflict(
        cards.length
          ? `Plusieurs cartes correspondent à ${contact.name}. La restauration ne peut pas choisir à votre place.`
          : `La carte de ${contact.name} n’est plus disponible dans l’annuaire. Aucun contact n’a été restauré.`,
      );
    const card = cards[0];
    if (!card) throw new CardConflict("Carte introuvable.");
    const previous = await ContactAnnotation.findOne({
      userId,
      cardId: card.id,
    }).session(session ?? null);
    if (
      previous &&
      (previous.note !== contact.note ||
        previous.favorite !== contact.favorite ||
        JSON.stringify(previous.tags) !== JSON.stringify(contact.tags))
    )
      throw new CardConflict(
        `Vos notes de ${contact.name} diffèrent de la sauvegarde. Elles sont conservées ; aucune restauration n’a été appliquée.`,
      );
    result.push({
      values: contact,
      id: card.id,
      cardRevision: card.__v,
      annotationRevision: previous?.__v ?? -1,
      saved: user.library.includes(card.id),
    });
  }
  return { user, contacts: result };
}
export async function previewBackup(
  userId: string,
  raw: string,
): Promise<BackupPlan> {
  const { user, contacts } = await resolveContacts(userId, parseBackup(raw));
  return {
    key: randomUUID(),
    userId,
    expiresAt: Date.now() + 5 * 60_000,
    libraryRevision: user.libraryRevision,
    contacts,
  };
}
export async function applyBackup(userId: string, plan: BackupPlan) {
  if (plan.userId !== userId || plan.expiresAt <= Date.now())
    throw new CardConflict(
      "L’aperçu a expiré. Vérifiez à nouveau la sauvegarde.",
    );
  return mongoose.connection.transaction(async (session) => {
    const current = await resolveContacts(
      userId,
      plan.contacts.map((item) => item.values),
      session,
    );
    if (
      current.user.libraryRevision !== plan.libraryRevision ||
      current.contacts.some((item, index) => {
        const expected = plan.contacts[index];
        return (
          !expected ||
          item.id !== expected.id ||
          item.cardRevision !== expected.cardRevision ||
          item.annotationRevision !== expected.annotationRevision ||
          item.saved !== expected.saved
        );
      })
    )
      throw new CardConflict(
        "Le carnet ou une carte a changé depuis l’aperçu. Aucun contact n’a été restauré. Vérifiez à nouveau la sauvegarde.",
      );
    const locked = await User.updateOne(
      { _id: userId, libraryRevision: plan.libraryRevision },
      {
        $inc: { libraryRevision: 1 },
        $addToSet: { library: { $each: plan.contacts.map((item) => item.id) } },
      },
      { session },
    );
    if (!locked.matchedCount)
      throw new CardConflict(
        "Votre carnet a changé. Vérifiez à nouveau la sauvegarde.",
      );
    for (const item of plan.contacts) {
      const card = await Card.updateOne(
        { _id: item.id, __v: item.cardRevision },
        { $set: { updatedAt: new Date() } },
        { session },
      );
      if (!card.matchedCount)
        throw new CardConflict(
          "Une carte a changé. Vérifiez à nouveau la sauvegarde.",
        );
      if (item.annotationRevision === -1)
        await ContactAnnotation.create(
          [
            {
              userId,
              cardId: item.id,
              note: item.values.note,
              tags: item.values.tags,
              favorite: item.values.favorite,
            },
          ],
          { session },
        );
    }
    return plan.contacts.length;
  });
}
