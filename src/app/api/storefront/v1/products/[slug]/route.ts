import { ZodError } from "zod";
import { findPublicStorefrontProduct, jsonError, StorefrontApiError } from "@/lib/storefront-api";
import { slugParamSchema } from "@/lib/storefront-validation";
import { checkRateLimit, getClientIp, rateLimitResponse, withCors } from "@/lib/security";

export const dynamic = "force-dynamic";
const METHODS = ["GET"];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const rate = checkRateLimit({ scope: "catalog:product", key: getClientIp(request), limit: 300, windowMs: 60_000 });
    if (!rate.ok) return withCors(request, rateLimitResponse(rate), METHODS);
    const { slug } = slugParamSchema.parse(await params);
    const product = await findPublicStorefrontProduct(slug);
    if (!product) {
      return withCors(
        request,
        Response.json(
          { ok: false, error: { code: "NOT_FOUND", message: "Product not found." } },
          { status: 404 }
        ),
        METHODS
      );
    }
    return withCors(
      request,
      Response.json(
        { ok: true, product },
        { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
      ),
      METHODS
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return withCors(request, jsonError(new StorefrontApiError("INVALID_SLUG", "Invalid product slug.", 400)), METHODS);
    }
    return withCors(request, jsonError(error), METHODS);
  }
}
