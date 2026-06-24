import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createSessionValue,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";
import { checkRateLimit, getClientIp, logSecurityEvent, rateLimitResponse } from "@/lib/security";

const loginFormSchema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(512),
});

function redirectTo(request: Request, pathname: string) {
  return NextResponse.redirect(new URL(pathname, request.url), 303);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const parsed = loginFormSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  const username = parsed.success ? parsed.data.username : "";
  const password = parsed.success ? parsed.data.password : "";
  const ip = getClientIp(request);
  const loginKey = ip + ":" + username.toLowerCase();
  const rate = checkRateLimit({ scope: "login", key: loginKey, limit: 5, windowMs: 60_000 });

  if (!rate.ok) {
    logSecurityEvent("login_rate_limited", { ipHash: "ip:" + ip, usernameHash: username ? "user:" + username.toLowerCase() : "empty" });
    return rateLimitResponse(rate);
  }

  if (!username || !password) {
    logSecurityEvent("failed_login", { reason: "missing_credentials", ipHash: "ip:" + ip });
    return redirectTo(request, "/login?error=1");
  }

  const user = await prisma.user.findFirst({
    where: { username },
    select: { id: true, passwordHash: true, isActive: true },
  });

  if (!user || user.isActive === false || !verifyPassword(password, user.passwordHash)) {
    logSecurityEvent("failed_login", { reason: "invalid_credentials", ipHash: "ip:" + ip, usernameHash: "user:" + username.toLowerCase() });
    return redirectTo(request, "/login?error=1");
  }

  const response = redirectTo(request, "/dashboard");

  response.cookies.set(
    SESSION_COOKIE_NAME,
    createSessionValue(user.id),
    await sessionCookieOptions(SESSION_MAX_AGE)
  );

  return response;
}
