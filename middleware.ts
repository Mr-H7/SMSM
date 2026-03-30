import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "smsm_session";

// صفحات لازم تكون مسجل دخول عشان تدخلها
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/products",
  "/sales",
  "/invoices",
  "/reports",
  "/targets",
  "/users",
];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // تجاهل ملفات النظام/الستاتيك
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/public")
  ) {
    return NextResponse.next();
  }

  // لو صفحة محمية ومفيش session cookie → روح login
  if (isProtectedPath(pathname)) {
    const hasSession = Boolean(req.cookies.get(COOKIE_NAME)?.value);

    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};