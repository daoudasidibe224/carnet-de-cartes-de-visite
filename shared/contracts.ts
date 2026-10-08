import { z } from "zod";
export const contactSchema = z.object({
  name: z.string().trim().min(2).max(80),
  companyName: z.string().trim().max(120),
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  tel: z
    .string()
    .trim()
    .max(30)
    .refine((value) => !value || /^[+0-9().\s-]{6,30}$/.test(value)),
});
export type Contact = z.infer<typeof contactSchema>;
export const formSchema = z.object({
  name: z.string().optional(),
  companyName: z.string().optional(),
  email: z.string().optional(),
  tel: z.string().optional(),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
  _csrf: z.string().optional(),
});

export const annotationSchema = z.object({
  note: z.string().trim().max(2000),
  tags: z.array(z.string().trim().min(1).max(24)).max(8),
  favorite: z.boolean(),
});
export type Annotation = z.infer<typeof annotationSchema>;
