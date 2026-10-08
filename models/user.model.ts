import {
  Schema,
  model,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";
import { isEmail } from "validator";
import bcrypt from "bcryptjs";
const schema = new Schema(
  {
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
      unique: true,
      maxlength: 254,
    },
    tel: { type: String, maxlength: 30, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    library: { type: [String], default: [] },
    libraryRevision: { type: Number, default: 0 },
  },
  { timestamps: true },
);
schema.pre("save", async function () {
  if (this.isModified("password"))
    this.password = await bcrypt.hash(this.password, 12);
});
export type UserData = InferSchemaType<typeof schema>;
export type UserDocument = HydratedDocument<UserData>;
const User = model("user", schema);
export default User;
export async function login(
  email: string,
  password: string,
): Promise<UserDocument> {
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select(
    "+password",
  );
  if (!user || !(await bcrypt.compare(password, user.password)))
    throw new Error("Identifiants incorrects");
  return user;
}
