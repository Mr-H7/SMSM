import crypto from "node:crypto";
import { PaymentMethod, Prisma, WebOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { StorefrontApiError } from "@/lib/storefront-api";

export type WebCheckoutInput = {
  customer: {
    name: string;
    phone: string;
    address: string;
    notes?: string;
  };
  locale?: "ar" | "en";
  items: Array<{
    storefrontProductId: string;
    selectedSize: string;
    selectedColor: string;
    quantity: number;
  }>;
};

function text(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function positiveQuantity(value: unknown) {
  const quantity = Math.trunc(Number(value));
  return Number.isFinite(quantity) && quantity > 0 && quantity <= 99 ? quantity : null;
}

function newOrderNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return "WEB-" + date + "-" + crypto.randomUUID().slice(0, 8).toUpperCase();
}

export async function createWebOrder(input: WebCheckoutInput, idempotencyKey: string) {
  const key = text(idempotencyKey, 128);
  if (key.length < 8) {
    throw new StorefrontApiError("INVALID_IDEMPOTENCY_KEY", "A valid idempotency key is required.");
  }

  const existing = await prisma.webOrder.findUnique({
    where: { idempotencyKey: key },
    include: { items: true },
  });
  if (existing) return existing;

  const customerName = text(input?.customer?.name, 120);
  const phone = text(input?.customer?.phone, 40);
  const address = text(input?.customer?.address, 300);
  const notes = text(input?.customer?.notes, 500) || null;
  const locale = input?.locale === "en" ? "en" : "ar";

  if (!customerName || !phone || !address) {
    throw new StorefrontApiError("INVALID_CUSTOMER", "Name, phone, and address are required.");
  }
  if (!Array.isArray(input?.items) || input.items.length === 0 || input.items.length > 50) {
    throw new StorefrontApiError("INVALID_CART", "Cart must contain between 1 and 50 items.");
  }

  const merged = new Map<
    string,
    {
      storefrontProductId: string;
      selectedSize: string;
      selectedColor: string;
      quantity: number;
    }
  >();

  for (const rawItem of input.items) {
    const storefrontProductId = text(rawItem?.storefrontProductId, 64);
    const selectedSize = text(rawItem?.selectedSize, 20);
    const selectedColor = text(rawItem?.selectedColor, 40);
    const quantity = positiveQuantity(rawItem?.quantity);

    if (!storefrontProductId || !selectedSize || !quantity) {
      throw new StorefrontApiError("INVALID_CART_ITEM", "Each cart item requires a product, size, and quantity.");
    }

    const mergeKey = [storefrontProductId, selectedSize, selectedColor].join("|");
    const current = merged.get(mergeKey);
    if (current) {
      current.quantity += quantity;
      if (current.quantity > 99) {
        throw new StorefrontApiError("INVALID_QUANTITY", "Item quantity is too large.");
      }
    } else {
      merged.set(mergeKey, { storefrontProductId, selectedSize, selectedColor, quantity });
    }
  }

  const normalizedItems = Array.from(merged.values());
  const productIds = Array.from(new Set(normalizedItems.map((item) => item.storefrontProductId)));
  const products = await prisma.storefrontProduct.findMany({
    where: {
      id: { in: productIds },
      publishToWeb: true,
      category: { isActive: true },
    },
    include: {
      images: { orderBy: { sortOrder: "asc" }, take: 1 },
      mapping: { include: { productVariant: true } },
    },
  });

  if (products.length !== productIds.length) {
    throw new StorefrontApiError("PRODUCT_UNAVAILABLE", "One or more products are not available.");
  }

  const productMap = new Map(products.map((product) => [product.id, product]));
  const requestedByVariant = new Map<string, number>();
  let subtotal = 0;

  const snapshots = normalizedItems.map((item) => {
    const product = productMap.get(item.storefrontProductId);
    const variant = product?.mapping?.productVariant;
    if (!product || !variant || !variant.isActive) {
      throw new StorefrontApiError("PRODUCT_UNAVAILABLE", "One or more products are not available.");
    }
    if (product.sizes.length && !product.sizes.includes(item.selectedSize)) {
      throw new StorefrontApiError("INVALID_SIZE", "The selected size is not available for this product.");
    }
    if (product.colors.length && !product.colors.includes(item.selectedColor)) {
      throw new StorefrontApiError("INVALID_COLOR", "The selected color is not available for this product.");
    }
    if (variant.sellPrice <= 0) {
      throw new StorefrontApiError("INVALID_PRICE", "The canonical product price is invalid.", 409);
    }

    requestedByVariant.set(
      variant.id,
      (requestedByVariant.get(variant.id) ?? 0) + item.quantity
    );

    const lineTotal = variant.sellPrice * item.quantity;
    subtotal += lineTotal;

    return {
      storefrontProductId: product.id,
      productVariantId: variant.id,
      productNameAr: product.nameAr,
      productNameEn: product.nameEn,
      imagePath: product.images[0]?.path ?? "/images/smsm-logo.png",
      unitPrice: variant.sellPrice,
      compareAtPrice: product.compareAtPrice,
      selectedSize: item.selectedSize,
      selectedColor: item.selectedColor,
      quantity: item.quantity,
      lineTotal,
    };
  });

  for (const product of products) {
    const variant = product.mapping?.productVariant;
    if (!variant) continue;
    const requested = requestedByVariant.get(variant.id) ?? 0;
    if (requested > variant.stockQty) {
      throw new StorefrontApiError("INSUFFICIENT_STOCK", "Insufficient stock for one or more products.", 409);
    }
  }

  try {
    return await prisma.webOrder.create({
      data: {
        orderNumber: newOrderNumber(),
        idempotencyKey: key,
        customerName,
        phone,
        address,
        notes,
        locale,
        subtotal,
        total: subtotal,
        items: { create: snapshots },
      },
      include: { items: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.webOrder.findUnique({
        where: { idempotencyKey: key },
        include: { items: true },
      });
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

function aggregateOrderItems(items: Array<{ productVariantId: string; quantity: number }>) {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.productVariantId, (totals.get(item.productVariantId) ?? 0) + item.quantity);
  }
  return totals;
}

export async function markWebOrderSeen(orderId: string) {
  return prisma.webOrder.updateMany({
    where: { id: orderId, seenAt: null },
    data: { seenAt: new Date() },
  });
}

export async function markWebOrderContacted(orderId: string) {
  const result = await prisma.webOrder.updateMany({
    where: { id: orderId, status: "NEW" },
    data: { status: "CONTACTED", contactedAt: new Date(), seenAt: new Date() },
  });
  if (result.count === 0) {
    const order = await prisma.webOrder.findUnique({ where: { id: orderId } });
    if (!order || !["CONTACTED", "CONFIRMED", "FULFILLED"].includes(order.status)) {
      throw new Error("Order cannot be marked as contacted.");
    }
  }
}

export async function confirmWebOrder(orderId: string) {
  return prisma.$transaction(
    async (tx) => {
      const order = await tx.webOrder.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) throw new Error("Web order not found.");
      if (order.status === "CONFIRMED" || order.status === "FULFILLED") {
        return { order, priceChanged: false };
      }
      if (!["NEW", "CONTACTED"].includes(order.status)) {
        throw new Error("Only new or contacted orders can be confirmed.");
      }

      const totals = aggregateOrderItems(order.items);
      const variants = await tx.productVariant.findMany({
        where: { id: { in: Array.from(totals.keys()) } },
        select: { id: true, stockQty: true, sellPrice: true, isActive: true },
      });
      const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
      const priceChanged = order.items.some(
        (item) => variantMap.get(item.productVariantId)?.sellPrice !== item.unitPrice
      );

      for (const [variantId, quantity] of totals) {
        const variant = variantMap.get(variantId);
        if (!variant || !variant.isActive || variant.stockQty < quantity) {
          throw new Error("Insufficient canonical stock to confirm this order.");
        }

        const updated = await tx.productVariant.updateMany({
          where: { id: variantId, isActive: true, stockQty: { gte: quantity } },
          data: { stockQty: { decrement: quantity } },
        });
        if (updated.count !== 1) {
          throw new Error("Canonical stock changed during confirmation. Try again.");
        }
      }

      const moved = await tx.webOrder.updateMany({
        where: { id: order.id, status: { in: ["NEW", "CONTACTED"] } },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          stockDeductedAt: new Date(),
          seenAt: new Date(),
        },
      });
      if (moved.count !== 1) {
        throw new Error("Order status changed during confirmation.");
      }

      const confirmed = await tx.webOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: true },
      });
      return { order: confirmed, priceChanged };
    },
    { maxWait: 10_000, timeout: 20_000 }
  );
}

