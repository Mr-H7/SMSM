
CREATE TYPE "StorefrontBadge" AS ENUM ('NEW', 'BESTSELLER', 'LIMITED', 'OFFER');
CREATE TYPE "WebOrderStatus" AS ENUM ('NEW', 'CONTACTED', 'CONFIRMED', 'FULFILLED', 'CANCELLED');
CREATE TYPE "ContactMessageStatus" AS ENUM ('UNREAD', 'READ', 'ARCHIVED');

ALTER TABLE "Sale" ADD COLUMN "webOrderId" TEXT;

CREATE TABLE "StorefrontCategory" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "imagePath" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorefrontCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StorefrontProduct" (
  "id" TEXT NOT NULL,
  "approvedSku" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "productModelId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "shortDescriptionAr" TEXT,
  "shortDescriptionEn" TEXT,
  "descriptionAr" TEXT NOT NULL DEFAULT '',
  "descriptionEn" TEXT NOT NULL DEFAULT '',
  "sizes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "colors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "compareAtPrice" INTEGER,
  "badge" "StorefrontBadge",
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "isOffer" BOOLEAN NOT NULL DEFAULT false,
  "seoTitleAr" TEXT,
  "seoTitleEn" TEXT,
  "seoDescriptionAr" TEXT,
  "seoDescriptionEn" TEXT,
  "publishToWeb" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorefrontProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StorefrontProductVariant" (
  "storefrontProductId" TEXT NOT NULL,
  "productVariantId" TEXT NOT NULL,
  CONSTRAINT "StorefrontProductVariant_pkey" PRIMARY KEY ("storefrontProductId")
);

CREATE TABLE "StorefrontProductImage" (
  "id" TEXT NOT NULL,
  "storefrontProductId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "angle" TEXT,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StorefrontProductImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebOrder" (
  "id" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "notes" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'ar',
  "status" "WebOrderStatus" NOT NULL DEFAULT 'NEW',
  "subtotal" INTEGER NOT NULL,
  "total" INTEGER NOT NULL,
  "seenAt" TIMESTAMP(3),
  "contactedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "stockDeductedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "fulfilledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebOrderItem" (
  "id" TEXT NOT NULL,
  "webOrderId" TEXT NOT NULL,
  "storefrontProductId" TEXT NOT NULL,
  "productVariantId" TEXT NOT NULL,
  "productNameAr" TEXT NOT NULL,
  "productNameEn" TEXT NOT NULL,
  "imagePath" TEXT NOT NULL,
  "unitPrice" INTEGER NOT NULL,
  "compareAtPrice" INTEGER,
  "selectedSize" TEXT NOT NULL,
  "selectedColor" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "lineTotal" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebOrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebOrderItem_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "WebOrderItem_unitPrice_check" CHECK ("unitPrice" > 0),
  CONSTRAINT "WebOrderItem_lineTotal_check" CHECK ("lineTotal" >= 0)
);

CREATE TABLE "ContactMessage" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contact" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" "ContactMessageStatus" NOT NULL DEFAULT 'UNREAD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Sale_webOrderId_key" ON "Sale"("webOrderId");
CREATE UNIQUE INDEX "StorefrontCategory_slug_key" ON "StorefrontCategory"("slug");
CREATE UNIQUE INDEX "StorefrontProduct_approvedSku_key" ON "StorefrontProduct"("approvedSku");
CREATE UNIQUE INDEX "StorefrontProduct_slug_key" ON "StorefrontProduct"("slug");
CREATE INDEX "StorefrontProduct_publishToWeb_updatedAt_idx" ON "StorefrontProduct"("publishToWeb", "updatedAt");
CREATE INDEX "StorefrontProduct_categoryId_idx" ON "StorefrontProduct"("categoryId");
CREATE INDEX "StorefrontProduct_productModelId_idx" ON "StorefrontProduct"("productModelId");
CREATE INDEX "StorefrontProductVariant_productVariantId_idx" ON "StorefrontProductVariant"("productVariantId");
CREATE UNIQUE INDEX "StorefrontProductImage_storefrontProductId_sortOrder_key" ON "StorefrontProductImage"("storefrontProductId", "sortOrder");
CREATE INDEX "StorefrontProductImage_storefrontProductId_idx" ON "StorefrontProductImage"("storefrontProductId");
CREATE UNIQUE INDEX "WebOrder_orderNumber_key" ON "WebOrder"("orderNumber");
CREATE UNIQUE INDEX "WebOrder_idempotencyKey_key" ON "WebOrder"("idempotencyKey");
CREATE INDEX "WebOrder_status_createdAt_idx" ON "WebOrder"("status", "createdAt");
CREATE INDEX "WebOrder_seenAt_createdAt_idx" ON "WebOrder"("seenAt", "createdAt");
CREATE INDEX "WebOrderItem_webOrderId_idx" ON "WebOrderItem"("webOrderId");
CREATE INDEX "WebOrderItem_productVariantId_idx" ON "WebOrderItem"("productVariantId");
CREATE INDEX "WebOrderItem_storefrontProductId_idx" ON "WebOrderItem"("storefrontProductId");
CREATE INDEX "ContactMessage_status_createdAt_idx" ON "ContactMessage"("status", "createdAt");

ALTER TABLE "StorefrontProduct" ADD CONSTRAINT "StorefrontProduct_productModelId_fkey"
  FOREIGN KEY ("productModelId") REFERENCES "ProductModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StorefrontProduct" ADD CONSTRAINT "StorefrontProduct_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "StorefrontCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StorefrontProductVariant" ADD CONSTRAINT "StorefrontProductVariant_storefrontProductId_fkey"
  FOREIGN KEY ("storefrontProductId") REFERENCES "StorefrontProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorefrontProductVariant" ADD CONSTRAINT "StorefrontProductVariant_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StorefrontProductImage" ADD CONSTRAINT "StorefrontProductImage_storefrontProductId_fkey"
  FOREIGN KEY ("storefrontProductId") REFERENCES "StorefrontProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebOrderItem" ADD CONSTRAINT "WebOrderItem_webOrderId_fkey"
  FOREIGN KEY ("webOrderId") REFERENCES "WebOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebOrderItem" ADD CONSTRAINT "WebOrderItem_storefrontProductId_fkey"
  FOREIGN KEY ("storefrontProductId") REFERENCES "StorefrontProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebOrderItem" ADD CONSTRAINT "WebOrderItem_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_webOrderId_fkey"
  FOREIGN KEY ("webOrderId") REFERENCES "WebOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION assert_storefront_product_publishable(product_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "StorefrontProduct" sp
    JOIN "StorefrontCategory" c ON c."id" = sp."categoryId"
    JOIN "StorefrontProductVariant" sm ON sm."storefrontProductId" = sp."id"
    JOIN "ProductVariant" pv ON pv."id" = sm."productVariantId"
    WHERE sp."id" = product_id
      AND pv."sellPrice" > 0
  ) THEN
    RAISE EXCEPTION 'Storefront product requires category, canonical variant mapping, and positive canonical price';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "StorefrontProductImage" image
    WHERE image."storefrontProductId" = product_id
  ) THEN
    RAISE EXCEPTION 'Storefront product requires at least one image';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION guard_storefront_product_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."publishToWeb" THEN
    PERFORM assert_storefront_product_publishable(NEW."id");
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER storefront_product_publication_guard
BEFORE INSERT OR UPDATE OF "publishToWeb", "categoryId"
ON "StorefrontProduct"
FOR EACH ROW EXECUTE FUNCTION guard_storefront_product_publication();

