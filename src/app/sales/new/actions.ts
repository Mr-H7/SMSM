"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const cartItemInputSchema = z.object({
  variantId: z.string().trim().min(1).max(128),
  qty: z.coerce.number().int().positive().max(999),
});

type CartItemInput = z.infer<typeof cartItemInputSchema>;

const saleFormSchema = z
  .object({
    customer: z.string().trim().max(120).optional().transform((value) => value || null),
    discount: z.preprocess(
      (value) => String(value ?? "").replace(/[^\d.-]/g, ""),
      z.coerce.number().int().min(0).max(10_000_000)
    ),
    paymentMethod: z.preprocess(
      (value) => String(value ?? "CASH").trim().toUpperCase(),
      z.enum(["CASH", "TRANSFER"])
    ),
    paymentDescription: z.string().trim().max(240).optional().transform((value) => value || null),
    itemsJson: z.string().min(1).transform((value, ctx) => {
      try {
        return z.array(cartItemInputSchema).min(1).max(200).parse(JSON.parse(value));
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid cart payload" });
        return z.NEVER;
      }
    }),
  })
  .superRefine((value, ctx) => {
    if (value.paymentMethod === "TRANSFER" && !value.paymentDescription) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentDescription"],
        message: "Transfer details are required",
      });
    }
  });

function formObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export async function createSale(formData: FormData) {
  const user = await requireUser();
  const {
    customer,
    discount,
    paymentMethod,
    paymentDescription,
    itemsJson: cleaned,
  } = saleFormSchema.parse(formObject(formData));

  const mergedMap = new Map<string, CartItemInput>();

  for (const item of cleaned) {
    const current = mergedMap.get(item.variantId);
    if (current) {
      current.qty += item.qty;
    } else {
      mergedMap.set(item.variantId, { ...item });
    }
  }

  const finalItems = Array.from(mergedMap.values());

  const result = await prisma.$transaction(
    async (tx) => {
      const variants = await tx.productVariant.findMany({
        where: {
          id: { in: finalItems.map((i) => i.variantId) },
        },
        select: {
          id: true,
          sellPrice: true,
          costPrice: true,
          stockQty: true,
          isActive: true,
        },
      });

      const variantMap = new Map(variants.map((v) => [v.id, v]));

      for (const it of finalItems) {
        const v = variantMap.get(it.variantId);
        if (!v) throw new Error("القطعة غير موجودة");
        if (!v.isActive) throw new Error("القطعة غير نشطة");

        const currentStock = v.stockQty ?? 0;
        if (it.qty > currentStock) {
          throw new Error(`المخزون غير كافٍ. المتاح: ${currentStock}`);
        }
      }

      let subtotal = 0;
      for (const it of finalItems) {
        const v = variantMap.get(it.variantId)!;
        subtotal += it.qty * v.sellPrice;
      }

      const safeDiscount = Math.max(0, discount);
      const total = Math.max(0, subtotal - safeDiscount);

      const sale = await tx.sale.create({
        data: {
          sellerId: user.id,
          customer,
          total,
          discount: safeDiscount,
          paymentMethod: paymentMethod as "CASH" | "TRANSFER",
          paymentDescription:
            paymentMethod === "TRANSFER" ? paymentDescription : null,
        },
        select: { id: true },
      });

      for (const it of finalItems) {
        const v = variantMap.get(it.variantId)!;

        const updated = await tx.productVariant.updateMany({
          where: {
            id: v.id,
            stockQty: { gte: it.qty },
          },
          data: {
            stockQty: { decrement: it.qty },
          },
        });

        if (updated.count !== 1) {
          throw new Error("المخزون اتغير أثناء تنفيذ البيع — حاول تاني");
        }

        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            variantId: v.id,
            qty: it.qty,
            sellPrice: v.sellPrice,
            costPrice: v.costPrice,
          },
        });
      }

      return { saleId: sale.id, total };
    },
    {
      maxWait: 10000,
      timeout: 20000,
    }
  );

  revalidatePath("/sales/new");
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/reports/profit");

  return { ok: true as const, saleId: result.saleId, total: result.total };
}
