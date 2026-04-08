"use server";

import { prisma } from "@/lib/prisma";
import { requireOwnerAction } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

function t(v: FormDataEntryValue | null) {
  return String(v ?? "").trim();
}

function int(v: FormDataEntryValue | null, fallback = 0) {
  const raw = t(v).replace(/[^\d-]/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeGrade(raw: string) {
  const g = raw.trim().toUpperCase();
  if (g === "ORIGINAL" || g === "MIRROR" || g === "EGYPTIAN") return g as any;
  return "EGYPTIAN" as any;
}

export async function createModel(formData: FormData): Promise<void> {
  await requireOwnerAction();

  const name = t(formData.get("name"));
  const brand = t(formData.get("brand")) || null;
  const notes = t(formData.get("notes")) || null;

  if (!name) throw new Error("اسم الموديل مطلوب");

  await prisma.productModel.create({
    data: { name, brand, notes },
  });

  revalidatePath("/products");
}

export async function deleteModel(formData: FormData): Promise<void> {
  await requireOwnerAction();

  const id = t(formData.get("id"));
  if (!id) throw new Error("معرّف الموديل غير موجود");

  const variants = await prisma.productVariant.findMany({
    where: { modelId: id },
    select: { id: true, items: { select: { id: true }, take: 1 } },
  });

  const hasSoldVariant = variants.some((variant) => variant.items.length > 0);

  if (hasSoldVariant) {
    throw new Error("لا يمكن حذف الموديل لأن عليه مبيعات مسجلة");
  }

  await prisma.productVariant.deleteMany({
    where: { modelId: id },
  });

  await prisma.productModel.delete({
    where: { id },
  });

  revalidatePath("/products");
}

export async function createVariant(formData: FormData): Promise<void> {
  await requireOwnerAction();

  const modelName = t(formData.get("modelName"));
  const brand = t(formData.get("brand")) || null;
  const notes = t(formData.get("notes")) || null;

  const grade = normalizeGrade(t(formData.get("grade")));
  const sellPrice = int(formData.get("sellPrice"));
  const costPrice = int(formData.get("costPrice"));
  const stockQty = int(formData.get("stockQty"));

  const size = t(formData.get("size")) || null;
  const color = t(formData.get("color")) || null;
  const sku = t(formData.get("sku")) || null;

  if (!modelName) throw new Error("اسم الموديل مطلوب");
  if (!sellPrice || sellPrice <= 0) throw new Error("سعر البيع مطلوب");
  if (costPrice < 0) throw new Error("سعر التكلفة غير صحيح");
  if (stockQty < 0) throw new Error("المخزون غير صحيح");

  let model = await prisma.productModel.findFirst({
    where: {
      name: modelName,
      ...(brand ? { brand } : {}),
    },
    select: { id: true },
  });

  if (!model) {
    model = await prisma.productModel.create({
      data: {
        name: modelName,
        brand,
        notes,
      },
      select: { id: true },
    });
  }

  await prisma.productVariant.create({
    data: {
      modelId: model.id,
      grade,
      sellPrice,
      costPrice,
      stockQty,
      size,
      color,
      sku,
      isActive: true,
    },
  });

  revalidatePath("/products");
}

export async function updateVariant(formData: FormData): Promise<void> {
  await requireOwnerAction();

  const variantId = t(formData.get("variantId"));
  const modelName = t(formData.get("modelName"));
  const brand = t(formData.get("brand")) || null;
  const grade = normalizeGrade(t(formData.get("grade")));
  const sellPrice = int(formData.get("sellPrice"));
  const costPrice = int(formData.get("costPrice"));
  const size = t(formData.get("size")) || null;
  const color = t(formData.get("color")) || null;
  const sku = t(formData.get("sku")) || null;

  if (!variantId) throw new Error("معرّف النسخة غير موجود");
  if (!modelName) throw new Error("اسم الموديل مطلوب");
  if (!sellPrice || sellPrice <= 0) throw new Error("سعر البيع مطلوب");
  if (costPrice < 0) throw new Error("سعر التكلفة غير صحيح");

  const existing = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { model: true },
  });

  if (!existing) throw new Error("المنتج غير موجود");

  await prisma.$transaction(async (tx) => {
    await tx.productModel.update({
      where: { id: existing.modelId },
      data: {
        name: modelName,
        brand,
      },
    });

    await tx.productVariant.update({
      where: { id: variantId },
      data: {
        grade,
        sellPrice,
        costPrice,
        size,
        color,
        sku,
      },
    });
  });

  revalidatePath("/products");
}

export async function deleteVariant(formData: FormData): Promise<void> {
  await requireOwnerAction();

  const id = t(formData.get("id"));
  if (!id) throw new Error("معرّف النسخة غير موجود");

  await prisma.productVariant.update({
    where: { id },
    data: {
      isActive: false,
      stockQty: 0,
    },
  });

  revalidatePath("/products");
}

export async function toggleVariantActive(formData: FormData): Promise<void> {
  await requireOwnerAction();

  const id = t(formData.get("id"));
  const next = t(formData.get("next"));

  if (!id) throw new Error("معرّف النسخة غير موجود");

  await prisma.productVariant.update({
    where: { id },
    data: { isActive: next === "1" },
  });

  revalidatePath("/products");
}

export async function restockVariant(formData: FormData): Promise<void> {
  await requireOwnerAction();

  const id = t(formData.get("id"));
  const qty = int(formData.get("qty"));

  if (!id) throw new Error("معرّف المنتج غير موجود");
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("كمية إعادة التخزين يجب أن تكون أكبر من صفر");
  }

  const variant = await prisma.productVariant.findUnique({
    where: { id },
    select: {
      id: true,
      stockQty: true,
    },
  });

  if (!variant) throw new Error("المنتج غير موجود");

  await prisma.productVariant.update({
    where: { id },
    data: {
      stockQty: variant.stockQty + qty,
    },
  });

  revalidatePath("/products");
}