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

/**
 * Build an absolute redirect URL using the EXTERNAL host/proto.
 * Behind a reverse proxy (Cloudflare Tunnel, Nginx, …) the origin connection is
 * often plain HTTP with a rewritten Host, so `request.url` would redirect to the
 * wrong scheme/host. Prefer the X-Forwarded-* headers the proxy sends.
 */
function externalRedirect(request: NextRequest, pathname: string): URL {
  const first = (v: string | null) => v?.split(",")[0]?.trim();
  const proto = first(request.headers.get("x-forwarded-proto")) || request.nextUrl.protocol.replace(":", "") || "http";
  const host =
    first(request.headers.get("x-forwarded-host")) || request.headers.get("host") || request.nextUrl.host;
  return new URL(`${proto}://${host}${pathname}`);
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
    return NextResponse.redirect(externalRedirect(request, "/login"));
  }
  if (valid && isLogin) {
    return NextResponse.redirect(externalRedirect(request, "/"));
  }
  return NextResponse.next();
}

export const config = {
  // Protect everything except: api routes, next internals, static files, favicon.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|css|js)$).*)"],
};
