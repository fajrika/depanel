import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow team members on the LAN to reach the dev server via the Mac Mini's IP,
  // not just localhost (Next.js blocks unrecognized cross-origin dev requests by default).
  // Next.js matches these per dot-separated segment ("*" = one segment) — CIDR notation
  // like "192.168.0.0/16" is NOT supported, so list common private-LAN prefixes instead.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*"],
};

export default nextConfig;
