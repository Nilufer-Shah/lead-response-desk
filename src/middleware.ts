import { NextResponse, type NextRequest } from "next/server";
const SESSION_COOKIE = "lead_desk_session";

export function middleware(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE);
  if (!session) return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api/auth/login|api/health|api/webhooks|login|_next|favicon.ico|icon.svg|roopkala-logo.webp|manifest.webmanifest|sw.js|og.png).*)"] };
