import crypto from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "smsm_session";

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

/**
 * ✅ NEW STANDARD:
 * pbkdf2$iterations$salt$hashHex  (digest = sha256)
 */
export function hashPassword(password: string): string {
  const iterations = 120_000;
  const salt = crypto.randomBytes(16).toString("hex");
  const keylen = 32; // 32 bytes => 64 hex chars
  const digest = "sha256";

  const derived = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString("hex");
  return `pbkdf2$${iterations}$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || typeof stored !== "string") return false;

  try {
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
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
  const base = `${userId}.${expiresAt}`;
  const sig = hmac(base);
  const value = `${base}.${sig}`;

  const jar = await cookies();
  jar.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
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
  const raw = jar.get(COOKIE_NAME)?.value ?? null;
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