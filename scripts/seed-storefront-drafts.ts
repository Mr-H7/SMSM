import { PrismaClient, StorefrontBadge } from "@prisma/client";
import catalog from "../prisma/storefront-catalog.json";

const prisma = new PrismaClient();
const APPROVED_COUNT = 30;

type DraftProduct = (typeof catalog.products)[number];

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ar").replace(/\s+/g, " ");
}

async function seedStorefrontDrafts() {
  if (catalog.products.length !== APPROVED_COUNT) {
    throw new Error("Expected " + APPROVED_COUNT + " approved products, found " + catalog.products.length + ".");
  }

  const approvedSkus = new Set(catalog.products.map((product) => product.approvedSku));
  if (approvedSkus.size !== APPROVED_COUNT) {
    throw new Error("Approved storefront SKUs must be unique.");
  }

  const [models, existingListings] = await Promise.all([
    prisma.productModel.findMany({
      include: {
        variants: {
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.storefrontProduct.findMany({ select: { approvedSku: true } }),
  ]);

  const unexpectedListings = existingListings.filter((listing) => !approvedSkus.has(listing.approvedSku));
  if (unexpectedListings.length) {
    throw new Error(
      "Unexpected StorefrontProduct rows found: " + unexpectedListings.map((item) => item.approvedSku).join(", ")
    );
  }

  const modelByName = new Map(models.map((model) => [normalize(model.name), model]));
  const unresolved = catalog.products.filter((product) => !modelByName.has(normalize(product.canonicalModelName)));
  if (unresolved.length) {
    throw new Error(
      "Canonical models must be created and counted before mapping: " +
        unresolved.map((product) => product.approvedSku + " -> " + product.canonicalModelName).join(", ")
    );
  }

  await prisma.$transaction(
    async (tx) => {
      const categoryIds = new Map<string, string>();

      for (const category of catalog.categories) {
        const saved = await tx.storefrontCategory.upsert({
          where: { slug: category.slug },
          create: {
            slug: category.slug,
            nameAr: category.nameAr,
            nameEn: category.nameEn,
            isActive: true,
          },
          update: {
            nameAr: category.nameAr,
            nameEn: category.nameEn,
          },
          select: { id: true },
        });
        categoryIds.set(category.slug, saved.id);
      }

      for (const draft of catalog.products as DraftProduct[]) {
        const model = modelByName.get(normalize(draft.canonicalModelName));
        if (!model) throw new Error("Missing canonical model: " + draft.canonicalModelName);
        if (model.variants.length !== 1) {
          throw new Error(
            "Canonical model " + model.name + " must have exactly one reviewed aggregate variant before storefront mapping."
          );
        }

        const categoryId = categoryIds.get(draft.categorySlug);
        if (!categoryId) throw new Error("Missing category: " + draft.categorySlug);

        const listing = await tx.storefrontProduct.upsert({
          where: { approvedSku: draft.approvedSku },
          create: {
            approvedSku: draft.approvedSku,
            slug: draft.slug,
            productModelId: model.id,
            categoryId,
            nameAr: draft.nameAr,
            nameEn: draft.nameEn,
            shortDescriptionAr: draft.shortDescriptionAr,
            shortDescriptionEn: draft.shortDescriptionEn,
            descriptionAr: draft.descriptionAr,
            descriptionEn: draft.descriptionEn,
            sizes: draft.sizes,
            colors: draft.colors,
            compareAtPrice: draft.compareAtPrice,
            badge: draft.badge as StorefrontBadge | null,
            featured: draft.featured,
            isOffer: draft.isOffer,
            seoTitleAr: draft.seoTitleAr,
            seoTitleEn: draft.seoTitleEn,
            seoDescriptionAr: draft.seoDescriptionAr,
            seoDescriptionEn: draft.seoDescriptionEn,
            publishToWeb: false,
          },
          update: {
            slug: draft.slug,
            productModelId: model.id,
            categoryId,
            nameAr: draft.nameAr,
            nameEn: draft.nameEn,
            shortDescriptionAr: draft.shortDescriptionAr,
            shortDescriptionEn: draft.shortDescriptionEn,
            descriptionAr: draft.descriptionAr,
            descriptionEn: draft.descriptionEn,
            sizes: draft.sizes,
            colors: draft.colors,
            compareAtPrice: draft.compareAtPrice,
            badge: draft.badge as StorefrontBadge | null,
            featured: draft.featured,
            isOffer: draft.isOffer,
            seoTitleAr: draft.seoTitleAr,
            seoTitleEn: draft.seoTitleEn,
            seoDescriptionAr: draft.seoDescriptionAr,
            seoDescriptionEn: draft.seoDescriptionEn,
          },
          select: { id: true, publishToWeb: true },
        });

        const canonicalVariant = model.variants[0];
        const mapping = await tx.storefrontProductVariant.findUnique({
          where: { storefrontProductId: listing.id },
        });

        if (!mapping) {
          await tx.storefrontProductVariant.create({
            data: {
              storefrontProductId: listing.id,
              productVariantId: canonicalVariant.id,
            },
          });
        } else if (mapping.productVariantId !== canonicalVariant.id) {
          if (listing.publishToWeb) {
            throw new Error("Unpublish " + draft.approvedSku + " before changing its canonical mapping.");
          }
          await tx.storefrontProductVariant.update({
            where: { storefrontProductId: listing.id },
            data: { productVariantId: canonicalVariant.id },
          });
        }

        if (!listing.publishToWeb) {
          await tx.storefrontProductImage.deleteMany({
            where: { storefrontProductId: listing.id },
          });
          await tx.storefrontProductImage.createMany({
            data: draft.images.map((image) => ({
              storefrontProductId: listing.id,
              path: image.path,
              angle: image.angle,
              sortOrder: image.sortOrder,
            })),
          });
        }
      }

      const count = await tx.storefrontProduct.count();
      if (count !== APPROVED_COUNT) {
        throw new Error("Storefront allowlist must contain exactly " + APPROVED_COUNT + " rows; found " + count + ".");
      }
    },
    { maxWait: 20_000, timeout: 180_000 }
  );

  console.log("Prepared " + APPROVED_COUNT + " approved StorefrontProduct drafts. No stock or sell prices were copied.");
}

seedStorefrontDrafts()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
