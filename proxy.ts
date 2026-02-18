// proxy.ts (replaces middleware.ts — renamed per Next.js 16 convention)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isAsset(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/robots") ||
    pathname.startsWith("/sitemap") ||
    pathname.startsWith("/images") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".map") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico")
  );
}

export function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // ✅ Never touch assets
  if (isAsset(pathname)) return NextResponse.next();

  // ✅ Add explicit "no redirect" escape hatch for local testing
  if (
    req.nextUrl.hostname === "localhost" ||
    req.nextUrl.hostname === "127.0.0.1" ||
    searchParams.has("noredirect")
  ) {
    return NextResponse.next();
  }

  // ✅ Never redirect your warmup/bundle routes
  // (adjust these to match your actual warmup page paths)
  if (
    pathname === "/warmup" ||
    pathname === "/bundle" ||
    pathname.startsWith("/warmup/")
  ) {
    return NextResponse.next();
  }

  // --- your redirect logic below ---
  return NextResponse.next();
}

export const config = {
  // ✅ Apply broadly, but we already protect assets above.
  matcher: "/:path*"
};
