import { jsonError, listPublicStorefrontCategories } from "@/lib/storefront-api";
import { checkRateLimit, getClientIp, rateLimitResponse, withCors } from "@/lib/security";

export const dynamic = "force-dynamic";
const METHODS = ["GET"];

export async function GET(request: Request) {
  try {
    const rate = checkRateLimit({ scope: "catalog:categories", key: getClientIp(request), limit: 240, windowMs: 60_000 });
    if (!rate.ok) return withCors(request, rateLimitResponse(rate), METHODS);
    const categories = await listPublicStorefrontCategories();
    return withCors(
      request,
      Response.json(
        { ok: true, categories },
        { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
      ),
      METHODS
    );
  } catch (error) {
    return withCors(request, jsonError(error), METHODS);
  }
}
