"use server";

import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ReturnType } from "@prisma/client";

function normalizeText(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

function parseQty(n: unknown): number {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

type ReturnedItemInput = {
  saleItemId: string;
  qty: number;
};

type ReplacementItemInput = {
  variantId: string;
  qty: number;
};

async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

function parseJsonArray<T>(raw: string, errorMessage: string): T[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error();
    return parsed as T[];
  } catch {
    throw new Error(errorMessage);
  }
}

export async function createReturn(formData: FormData) {
  const user = await requireUser();

  const saleId = normalizeText(formData.get("saleId"));
  const typeRaw = normalizeText(formData.get("type")).toUpperCase();
  const reason = normalizeText(formData.get("reason")) || null;
  const notes = normalizeText(formData.get("notes")) || null;

  if (!saleId) throw new Error("رقم الفاتورة مطلوب");

  const type: ReturnType = typeRaw === "EXCHANGE" ? "EXCHANGE" : "REFUND";

  const returnItemsRaw = parseJsonArray<ReturnedItemInput>(
    normalizeText(formData.get("returnItemsJson")),
    "بيانات المرتجع غير صالحة"
  );

  const replacementItemsRaw = parseJsonArray<ReplacementItemInput>(
    normalizeText(formData.get("replacementItemsJson")),
    "بيانات الاستبدال غير صالحة"
  );

  const mergedReturned = new Map<string, number>();
  for (const item of returnItemsRaw) {
    const saleItemId = String(item?.saleItemId ?? "").trim();
    const qty = parseQty(item?.qty);
    if (!saleItemId || qty <= 0) continue;
    mergedReturned.set(saleItemId, (mergedReturned.get(saleItemId) ?? 0) + qty);
  }

  const mergedReplacements = new Map<string, number>();
  for (const item of replacementItemsRaw) {
    const variantId = String(item?.variantId ?? "").trim();
    const qty = parseQty(item?.qty);
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
    throw new Error("لازم تختار منتج واحد على الأقل للمرتجع");
  }

  if (type === "EXCHANGE" && replacementItems.length === 0) {
    throw new Error("لازم تختار منتج واحد على الأقل في الاستبدال");
  }

  if (type === "REFUND" && replacementItems.length > 0) {
    throw new Error("المرتجع النقدي لا يقبل منتجات استبدال");
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

    if (!sale) throw new Error("الفاتورة غير موجودة");

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
      if (!saleItem) throw new Error("فيه منتج غير موجود داخل الفاتورة");

      const alreadyReturned = alreadyReturnedMap.get(saleItem.id) ?? 0;
      const remainingQty = Math.max(0, saleItem.qty - alreadyReturned);

      if (remainingQty <= 0) {
        throw new Error("فيه منتج تم إرجاعه بالكامل قبل كده");
      }

      if (item.qty > remainingQty) {
        throw new Error(`الكمية المرتجعة أكبر من المتبقي. المتاح: ${remainingQty}`);
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
      if (!variant) throw new Error("منتج الاستبدال غير موجود أو غير نشط");

      if (item.qty > variant.stockQty) {
        throw new Error(`مخزون منتج الاستبدال غير كافٍ. المتاح: ${variant.stockQty}`);
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
        throw new Error("المخزون اتغير أثناء تنفيذ الاستبدال — حاول مرة تانية");
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