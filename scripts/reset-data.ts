import { prisma } from "../src/lib/prisma";

async function main() {
  await prisma.saleReturnReplacement.deleteMany();
  await prisma.saleReturnItem.deleteMany();
  await prisma.saleReturn.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.productModel.deleteMany();

  console.log("Operational data reset completed.");
}

main()
  .catch((e) => {
    console.error("Reset failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });