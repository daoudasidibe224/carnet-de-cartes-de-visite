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
      { $pull: { library: card.id } },
      { session },
    );
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
      { _id: userId },
      { $addToSet: { library: card.id } },
      { session },
    );
    return true;
  });
}
