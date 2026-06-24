"use server";

import { StorefrontBadge } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwnerAction } from "@/lib/rbac";
import { notifyStorefrontRevalidation } from "@/lib/storefront-revalidation";
import { logSecurityEvent } from "@/lib/security";

function value(formData: FormData, key: string, max = 2000) {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function list(formData: FormData, key: string, maxItems = 20) {
  return value(formData, key)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

export async function saveStorefrontProductAction(formData: FormData) {
  const user = await requireOwnerAction();

  const id = value(formData, "id", 64);
  const categoryId = value(formData, "categoryId", 64);
  const productVariantId = value(formData, "productVariantId", 64);
  const slug = value(formData, "slug", 160).toLowerCase();
  const nameAr = value(formData, "nameAr", 160);
  const nameEn = value(formData, "nameEn", 160);
  const images = list(formData, "images", 8);
  const publishToWeb = formData.get("publishToWeb") === "on";
  const compareRaw = value(formData, "compareAtPrice", 20);
  const compareAtPrice = compareRaw ? Math.trunc(Number(compareRaw)) : null;
  const badgeRaw = value(formData, "badge", 20).toUpperCase();
  const badge = badgeRaw ? (badgeRaw as StorefrontBadge) : null;

  if (!id || !categoryId || !productVariantId || !slug || !nameAr || !nameEn) {
    throw new Error("بيانات الربط الأساسية مطلوبة.");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("الرابط المختصر غير صحيح.");
  }
  if (compareAtPrice !== null && (!Number.isFinite(compareAtPrice) || compareAtPrice < 0)) {
    throw new Error("سعر المقارنة غير صحيح.");
  }
  if (badge && !["NEW", "BESTSELLER", "LIMITED", "OFFER"].includes(badge)) {
    throw new Error("شارة المنتج غير صحيحة.");
  }
  if (!images.length || images.some((path) => !path.startsWith("/images/SHOES/"))) {
    throw new Error("يجب إضافة مسار صورة محلي واحد على الأقل من /images/SHOES/.");
  }

  const [existing, variant, category] = await Promise.all([
    prisma.storefrontProduct.findUnique({
      where: { id },
      include: { mapping: true, images: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.productVariant.findUnique({
      where: { id: productVariantId },
      include: { model: true },
    }),
    prisma.storefrontCategory.findUnique({ where: { id: categoryId } }),
  ]);
  if (!existing) throw new Error("منتج المتجر غير موجود.");
  if (!variant || variant.sellPrice <= 0) throw new Error("النسخة الأساسية أو سعرها غير صالح.");
  if (!category) throw new Error("التصنيف غير موجود.");

  const imagePathsChanged =
    existing.images.map((image) => image.path).join("\n") !== images.join("\n");
  const mappingChanged = existing.mapping?.productVariantId !== variant.id;
  if (existing.publishToWeb && (imagePathsChanged || mappingChanged)) {
    throw new Error("أوقف النشر قبل تغيير الصور أو ربط المخزون.");
  }

  await prisma.$transaction(async (tx) => {
    if (!existing.mapping) {
      await tx.storefrontProductVariant.create({
        data: { storefrontProductId: existing.id, productVariantId: variant.id },
      });
    } else if (mappingChanged) {
      await tx.storefrontProductVariant.update({
        where: { storefrontProductId: existing.id },
        data: { productVariantId: variant.id },
      });
    }

    if (imagePathsChanged) {
      await tx.storefrontProductImage.deleteMany({ where: { storefrontProductId: existing.id } });
      await tx.storefrontProductImage.createMany({
        data: images.map((path, sortOrder) => ({
          storefrontProductId: existing.id,
          path,
          angle: path.split("/").pop()?.replace(/\.png$/i, "") ?? null,
          sortOrder,
        })),
      });
    }

    await tx.storefrontProduct.update({
      where: { id: existing.id },
      data: {
        productModelId: variant.modelId,
        categoryId,
        slug,
        nameAr,
        nameEn,
        shortDescriptionAr: value(formData, "shortDescriptionAr", 500) || null,
        shortDescriptionEn: value(formData, "shortDescriptionEn", 500) || null,
        descriptionAr: value(formData, "descriptionAr", 4000),
        descriptionEn: value(formData, "descriptionEn", 4000),
        sizes: list(formData, "sizes"),
        colors: list(formData, "colors"),
        compareAtPrice,
        badge,
        featured: formData.get("featured") === "on",
        isOffer: formData.get("isOffer") === "on",
        seoTitleAr: value(formData, "seoTitleAr", 200) || null,
        seoTitleEn: value(formData, "seoTitleEn", 200) || null,
        seoDescriptionAr: value(formData, "seoDescriptionAr", 500) || null,
        seoDescriptionEn: value(formData, "seoDescriptionEn", 500) || null,
        publishToWeb,
      },
    });
  });

  logSecurityEvent("admin_action", { action: "storefront_product_saved", userId: user.id, storefrontProductId: id, publishToWeb });
  await notifyStorefrontRevalidation();
  revalidatePath("/storefront-products");
  revalidatePath("/storefront-products/" + id);
}