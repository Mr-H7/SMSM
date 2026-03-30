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
  if (!itemsJson) throw new Error("Cart is empty");

  let items: CartItemInput[];
  try {
    items = JSON.parse(itemsJson);
  } catch {
    throw new Error("Invalid cart payload");
  }

  if (!Array.isArray(items) || items.length === 0) throw new Error("Cart is empty");

  // sanitize + merge duplicates
  const merged = new Map<string, number>();
  for (const it of items) {
    const variantId = String(it?.variantId ?? "").trim();
    const qty = Number(it?.qty ?? 0);
    if (!variantId) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    merged.set(variantId, (merged.get(variantId) ?? 0) + Math.trunc(qty));
  }

  const finalItems = Array.from(merged.entries()).map(([variantId, qty]) => ({ variantId, qty }));
  if (finalItems.length === 0) throw new Error("Cart is empty");

  const result = await prisma.$transaction(async (tx) => {
    // fetch all variants snapshot (server-side only)
    const variants = await tx.productVariant.findMany({
      where: { id: { in: finalItems.map((i) => i.variantId) } },
      select: {
        id: true,
        sellPrice: true,
        costPrice: true,
        stockQty: true,
        isActive: true,
      },
    });

    const variantMap = new Map(variants.map((v) => [v.id, v]));

    // Validate existence + active + stock
    for (const it of finalItems) {
      const v = variantMap.get(it.variantId);
      if (!v) throw new Error("Variant not found");
      if (!v.isActive) throw new Error("Variant is inactive");
      const currentStock = v.stockQty ?? 0;
      if (it.qty > currentStock) {
        throw new Error(`Insufficient stock. Available: ${currentStock}`);
      }
    }

    // compute subtotal
    let subtotal = 0;
    for (const it of finalItems) {
      const v = variantMap.get(it.variantId)!;
      subtotal += it.qty * v.sellPrice;
    }

    const safeDiscount = Math.max(0, discount);
    const total = Math.max(0, subtotal - safeDiscount);

    // create sale
    const sale = await tx.sale.create({
      data: {
        sellerId: user.id,
        customer,
        total,
        discount: safeDiscount,
      },
      select: { id: true },
    });

    // deduct stock ATOMIC + create sale items
    for (const it of finalItems) {
      const v = variantMap.get(it.variantId)!;

      // HARD LOCK: prevents negative stock in concurrency
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
          costPrice: v.costPrice, // snapshot server-side only
        },
      });
    }

    return { saleId: sale.id, total };
  });

  revalidatePath("/sales/new");
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  // reports owner-only anyway, revalidate harmless but optional
  revalidatePath("/reports");

  return { ok: true as const, saleId: result.saleId, total: result.total };
}