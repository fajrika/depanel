import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server with only traced deps — keeps the Docker image small.
  output: "standalone",
  // Allow team members on the LAN to reach the dev server via the Mac Mini's IP,
  // not just localhost (Next.js blocks unrecognized cross-origin dev requests by default).
  // Next.js matches these per dot-separated segment ("*" = one segment) — CIDR notation
  // like "192.168.0.0/16" is NOT supported, so list common private-LAN prefixes instead.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*"],
  // lzma-wasm ships its wasm binary as inlined base64 in the CJS build, but its
  // ESM build references a .wasm file that isn't published. Bundling it trips
  // Turbopack's module resolver, so load it via native Node require instead.
  // ssh2 is loaded by the DB-backup routes; keep it external so the standalone
  // tracer pulls it (and its pure-JS fallback) into the runtime image as-is.
  serverExternalPackages: ["lzma-wasm", "ssh2"],
  // Standalone tracing follows the package's `import`/`default` conditions and
  // only copies the ESM build; force the CJS build in too (that's the one the
  // runtime `require` actually loads). Point at the single file (the wasm is
  // inlined as base64 inside it) — a `**/*` glob here made Turbopack trace the
  // whole project, blowing up build time/memory on the deploy server.
  outputFileTracingIncludes: {
    "/*": ["node_modules/lzma-wasm/dist/cjs/index.cjs"],
  },
  // The deploy box is too slow to typecheck the whole app during `next build`
  // (16+ min). Types are checked locally (`npx tsc --noEmit`) before pushing;
  // enable this in the Docker builder via SKIP_TYPESCRIPT_CHECK=1.
  typescript: {
    ignoreBuildErrors: process.env.SKIP_TYPESCRIPT_CHECK === "1",
  },
};

export default nextConfig;
