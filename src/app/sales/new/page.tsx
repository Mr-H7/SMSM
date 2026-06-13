import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import CommandShell from "@/components/CommandShell";
import SalesNewClient from "./SalesNewClient";

export const dynamic = "force-dynamic";

export default async function SalesNewPage() {
  console.info("[page-auth] sales/new", { guard: "requireUser", called: true });
  const user = await requireUser();
  console.info("[page-auth] sales/new", {
    userExists: Boolean(user),
    userIdExists: Boolean(user?.id),
    userRole: String(user?.role ?? ""),
    userActive: user?.isActive !== false,
    pageReachedAfterAuth: true,
  });

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

  return (
    <CommandShell active="pos" user={user}>
      <SalesNewClient variants={variants as any} />
    </CommandShell>
  );
}
