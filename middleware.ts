import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function shouldRedirectToHttps(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return false;
  const host = request.headers.get("host") ?? "";
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]")) return false;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return proto === "http" || request.nextUrl.protocol === "http:";
}

export function middleware(request: NextRequest) {
  if (request.headers.has("x-middleware-subrequest")) {
    return new NextResponse(null, { status: 400 });
  }

  if (shouldRedirectToHttps(request)) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
