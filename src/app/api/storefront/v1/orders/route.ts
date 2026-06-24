import { ZodError } from "zod";
import { createWebOrder } from "@/lib/web-orders";
import { jsonError, requireStorefrontApiKey, StorefrontApiError } from "@/lib/storefront-api";
import { checkoutBodySchema, idempotencyKeySchema } from "@/lib/storefront-validation";
import { checkRateLimit, corsPreflight, getClientIp, rateLimitResponse, readJsonWithLimit, withCors } from "@/lib/security";

export const dynamic = "force-dynamic";
const METHODS = ["POST", "OPTIONS"];

export async function OPTIONS(request: Request) {
  return corsPreflight(request, METHODS);
}

export async function POST(request: Request) {
  try {
    requireStorefrontApiKey(request);
    const ip = getClientIp(request);
    const ipRate = checkRateLimit({ scope: "orders:ip", key: ip, limit: 20, windowMs: 15 * 60_000 });
    if (!ipRate.ok) return withCors(request, rateLimitResponse(ipRate), METHODS);

    const idempotencyKey = idempotencyKeySchema.parse(request.headers.get("idempotency-key") ?? "");
    const parsed = checkoutBodySchema.parse(await readJsonWithLimit(request, 64 * 1024));
    const input = {
      ...parsed,
      customer: {
        name: parsed.customer.name,
        phone: parsed.customer.phone,
        address: parsed.customer.address,
        notes: parsed.customer.notes,
      },
      items: parsed.items.map((item) => ({
        storefrontProductId: item.storefrontProductId,
        selectedSize: item.selectedSize,
        selectedColor: item.selectedColor,
        quantity: item.quantity,
      })),
    };
    const customerRate = checkRateLimit({
      scope: "orders:customer",
      key: ip + ":" + input.customer.phone,
      limit: 5,
      windowMs: 15 * 60_000,
    });
    if (!customerRate.ok) return withCors(request, rateLimitResponse(customerRate), METHODS);

    const order = await createWebOrder(input, idempotencyKey);
    return withCors(
      request,
      Response.json(
        {
          ok: true,
          order: {
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            total: order.total,
            createdAt: order.createdAt.toISOString(),
          },
        },
        { status: 201, headers: { "Cache-Control": "no-store" } }
      ),
      METHODS
    );
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === "INVALID_JSON")) {
      return withCors(request, jsonError(new StorefrontApiError("INVALID_REQUEST", "Invalid request payload.", 400)), METHODS);
    }
    if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") {
      return withCors(request, jsonError(new StorefrontApiError("PAYLOAD_TOO_LARGE", "Request payload is too large.", 400)), METHODS);
    }
    return withCors(request, jsonError(error), METHODS);
  }
}
