import { ZodError } from "zod";
import { jsonError, requireStorefrontApiKey, StorefrontApiError } from "@/lib/storefront-api";
import { prisma } from "@/lib/prisma";
import { contactBodySchema } from "@/lib/storefront-validation";
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
    const ipRate = checkRateLimit({ scope: "contact:ip", key: ip, limit: 8, windowMs: 15 * 60_000 });
    if (!ipRate.ok) return withCors(request, rateLimitResponse(ipRate), METHODS);

    const parsed = contactBodySchema.parse(await readJsonWithLimit(request, 16 * 1024));
    const body = { name: parsed.name, contact: parsed.contact, message: parsed.message };
    const contactRate = checkRateLimit({
      scope: "contact:identity",
      key: ip + ":" + body.contact,
      limit: 3,
      windowMs: 15 * 60_000,
    });
    if (!contactRate.ok) return withCors(request, rateLimitResponse(contactRate), METHODS);

    const saved = await prisma.contactMessage.create({
      data: body,
      select: { id: true, status: true, createdAt: true },
    });

    return withCors(
      request,
      Response.json(
        { ok: true, message: { ...saved, createdAt: saved.createdAt.toISOString() } },
        { status: 201, headers: { "Cache-Control": "no-store" } }
      ),
      METHODS
    );
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === "INVALID_JSON")) {
      return withCors(request, jsonError(new StorefrontApiError("INVALID_MESSAGE", "Invalid message payload.", 400)), METHODS);
    }
    if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") {
      return withCors(request, jsonError(new StorefrontApiError("PAYLOAD_TOO_LARGE", "Request payload is too large.", 400)), METHODS);
    }
    return withCors(request, jsonError(error), METHODS);
  }
}