export async function cancelWebOrder(orderId: string) {
  return prisma.$transaction(
    async (tx) => {
      const order = await tx.webOrder.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) throw new Error("Web order not found.");
      if (order.status === "CANCELLED") return order;
      if (order.status === "FULFILLED") {
        throw new Error("Fulfilled orders must use the returns workflow.");
      }

      const previousStatus = order.status;
      const cancelled = await tx.webOrder.updateMany({
        where: { id: order.id, status: previousStatus },
        data: { status: "CANCELLED", cancelledAt: new Date(), seenAt: new Date() },
      });
      if (cancelled.count !== 1) throw new Error("Order status changed during cancellation.");

      if (previousStatus === "CONFIRMED" && order.stockDeductedAt) {
        const totals = aggregateOrderItems(order.items);
        for (const [variantId, quantity] of totals) {
          await tx.productVariant.update({
            where: { id: variantId },
            data: { stockQty: { increment: quantity } },
          });
        }
      }

      return tx.webOrder.findUniqueOrThrow({ where: { id: order.id } });
    },
    { maxWait: 10_000, timeout: 20_000 }
  );
}

export async function fulfillWebOrder(
  orderId: string,
  sellerId: string,
  paymentMethod: PaymentMethod,
  paymentDescription?: string | null
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const existingSale = await tx.sale.findUnique({ where: { webOrderId: orderId } });
        if (existingSale) return existingSale;

        const order = await tx.webOrder.findUnique({
          where: { id: orderId },
          include: { items: true },
        });
        if (!order) throw new Error("Web order not found.");
        if (order.status !== "CONFIRMED") {
          throw new Error("Only confirmed orders can be fulfilled.");
        }

        const variants = await tx.productVariant.findMany({
          where: { id: { in: Array.from(new Set(order.items.map((item) => item.productVariantId))) } },
          select: { id: true, costPrice: true, sellPrice: true },
        });
        const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
        if (variantMap.size !== new Set(order.items.map((item) => item.productVariantId)).size) {
          throw new Error("A canonical product no longer exists.");
        }

        const moved = await tx.webOrder.updateMany({
          where: { id: order.id, status: "CONFIRMED" },
          data: { status: "FULFILLED", fulfilledAt: new Date(), seenAt: new Date() },
        });
        if (moved.count !== 1) {
          const duplicate = await tx.sale.findUnique({ where: { webOrderId: order.id } });
          if (duplicate) return duplicate;
          throw new Error("Order status changed during fulfillment.");
        }

        return tx.sale.create({
          data: {
            webOrderId: order.id,
            sellerId,
            customer: order.customerName,
            total: order.total,
            discount: 0,
            paymentMethod,
            paymentDescription: paymentMethod === "TRANSFER" ? text(paymentDescription, 200) || null : null,
            items: {
              create: order.items.map((item) => {
                const variant = variantMap.get(item.productVariantId);
                if (!variant) throw new Error("Missing canonical variant.");
                return {
                  variantId: item.productVariantId,
                  qty: item.quantity,
                  sellPrice: item.unitPrice,
                  costPrice: variant.costPrice,
                };
              }),
            },
          },
        });
      },
      { maxWait: 10_000, timeout: 20_000 }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.sale.findUnique({ where: { webOrderId: orderId } });
      if (existing) return existing;
    }
    throw error;
  }
}

export function isWebOrderStatus(value: string): value is WebOrderStatus {
  return ["NEW", "CONTACTED", "CONFIRMED", "FULFILLED", "CANCELLED"].includes(value);
}