CREATE OR REPLACE FUNCTION guard_published_storefront_image_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "StorefrontProduct"
    WHERE "id" = OLD."storefrontProductId" AND "publishToWeb" = true
  ) AND (
    TG_OP = 'DELETE'
    OR NEW."storefrontProductId" IS DISTINCT FROM OLD."storefrontProductId"
  ) AND (
    SELECT COUNT(*) FROM "StorefrontProductImage"
    WHERE "storefrontProductId" = OLD."storefrontProductId"
  ) <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the final image from a published storefront product';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER storefront_image_removal_guard
BEFORE DELETE OR UPDATE OF "storefrontProductId"
ON "StorefrontProductImage"
FOR EACH ROW EXECUTE FUNCTION guard_published_storefront_image_removal();

CREATE OR REPLACE FUNCTION guard_published_storefront_mapping_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "StorefrontProduct"
    WHERE "id" = OLD."storefrontProductId" AND "publishToWeb" = true
  ) THEN
    RAISE EXCEPTION 'Cannot remove or replace the canonical mapping of a published storefront product';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER storefront_mapping_change_guard
BEFORE DELETE OR UPDATE OF "storefrontProductId", "productVariantId"
ON "StorefrontProductVariant"
FOR EACH ROW EXECUTE FUNCTION guard_published_storefront_mapping_change();

CREATE OR REPLACE FUNCTION guard_published_canonical_price()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."sellPrice" <= 0 AND EXISTS (
    SELECT 1
    FROM "StorefrontProductVariant" sm
    JOIN "StorefrontProduct" sp ON sp."id" = sm."storefrontProductId"
    WHERE sm."productVariantId" = NEW."id" AND sp."publishToWeb" = true
  ) THEN
    RAISE EXCEPTION 'Canonical sell price must remain positive while linked storefront products are published';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER storefront_canonical_price_guard
BEFORE UPDATE OF "sellPrice"
ON "ProductVariant"
FOR EACH ROW EXECUTE FUNCTION guard_published_canonical_price();

CREATE OR REPLACE FUNCTION guard_web_order_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."orderNumber" IS DISTINCT FROM NEW."orderNumber"
    OR OLD."idempotencyKey" IS DISTINCT FROM NEW."idempotencyKey"
    OR OLD."customerName" IS DISTINCT FROM NEW."customerName"
    OR OLD."phone" IS DISTINCT FROM NEW."phone"
    OR OLD."address" IS DISTINCT FROM NEW."address"
    OR OLD."notes" IS DISTINCT FROM NEW."notes"
    OR OLD."locale" IS DISTINCT FROM NEW."locale"
    OR OLD."subtotal" IS DISTINCT FROM NEW."subtotal"
    OR OLD."total" IS DISTINCT FROM NEW."total"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
  THEN
    RAISE EXCEPTION 'Historical web order fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER web_order_immutable_fields_guard
BEFORE UPDATE ON "WebOrder"
FOR EACH ROW EXECUTE FUNCTION guard_web_order_immutable_fields();

CREATE OR REPLACE FUNCTION reject_web_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Web orders are immutable historical records';
END;
$$;

CREATE TRIGGER web_order_delete_guard
BEFORE DELETE ON "WebOrder"
FOR EACH ROW EXECUTE FUNCTION reject_web_order_delete();

CREATE OR REPLACE FUNCTION reject_web_order_item_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Web order item snapshots are immutable';
END;
$$;

CREATE TRIGGER web_order_item_mutation_guard
BEFORE UPDATE OR DELETE ON "WebOrderItem"
FOR EACH ROW EXECUTE FUNCTION reject_web_order_item_mutation();
