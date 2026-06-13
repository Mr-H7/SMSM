import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createSessionValue,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
  verifyPassword,
} from "@/lib/auth";

function redirectTo(request: Request, pathname: string) {
  return NextResponse.redirect(new URL(pathname, request.url), 303);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();

  if (!username || !password) {
    return redirectTo(request, "/login?error=1");
  }

  const user = await prisma.user.findFirst({
    where: { username },
    select: { id: true, passwordHash: true, isActive: true },
  });

  if (!user || user.isActive === false || !verifyPassword(password, user.passwordHash)) {
    return redirectTo(request, "/login?error=1");
  }

  const response = redirectTo(request, "/dashboard");

  response.cookies.set(SESSION_COOKIE_NAME, createSessionValue(user.id), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return response;
}
