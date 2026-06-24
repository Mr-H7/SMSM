import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export class StorefrontApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "StorefrontApiError";
  }
}

const publicProductInclude = Prisma.validator<Prisma.StorefrontProductInclude>()({
  category: true,
  images: { orderBy: { sortOrder: "asc" } },
  mapping: {
    include: {
      productVariant: {
        include: { model: true },
      },
    },
  },
});

export type PublicStorefrontProductRow = Prisma.StorefrontProductGetPayload<{
  include: typeof publicProductInclude;
}>;

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireStorefrontApiKey(request: Request) {
  const configured = process.env.STOREFRONT_API_KEY;
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (!configured || !supplied || !safeEqual(configured, supplied)) {
    throw new StorefrontApiError("UNAUTHORIZED", "Unauthorized storefront request.", 401);
  }
}

export function jsonError(error: unknown) {
  const known = error instanceof StorefrontApiError;
  const status = known ? error.status : 500;
  const code = known ? error.code : "INTERNAL_ERROR";
  const message = known ? error.message : "Unable to complete the request.";

  if (!known) {
    console.error("[storefront-api]", error);
  }

  return Response.json({ ok: false, error: { code, message } }, { status });
}

export function serializeStorefrontProduct(row: PublicStorefrontProductRow) {
  const variant = row.mapping?.productVariant;
  if (!variant) {
    throw new StorefrontApiError("INCOMPLETE_PRODUCT", "Published product has no canonical variant.", 500);
  }

  const stock = Math.max(0, variant.stockQty);
  const status = variant.isActive && stock > 0 ? "active" : "out-of-stock";

  return {
    id: row.id,
    sku: row.approvedSku,
    model: variant.model.name,
    brand: variant.model.brand ?? "",
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    slug: row.slug,
    shortDescriptionAr: row.shortDescriptionAr ?? undefined,
    shortDescriptionEn: row.shortDescriptionEn ?? undefined,
    descriptionAr: row.descriptionAr,
    descriptionEn: row.descriptionEn,
    qualityGrade: variant.grade,
    price: variant.sellPrice,
    oldPrice: row.compareAtPrice ?? undefined,
    category: row.category.slug,
    sizes: row.sizes,
    colors: row.colors,
    stock,
    status,
    badge: row.badge ?? undefined,
    featured: row.featured,
    onOffer: row.isOffer,
    images: row.images.map((image) => image.path),
    isActive: variant.isActive,
    bestSeller: row.badge === "BESTSELLER",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const publicWhere: Prisma.StorefrontProductWhereInput = {
  publishToWeb: true,
  category: { isActive: true },
  mapping: {
    is: {
      productVariant: { isActive: true },
    },
  },
};

export async function listPublicStorefrontProducts() {
  const rows = await prisma.storefrontProduct.findMany({
    where: publicWhere,
    include: publicProductInclude,
    orderBy: [{ featured: "desc" }, { updatedAt: "desc" }],
  });

  return rows.map(serializeStorefrontProduct);
}

export async function findPublicStorefrontProduct(slug: string) {
  const row = await prisma.storefrontProduct.findFirst({
    where: { ...publicWhere, slug },
    include: publicProductInclude,
  });

  return row ? serializeStorefrontProduct(row) : null;
}

export async function listPublicStorefrontCategories() {
  const [categories, products] = await Promise.all([
    prisma.storefrontCategory.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.storefrontProduct.groupBy({
      by: ["categoryId"],
      where: publicWhere,
      _count: { _all: true },
    }),
  ]);

  const counts = new Map(products.map((row) => [row.categoryId, row._count._all]));
  return categories
    .map((category) => ({
      id: category.id,
      slug: category.slug,
      nameAr: category.nameAr,
      nameEn: category.nameEn,
      image: category.imagePath ?? "/images/smsm-logo.png",
      productCount: counts.get(category.id) ?? 0,
      isActive: category.isActive,
    }))
    .filter((category) => category.productCount > 0);
}
