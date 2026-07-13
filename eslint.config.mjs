import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // esbuild bundles (worker/seed/create-user) — build output, not source.
    "dist/**",
  ]),
  {
    // React 19 / eslint-config-next@16 shipped two new React-Compiler rules that
    // fire across the whole existing codebase and produce false positives
    // (e.g. `window.location.href = "/"` flagged as immutability, and the common
    // "reset state then fetch" effect pattern). They're perf smells, not bugs —
    // keep them visible as warnings instead of failing the build.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
    },
  },
]);

export default eslintConfig;
