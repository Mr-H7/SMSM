import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import SalesNewClient from "./SalesNewClient";

export default async function SalesNewPage() {
  await requireUser();

  const variants = await prisma.productVariant.findMany({
    where: { isActive: true },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      sellPrice: true,
      stockQty: true,
      grade: true,
      sku: true,
      size: true,
      color: true,
      model: {
        select: {
          name: true,
          brand: true,
        },
      },
    },
    take: 5000,
  });

  return <SalesNewClient variants={variants as any} />;
}