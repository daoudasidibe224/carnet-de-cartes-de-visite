import { createHash } from "node:crypto";
import ContactAnnotation from "../models/contactAnnotation.model";
import type { Annotation } from "../shared/contracts";
import CardCreation from "../models/cardCreation.model";
import { isDuplicate } from "../utils/errors.utils";
import type { Contact } from "../shared/contracts";
import mongoose from "mongoose";
import Card from "../models/businessCard.model";
import User from "../models/user.model";
// Une suppression retire la carte et ses références dans une même transaction.
export async function deleteOwnedCard(id: string, userId: string) {
  return mongoose.connection.transaction(async (session) => {
    const card = await Card.findOneAndDelete({ _id: id, userId }, { session });
    if (!card) return false;
    await User.updateMany(
      { library: card.id },
      { $pull: { library: card.id }, $inc: { libraryRevision: 1 } },
      { session },
    );
    await ContactAnnotation.deleteMany({ cardId: card.id }, { session });
    return true;
  });
}
export async function saveContactCard(id: string, userId: string) {
  return mongoose.connection.transaction(async (session) => {
    const card = await Card.findOne({
      _id: id,
      userId: { $ne: userId },
    }).session(session);
    if (!card) return false;
    // Le verrou d'écriture de la carte sérialise l'ajout avec sa suppression.
    await Card.updateOne(
      { _id: card.id },
      { $set: { updatedAt: new Date() } },
      { session },
    );
    await User.updateOne(
      { _id: userId, library: { $ne: card.id } },
      { $addToSet: { library: card.id }, $inc: { libraryRevision: 1 } },
      { session },
    );
    return true;
  });
}

export async function createContactCard(
  userId: string,
  key: string,
  values: Contact,
) {
  const hash = createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex");
  const replay = async () => {
    const operation = await CardCreation.findOne({ userId, key });
    if (!operation) return null;
    if (operation.hash !== hash)
      throw new CardConflict(
        "Ce formulaire a déjà servi à publier une autre carte. Ouvrez un nouveau formulaire.",
      );
    const card = await Card.findOne({ _id: operation.cardId, userId });
    if (!card)
      throw new CardConflict(
        "Cette carte a été supprimée. Ouvrez un nouveau formulaire pour en publier une autre.",
      );
    return card;
  };
  const existing = await replay();
  if (existing) return existing;
  try {
    return await mongoose.connection.transaction(async (session) => {
      const [card] = await Card.create([{ ...values, userId }], { session });
      if (!card) throw new Error("Création de la carte impossible.");
      await CardCreation.create([{ userId, key, hash, cardId: card._id }], {
        session,
      });
      return card;
    });
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    const card = await replay();
    if (!card) throw error;
    return card;
  }
}
export class CardConflict extends Error {}

export async function removeContact(id: string, userId: string) {
  await mongoose.connection.transaction(async (session) => {
    await User.updateOne(
      { _id: userId },
      { $pull: { library: id }, $inc: { libraryRevision: 1 } },
      { session },
    );
    await ContactAnnotation.deleteOne({ userId, cardId: id }, { session });
  });
}
export async function organizeContact(
  id: string,
  userId: string,
  revision: number,
  values: Annotation,
) {
  return mongoose.connection.transaction(async (session) => {
    const user = await User.findOne({ _id: userId, library: id }).session(
      session,
    );
    const card = await Card.findById(id).session(session);
    if (!user || !card) return false;
    await User.updateOne(
      { _id: userId },
      { $inc: { libraryRevision: 1 } },
      { session },
    );
    await Card.updateOne(
      { _id: id },
      { $set: { updatedAt: new Date() } },
      { session },
    );
    const previous = await ContactAnnotation.findOne({
      userId,
      cardId: id,
    }).session(session);
    if (previous ? previous.__v !== revision : revision !== -1)
      throw new CardConflict(
        "Vos notes ont changé dans un autre onglet. Relisez-les avant d’enregistrer à nouveau.",
      );
    if (previous) {
      await ContactAnnotation.updateOne(
        { _id: previous.id, __v: revision },
        { $set: values, $inc: { __v: 1 } },
        { session },
      );
    } else {
      await ContactAnnotation.create([{ userId, cardId: id, ...values }], {
        session,
      });
    }
    return true;
  });
}
