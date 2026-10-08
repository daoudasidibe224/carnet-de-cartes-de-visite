import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    userId: { type: String, required: true },
    cardId: { type: String, required: true },
    note: { type: String, default: "", maxlength: 2000 },
    tags: { type: [String], default: [] },
    favorite: { type: Boolean, default: false },
  },
  { timestamps: true },
);
schema.index({ userId: 1, cardId: 1 }, { unique: true });
export default model("ContactAnnotation", schema);
