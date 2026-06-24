const { Prisma, PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function mustReject(label, operation) {
  try {
    await prisma.$transaction(operation, { maxWait: 10_000, timeout: 30_000 });
    throw new Error(label + " unexpectedly succeeded");
  } catch (error) {
    if (String(error.message).includes("unexpectedly succeeded")) throw error;
    return { label, passed: true };
  }
}

async function main() {
  const [listingCount, publishedCount, imageCount, categoryCount] = await Promise.all([
    prisma.storefrontProduct.count(),
    prisma.storefrontProduct.count({ where: { publishToWeb: true } }),
    prisma.storefrontProductImage.count(),
    prisma.storefrontCategory.count()
  ]);

  const mapped = await prisma.storefrontProduct.findMany({
    where: {
      approvedSku: {
        in: [
          "SMSM-MIR-LVSK-019",
          "SMSM-MIR-LVTR-020",
          "SMSM-MIR-AM95C-005",
          "SMSM-MIR-AM95W-006",
          "SMSM-MIR-AM95S-007"
        ]
      }
    },
    select: { approvedSku: true, mapping: { select: { productVariantId: true } } }
  });

  const listing = await prisma.storefrontProduct.findFirstOrThrow({
    include: { mapping: true, images: true }
  });
  const variant = await prisma.productVariant.findUniqueOrThrow({
    where: { id: listing.mapping.productVariantId }
  });

  const checks = [];

  checks.push(await mustReject("incomplete publication", async (tx) => {
    const draft = await tx.storefrontProduct.create({
      data: {
        approvedSku: "TEMP-GUARD-TEST",
        slug: "temp-guard-test",
        productModelId: listing.productModelId,
        categoryId: listing.categoryId,
        nameAr: "اختبار",
        nameEn: "Test"
      }
    });
    await tx.storefrontProduct.update({ where: { id: draft.id }, data: { publishToWeb: true } });
  }));

  checks.push(await mustReject("final image removal", async (tx) => {
    await tx.storefrontProduct.update({ where: { id: listing.id }, data: { publishToWeb: true } });
    await tx.storefrontProductImage.deleteMany({ where: { storefrontProductId: listing.id } });
  }));

  checks.push(await mustReject("canonical zero price", async (tx) => {
    await tx.storefrontProduct.update({ where: { id: listing.id }, data: { publishToWeb: true } });
    await tx.productVariant.update({ where: { id: variant.id }, data: { sellPrice: 0 } });
  }));

  checks.push(await mustReject("order item mutation", async (tx) => {
    const order = await tx.webOrder.create({
      data: {
        orderNumber: "TEMP-GUARD-ORDER",
        idempotencyKey: "temp-guard-idempotency",
        customerName: "Test",
        phone: "01000000000",
        address: "Test",
        subtotal: variant.sellPrice,
        total: variant.sellPrice
      }
    });
    const item = await tx.webOrderItem.create({
      data: {
        webOrderId: order.id,
        storefrontProductId: listing.id,
        productVariantId: variant.id,
        productNameAr: listing.nameAr,
        productNameEn: listing.nameEn,
        imagePath: listing.images[0].path,
        unitPrice: variant.sellPrice,
        selectedSize: listing.sizes[0],
        selectedColor: listing.colors[0] || "",
        quantity: 1,
        lineTotal: variant.sellPrice
      }
    });
    await tx.webOrderItem.update({ where: { id: item.id }, data: { unitPrice: variant.sellPrice + 1 } });
  }));

  const lv = mapped.filter((item) => item.approvedSku.includes("LV")).map((item) => item.mapping.productVariantId);
  const am95 = mapped.filter((item) => item.approvedSku.includes("AM95")).map((item) => item.mapping.productVariantId);
  const saleIndexes = await prisma.$queryRaw`
    SELECT indexname FROM pg_indexes
    WHERE tablename = ${"Sale"} AND indexdef LIKE ${"%webOrderId%"}
  `;

  const result = {
    counts: { listingCount, publishedCount, imageCount, categoryCount },
    sharedMappings: {
      louisVuitton: lv.length === 2 && new Set(lv).size === 1,
      airMax95: am95.length === 3 && new Set(am95).size === 1
    },
    checks,
    fulfillmentUniqueIndex: saleIndexes.length > 0
  };

  const valid =
    listingCount === 30 &&
    publishedCount === 0 &&
    result.sharedMappings.louisVuitton &&
    result.sharedMappings.airMax95 &&
    result.fulfillmentUniqueIndex;

  console.log(JSON.stringify(result, null, 2));
  if (!valid) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
