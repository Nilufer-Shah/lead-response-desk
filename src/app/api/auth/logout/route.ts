import { NextResponse } from "next/server";
import { revokeCurrentSession, SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  await revokeCurrentSession();
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" });
  response.headers.set("Clear-Site-Data", '"cache", "storage"');
  return response;
}
