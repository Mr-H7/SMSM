import { z } from "zod";

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const SAFE_ID = /^[a-zA-Z0-9_-]{8,80}$/;
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function cleanText(max: number) {
  return z.preprocess(
    (value) => String(value ?? "").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim(),
    z.string().max(max)
  );
}

export const slugParamSchema = z.object({
  slug: z.string().min(1).max(120).regex(SAFE_SLUG),
});

export const idempotencyKeySchema = z.string().min(8).max(128).regex(/^[a-zA-Z0-9:_-]+$/);

export const checkoutBodySchema = z.object({
  customer: z.object({
    name: cleanText(120).pipe(z.string().min(1)),
    phone: cleanText(40).pipe(z.string().min(3)),
    address: cleanText(300).pipe(z.string().min(3)),
    notes: cleanText(500).default(""),
  }).strict(),
  locale: z.enum(["ar", "en"]).optional().default("ar"),
  items: z.array(z.object({
    storefrontProductId: z.string().min(8).max(80).regex(SAFE_ID),
    selectedSize: cleanText(20).pipe(z.string().min(1)),
    selectedColor: cleanText(40).default(""),
    quantity: z.coerce.number().int().positive().max(99),
  }).strict()).min(1).max(50),
}).strict();

export const contactBodySchema = z.object({
  name: cleanText(120).pipe(z.string().min(1)),
  contact: cleanText(160).pipe(z.string().min(3)),
  message: cleanText(2000).pipe(z.string().min(1)),
}).strict();

export type CheckoutBody = z.infer<typeof checkoutBodySchema>;
export type ContactBody = z.infer<typeof contactBodySchema>;
