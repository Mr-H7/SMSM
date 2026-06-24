import { prisma } from "@/lib/prisma";
import { requireRouteUser } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRouteUser(["OWNER", "SELLER"]);
  if (!auth.ok) return auth.response;

  const count = await prisma.webOrder.count({ where: { seenAt: null } });
  return Response.json(
    { ok: true, count },
    { headers: { "Cache-Control": "no-store" } }
  );
}
