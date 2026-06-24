import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE_NAME = "smsm_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("Missing SESSION_SECRET in .env");
  return s;
}

function hmac(data: string) {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("hex");
}

function timingSafeEqualHex(aHex: string, bHex: string) {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function shouldUseSecureCookie() {
  if (process.env.VERCEL === "1") {
    return true;
  }

  const h = await headers();
  const host = h.get("host") ?? "";
  const forwardedProto = h.get("x-forwarded-proto") ?? "";
  const forwarded = h.get("forwarded") ?? "";
  const forwardedSsl = h.get("x-forwarded-ssl") ?? "";

  if (
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]")
  ) {
    return false;
  }

  return (
    forwardedProto.split(",")[0]?.trim().toLowerCase() === "https" ||
    forwarded.toLowerCase().includes("proto=https") ||
    forwardedSsl.toLowerCase() === "on"
  );
}

export async function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: await shouldUseSecureCookie(),
    path: "/",
    maxAge,
  };
}

async function expiredSessionCookieOptions() {
  return {
    ...(await sessionCookieOptions(0)),
    expires: new Date(0),
  };
}

/**
 * ✅ NEW STANDARD:
 * pbkdf2$iterations$salt$hashHex  (digest = sha256)
 */
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 12);
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || typeof stored !== "string") return false;

  try {
    if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
      return bcrypt.compareSync(password, stored);
    }

    if (stored.startsWith("pbkdf2$")) {
      const parts = stored.split("$");
      if (parts.length !== 4) return false;

      const iterations = Number(parts[1]);
      const salt = parts[2];
      const hashHex = parts[3];

      if (!Number.isFinite(iterations) || iterations <= 0) return false;
      if (!salt || !hashHex) return false;

      const keylen = hashHex.length / 2;

      // ✅ accept legacy digests too
      for (const digest of ["sha1", "sha256", "sha512"] as const) {
        const derived = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString("hex");
        if (timingSafeEqualHex(derived, hashHex)) return true;
      }
      return false;
    }

    if (stored.startsWith("scrypt$")) {
      const parts = stored.split("$");
      if (parts.length !== 3) return false;

      const salt = parts[1];
      const hashHex = parts[2];
      const keylen = hashHex.length / 2;

      const derived = crypto.scryptSync(password, salt, keylen).toString("hex");
      return timingSafeEqualHex(derived, hashHex);
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Session cookie format:
 * userId.expiresAt.sig  where sig = HMAC(userId.expiresAt)
 */
export async function createSession(userId: string, days = 30) {
  const maxAge = days * 24 * 60 * 60;

  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, createSessionValue(userId, maxAge), await sessionCookieOptions(maxAge));
}

export function createSessionValue(userId: string, maxAge = SESSION_MAX_AGE) {
  const expiresAt = Date.now() + maxAge * 1000;
  const base = `${userId}.${expiresAt}`;
  const sig = hmac(base);
  return `${base}.${sig}`;
}

export async function destroySession() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, "", await expiredSessionCookieOptions());
}

function parseSession(raw: string | undefined | null) {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;

  const userId = parts[0];
  const expiresAt = Number(parts[1]);
  const sig = parts[2];

  if (!userId) return null;
  if (!Number.isFinite(expiresAt)) return null;
  if (Date.now() > expiresAt) return null;

  const base = `${userId}.${expiresAt}`;
  const expected = hmac(base);
  if (!timingSafeEqualHex(expected, sig)) return null;

  return { userId };
}

export async function getSessionUser() {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE_NAME)?.value ?? null;
  const parsed = parseSession(raw);
  if (!parsed) return null;

  const user = await prisma.user.findUnique({
    where: { id: parsed.userId },
    select: {
      id: true,
      username: true,
      fullName: true,
      role: true,
      isActive: true,
    },
  });

  if (!user) return null;
  if (user.isActive === false) return null;

  return user;
}
