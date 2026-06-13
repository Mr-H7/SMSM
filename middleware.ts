import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "smsm_session";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/products",
  "/sales",
  "/invoices",
  "/returns",
  "/shift-close",
  "/reports",
  "/targets",
  "/users",
];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isRouterPrefetch(req: NextRequest) {
  const purpose = req.headers.get("purpose") ?? "";
  const secPurpose = req.headers.get("sec-purpose") ?? "";

  return (
    req.headers.get("next-router-prefetch") === "1" ||
    purpose.toLowerCase() === "prefetch" ||
    secPurpose.toLowerCase().includes("prefetch")
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/public")
  ) {
    return NextResponse.next();
  }

  if (isRouterPrefetch(req)) {
    return NextResponse.next();
  }

  const hasSession = Boolean(req.cookies.get(COOKIE_NAME)?.value);

  if ((pathname === "/login" || pathname === "/login/") && hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  if (isProtectedPath(pathname) && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
