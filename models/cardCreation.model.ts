import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    userId: { type: String, required: true },
    key: { type: String, required: true },
    cardId: { type: Schema.Types.ObjectId, required: true },
    hash: { type: String, required: true },
  },
  { timestamps: true },
);
schema.index({ userId: 1, key: 1 }, { unique: true });
export default model("CardCreation", schema);
