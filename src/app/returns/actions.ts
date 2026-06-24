"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const returnedItemInputSchema = z.object({
  saleItemId: z.string().trim().min(1).max(128),
  qty: z.coerce.number().int().positive().max(999),
});

const replacementItemInputSchema = z.object({
  variantId: z.string().trim().min(1).max(128),
  qty: z.coerce.number().int().positive().max(999),
});

type ReturnedItemInput = z.infer<typeof returnedItemInputSchema>;
type ReplacementItemInput = z.infer<typeof replacementItemInputSchema>;

function parseJsonArray<T>(raw: string, schema: z.ZodType<T>, errorMessage: string): T[] {
  if (!raw) return [];

  try {
    return z.array(schema).max(200).parse(JSON.parse(raw));
  } catch {
    throw new Error(errorMessage);
  }
}

const returnFormSchema = z.object({
  saleId: z.string().trim().min(1).max(128),
  type: z.preprocess(
    (value) => String(value ?? "REFUND").trim().toUpperCase(),
    z.enum(["REFUND", "EXCHANGE"])
  ),
  reason: z.string().trim().max(240).optional().transform((value) => value || null),
  notes: z.string().trim().max(1000).optional().transform((value) => value || null),
  returnItemsJson: z.string().optional().default("[]"),
  replacementItemsJson: z.string().optional().default("[]"),
});

function formObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export async function createReturn(formData: FormData) {
  const user = await requireUser();
  const {
    saleId,
    type,
    reason,
    notes,
    returnItemsJson,
    replacementItemsJson,
  } = returnFormSchema.parse(formObject(formData));

  const returnItemsRaw = parseJsonArray<ReturnedItemInput>(
    returnItemsJson,
    returnedItemInputSchema,
    "Invalid return item payload"
  );

  const replacementItemsRaw = parseJsonArray<ReplacementItemInput>(
    replacementItemsJson,
    replacementItemInputSchema,
    "Invalid replacement item payload"
  );

  const mergedReturned = new Map<string, number>();
  for (const item of returnItemsRaw) {
    const saleItemId = String(item?.saleItemId ?? "").trim();
    const qty = item.qty;
    if (!saleItemId || qty <= 0) continue;
    mergedReturned.set(saleItemId, (mergedReturned.get(saleItemId) ?? 0) + qty);
  }

  const mergedReplacements = new Map<string, number>();
  for (const item of replacementItemsRaw) {
    const variantId = String(item?.variantId ?? "").trim();
    const qty = item.qty;
    if (!variantId || qty <= 0) continue;
    mergedReplacements.set(variantId, (mergedReplacements.get(variantId) ?? 0) + qty);
  }

  const returnItems = Array.from(mergedReturned.entries()).map(([saleItemId, qty]) => ({
    saleItemId,
    qty,
  }));

  const replacementItems = Array.from(mergedReplacements.entries()).map(([variantId, qty]) => ({
    variantId,
    qty,
  }));

  if (returnItems.length === 0) {
    throw new Error("Ù„Ø§Ø²Ù… ØªØ®ØªØ§Ø± Ù…Ù†ØªØ¬ ÙˆØ§Ø­Ø¯ Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„ Ù„Ù„Ù…Ø±ØªØ¬Ø¹");
  }

  if (type === "EXCHANGE" && replacementItems.length === 0) {
    throw new Error("Ù„Ø§Ø²Ù… ØªØ®ØªØ§Ø± Ù…Ù†ØªØ¬ ÙˆØ§Ø­Ø¯ Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„ ÙÙŠ Ø§Ù„Ø§Ø³ØªØ¨Ø¯Ø§Ù„");
  }

  if (type === "REFUND" && replacementItems.length > 0) {
    throw new Error("Ø§Ù„Ù…Ø±ØªØ¬Ø¹ Ø§Ù„Ù†Ù‚Ø¯ÙŠ Ù„Ø§ ÙŠÙ‚Ø¨Ù„ Ù…Ù†ØªØ¬Ø§Øª Ø§Ø³ØªØ¨Ø¯Ø§Ù„");
  }

  const result = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: {
        id: true,
        total: true,
        discount: true,
        items: {
          select: {
            id: true,
            variantId: true,
            qty: true,
            sellPrice: true,
          },
        },
        returns: {
          select: {
            id: true,
            items: {
              select: {
                saleItemId: true,
                qty: true,
              },
            },
          },
        },
      },
    });

    if (!sale) throw new Error("Ø§Ù„ÙØ§ØªÙˆØ±Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©");

    const saleItemMap = new Map(sale.items.map((item) => [item.id, item]));
    const alreadyReturnedMap = new Map<string, number>();

    for (const existingReturn of sale.returns) {
      for (const item of existingReturn.items) {
        alreadyReturnedMap.set(
          item.saleItemId,
          (alreadyReturnedMap.get(item.saleItemId) ?? 0) + item.qty
        );
      }
    }

    let subtotal = 0;
    for (const item of sale.items) {
      subtotal += item.qty * item.sellPrice;
    }

    let returnedGross = 0;

    const normalizedReturnedRows: Array<{
      saleItemId: string;
      variantId: string;
      qty: number;
      unitPrice: number;
      lineTotal: number;
    }> = [];

    for (const item of returnItems) {
      const saleItem = saleItemMap.get(item.saleItemId);
      if (!saleItem) throw new Error("ÙÙŠÙ‡ Ù…Ù†ØªØ¬ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯ Ø¯Ø§Ø®Ù„ Ø§Ù„ÙØ§ØªÙˆØ±Ø©");

      const alreadyReturned = alreadyReturnedMap.get(saleItem.id) ?? 0;
      const remainingQty = Math.max(0, saleItem.qty - alreadyReturned);

      if (remainingQty <= 0) {
        throw new Error("ÙÙŠÙ‡ Ù…Ù†ØªØ¬ ØªÙ… Ø¥Ø±Ø¬Ø§Ø¹Ù‡ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ Ù‚Ø¨Ù„ ÙƒØ¯Ù‡");
      }

      if (item.qty > remainingQty) {
        throw new Error(`Ø§Ù„ÙƒÙ…ÙŠØ© Ø§Ù„Ù…Ø±ØªØ¬Ø¹Ø© Ø£ÙƒØ¨Ø± Ù…Ù† Ø§Ù„Ù…ØªØ¨Ù‚ÙŠ. Ø§Ù„Ù…ØªØ§Ø­: ${remainingQty}`);
      }

      const lineTotal = item.qty * saleItem.sellPrice;
      returnedGross += lineTotal;

      normalizedReturnedRows.push({
        saleItemId: saleItem.id,
        variantId: saleItem.variantId,
        qty: item.qty,
        unitPrice: saleItem.sellPrice,
        lineTotal,
      });
    }

    const replacementVariantIds = replacementItems.map((item) => item.variantId);

    const replacementVariants = replacementVariantIds.length
      ? await tx.productVariant.findMany({
          where: {
            id: { in: replacementVariantIds },
            isActive: true,
          },
          select: {
            id: true,
            sellPrice: true,
            stockQty: true,
          },
        })
      : [];

    const replacementVariantMap = new Map(replacementVariants.map((v) => [v.id, v]));

    let replacementValue = 0;

    const normalizedReplacementRows: Array<{
      variantId: string;
      qty: number;
      unitPrice: number;
      lineTotal: number;
    }> = [];

    for (const item of replacementItems) {
      const variant = replacementVariantMap.get(item.variantId);
      if (!variant) throw new Error("Ù…Ù†ØªØ¬ Ø§Ù„Ø§Ø³ØªØ¨Ø¯Ø§Ù„ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯ Ø£Ùˆ ØºÙŠØ± Ù†Ø´Ø·");

      if (item.qty > variant.stockQty) {
        throw new Error(`Ù…Ø®Ø²ÙˆÙ† Ù…Ù†ØªØ¬ Ø§Ù„Ø§Ø³ØªØ¨Ø¯Ø§Ù„ ØºÙŠØ± ÙƒØ§ÙÙ. Ø§Ù„Ù…ØªØ§Ø­: ${variant.stockQty}`);
      }

      const lineTotal = item.qty * variant.sellPrice;
      replacementValue += lineTotal;

      normalizedReplacementRows.push({
        variantId: variant.id,
        qty: item.qty,
        unitPrice: variant.sellPrice,
        lineTotal,
      });
    }

    const safeDiscount = Math.max(0, sale.discount ?? 0);
    const returnedDiscountShare =
      subtotal > 0 ? Math.floor((returnedGross * safeDiscount) / subtotal) : 0;

    const returnedValue = Math.max(0, returnedGross - returnedDiscountShare);

    const refundAmount = Math.max(0, returnedValue - replacementValue);
    const extraAmount = Math.max(0, replacementValue - returnedValue);

    const createdReturn = await tx.saleReturn.create({
      data: {
        saleId: sale.id,
        createdById: user.id,
        type,
        reason,
        notes,
        returnedGross,
        returnedDiscountShare,
        returnedValue,
        replacementValue,
        refundAmount,
        extraAmount,
      },
      select: { id: true },
    });

    for (const row of normalizedReturnedRows) {
      await tx.saleReturnItem.create({
        data: {
          returnId: createdReturn.id,
          saleItemId: row.saleItemId,
          variantId: row.variantId,
          qty: row.qty,
          unitPrice: row.unitPrice,
          lineTotal: row.lineTotal,
        },
      });

      await tx.productVariant.update({
        where: { id: row.variantId },
        data: {
          stockQty: { increment: row.qty },
        },
      });
    }

    for (const row of normalizedReplacementRows) {
      const updated = await tx.productVariant.updateMany({
        where: {
          id: row.variantId,
          stockQty: { gte: row.qty },
        },
        data: {
          stockQty: { decrement: row.qty },
        },
      });

      if (updated.count !== 1) {
        throw new Error("Ø§Ù„Ù…Ø®Ø²ÙˆÙ† Ø§ØªØºÙŠØ± Ø£Ø«Ù†Ø§Ø¡ ØªÙ†ÙÙŠØ° Ø§Ù„Ø§Ø³ØªØ¨Ø¯Ø§Ù„ â€” Ø­Ø§ÙˆÙ„ Ù…Ø±Ø© ØªØ§Ù†ÙŠØ©");
      }

      await tx.saleReturnReplacement.create({
        data: {
          returnId: createdReturn.id,
          variantId: row.variantId,
          qty: row.qty,
          unitPrice: row.unitPrice,
          lineTotal: row.lineTotal,
        },
      });
    }

    return {
      returnId: createdReturn.id,
      returnedValue,
      replacementValue,
      refundAmount,
      extraAmount,
      type,
    };
  });

  revalidatePath("/returns");
  revalidatePath("/dashboard");
  revalidatePath("/products");
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${saleId}`);
  revalidatePath("/shift-close");
  revalidatePath("/reports");

  return { ok: true as const, ...result };
}

