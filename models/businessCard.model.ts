import { Schema, model, type InferSchemaType } from "mongoose";
import { isEmail } from "validator";
const schema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: {
      type: String,
      required: true,
      minlength: 2,
      maxlength: 80,
      trim: true,
    },
    companyName: { type: String, maxlength: 120, trim: true },
    email: {
      type: String,
      required: true,
      validate: [isEmail, "Email invalide"],
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    tel: { type: String, maxlength: 30, trim: true },
  },
  { timestamps: true },
);
export type CardData = InferSchemaType<typeof schema>;
export default model("businessCard", schema);
