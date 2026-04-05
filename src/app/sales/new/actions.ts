"use server";

import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

function normalizeText(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

function parseIntSafe(v: FormDataEntryValue | null, fallback = 0): number {
  const raw = normalizeText(v).replace(/[^\d.-]/g, "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

type CartItemInput = {
  variantId: string;
  qty: number;
};

async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function createSale(formData: FormData) {
  const user = await requireUser();

  const customer = normalizeText(formData.get("customer")) || null;
  const discount = parseIntSafe(formData.get("discount"), 0);

  const itemsJson = normalizeText(formData.get("itemsJson"));
  if (!itemsJson) throw new Error("السلة فاضية");

  let items: CartItemInput[];
  try {
    items = JSON.parse(itemsJson);
  } catch {
    throw new Error("بيانات السلة غير صالحة");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("السلة فاضية");
  }

  const cleaned = items
    .map((it) => ({
      variantId: String(it?.variantId ?? "").trim(),
      qty: Math.max(0, Math.trunc(Number(it?.qty ?? 0))),
    }))
    .filter((it) => it.variantId && it.qty > 0);

  if (cleaned.length === 0) {
    throw new Error("السلة فاضية");
  }

  const mergedMap = new Map<string, CartItemInput>();

  for (const item of cleaned) {
    const key = item.variantId;
    const current = mergedMap.get(key);
    if (current) {
      current.qty += item.qty;
    } else {
      mergedMap.set(key, { ...item });
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