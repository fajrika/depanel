// Next.js 16 renamed `middleware` -> `proxy`. Runs on Node runtime.
// Gates app pages: redirects unauthenticated users to /login.
// API routes do their own auth (return 401), so they are excluded here.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/auth";

function secret(): Uint8Array {
  return new TextEncoder().encode(process.env.APP_SECRET || "");
}

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let valid = false;
  if (token) {
    try {
      await jwtVerify(token, secret());
      valid = true;
    } catch {
      valid = false;
    }
  }

  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login";

  if (!valid && !isLogin) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  if (valid && isLogin) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Protect everything except: api routes, next internals, static files, favicon.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|css|js)$).*)"],
};
