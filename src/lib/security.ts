import crypto from "node:crypto";
import { getSessionUser } from "@/lib/auth";

export type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; retryAfterSeconds: number; resetAt: number };

type Bucket = { count: number; resetAt: number };

type SecurityGlobal = typeof globalThis & {
  __smsmRateLimitBuckets?: Map<string, Bucket>;
};

const securityGlobal = globalThis as SecurityGlobal;
const buckets = securityGlobal.__smsmRateLimitBuckets ?? new Map<string, Bucket>();
securityGlobal.__smsmRateLimitBuckets = buckets;

function hashKey(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwarded ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

export function checkRateLimit(options: {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();
  const bucketKey = options.scope + ":" + hashKey(options.key);
  const current = buckets.get(bucketKey);

  if (!current || now > current.resetAt) {
    const resetAt = now + options.windowMs;
    buckets.set(bucketKey, { count: 1, resetAt });
    return { ok: true, remaining: Math.max(0, options.limit - 1), resetAt };
  }

  if (current.count >= options.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    logSecurityEvent("rate_limit_hit", {
      scope: options.scope,
      keyHash: hashKey(options.key),
      retryAfterSeconds,
    });
    return { ok: false, retryAfterSeconds, resetAt: current.resetAt };
  }

  current.count += 1;
  return { ok: true, remaining: Math.max(0, options.limit - current.count), resetAt: current.resetAt };
}

export function rateLimitResponse(result: RateLimitResult) {
  const retryAfterSeconds = "retryAfterSeconds" in result ? result.retryAfterSeconds : 60;
  return Response.json(
    { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
      },
    }
  );
}

export function logSecurityEvent(event: string, metadata: Record<string, unknown> = {}) {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lower = key.toLowerCase();
    if (lower.includes("password") || lower.includes("token") || lower.includes("secret") || lower.includes("cookie")) {
      safe[key] = "[redacted]";
    } else {
      safe[key] = value;
    }
  }
  console.warn("[security]", JSON.stringify({ event, ...safe }));
}

export function getAllowedOrigins() {
  const configured = process.env.SYSTEM_ALLOWED_ORIGINS?.split(",") ?? [];
  const storefront = process.env.STOREFRONT_WEB_URL ? [process.env.STOREFRONT_WEB_URL] : [];
  return new Set(
    [...configured, ...storefront]
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean)
  );
}

export function corsHeaders(request: Request, methods: string[]) {
  const origin = request.headers.get("origin")?.replace(/\/$/, "");
  const allowedOrigins = getAllowedOrigins();
  const headers = new Headers();
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", methods.join(", "));
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
  headers.set("Access-Control-Max-Age", "600");

  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

export function corsPreflight(request: Request, methods: string[]) {
  return new Response(null, { status: 204, headers: corsHeaders(request, methods) });
}

export function withCors(request: Request, response: Response, methods: string[]) {
  const headers = corsHeaders(request, methods);
  headers.forEach((value, key) => response.headers.set(key, value));
  return response;
}

export async function readJsonWithLimit(request: Request, maxBytes: number) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > maxBytes) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }
  if (!text.trim()) throw new Error("INVALID_JSON");
  return JSON.parse(text) as unknown;
}

export async function requireRouteUser(allowedRoles: Array<"OWNER" | "SELLER"> = ["OWNER", "SELLER"]) {
  const user = await getSessionUser();
  if (!user) return { ok: false as const, response: Response.json({ ok: false }, { status: 401 }) };
  if (!allowedRoles.includes(user.role as "OWNER" | "SELLER")) {
    logSecurityEvent("unauthorized_access", { userId: user.id, role: user.role });
    return { ok: false as const, response: Response.json({ ok: false }, { status: 403 }) };
  }
  return { ok: true as const, user };
}
