// Loaded via Node's native require at runtime (lzma-wasm is listed in
// serverExternalPackages in next.config.ts) — the CJS build embeds the wasm
// binary as inline base64, whereas the ESM build references a .wasm asset that
// isn't shipped in the package.
import { initWasmSync, compress, decompress } from "lzma-wasm";

let ready = false;
function ensureReady() {
  if (!ready) {
    initWasmSync();
    ready = true;
  }
}

/** Compress a Buffer/string to .xz format. level 6 = standard 7z, 9 = extreme. */
export function xzCompress(data: Buffer | string, level = 6): Buffer {
  ensureReady();
  const input = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return Buffer.from(compress(new Uint8Array(input), { format: "xz", level }));
}

/** Decompress an .xz / .lzma / .lzip buffer to a UTF-8 Buffer. */
export function xzDecompress(data: Buffer): Buffer {
  ensureReady();
  return Buffer.from(decompress(new Uint8Array(data)));
}
