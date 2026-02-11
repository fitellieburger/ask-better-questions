// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const STATIC_SITE = "https://ask-better-questions-w6cx.onrender.com";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only redirect the homepage
  if (pathname === "/") {
    return NextResponse.redirect(STATIC_SITE, 302);
  }

  return NextResponse.next();
}