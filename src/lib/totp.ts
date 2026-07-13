// Minimal TOTP (RFC 6238) using Node crypto — no external dependency.
import crypto from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function randomBase32Secret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes);
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) bits += B32.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

/** Verify a 6-digit code against a base32 secret, allowing ±1 time step of drift. */
export function verifyTotp(secretB32: string, token: string, atMs = Date.now()): boolean {
  const t = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(t)) return false;
  const secret = base32Decode(secretB32);
  const step = Math.floor(atMs / 1000 / 30);
  for (let w = -1; w <= 1; w++) {
    if (hotp(secret, step + w) === t) return true;
  }
  return false;
}

/** otpauth:// URL for authenticator apps / QR. */
export function otpauthUrl(secretB32: string, account: string, issuer = "Depanel"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretB32, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}
