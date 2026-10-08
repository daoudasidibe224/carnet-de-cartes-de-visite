import mongoose from "mongoose";
import { contactSchema, formSchema, type Contact } from "../shared/contracts";
export function formValues(body: unknown) {
  const parsed = formSchema.safeParse(body);
  return parsed.success ? parsed.data : {};
}
export function contactValues(body: unknown): Contact {
  const values = formValues(body);
  return {
    name: values.name?.trim() || "",
    companyName: values.companyName?.trim() || "",
    email: values.email?.trim().toLowerCase() || "",
    tel: values.tel?.trim() || "",
  };
}
export function validateContact(values: Contact): Record<string, string> {
  const parsed = contactSchema.safeParse(values),
    errors: Record<string, string> = {};
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      errors[key] =
        key === "email"
          ? "Saisissez une adresse email valide."
          : key === "name"
            ? "Le nom doit contenir de 2 à 80 caractères."
            : key === "tel"
              ? "Saisissez un numéro de téléphone valide."
              : "Le nom de l’entreprise est limité à 120 caractères.";
    }
  return errors;
}
export function isDuplicate(error: unknown) {
  return error instanceof Error && "code" in error && error.code === 11000;
}
export function databaseErrors(error: unknown): Record<string, string> {
  if (isDuplicate(error)) return { email: "Cet email est déjà utilisé." };
  if (error instanceof mongoose.Error.ValidationError)
    return Object.fromEntries(
      Object.keys(error.errors).map((key) => [key, "Vérifiez ce champ."]),
    );
  throw error;
}
