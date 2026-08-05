import { Server } from "ssh2";
import { createPublicKey, generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { testSshConnection } from "../src/lib/dbbackup";

const step = (m: string) => console.log(`[step] ${m}`);

async function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${tag} timeout`)), ms))]);
}

async function main() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs1", format: "pem" } });
  const pubKeyObject = createPublicKey(publicKey);

  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    step("server: client connected");
    client.on("authentication", (ctx) => {
      type PubCtx = { method: "publickey"; key: { algo: string }; blob?: Buffer; signature?: Buffer; sigAlgo?: string };
      const pub = ctx.method === "publickey" ? (ctx as PubCtx) : null;
      step(`server: auth method=${ctx.method} sig=${!!pub?.signature}`);
      if (ctx.method === "password") {
        ctx.accept();
      } else if (ctx.method === "publickey") {
        if (!pub!.signature) {
          ctx.accept(); // trial → PK_OK
        } else {
          step(`server: sigAlgo=${pub!.sigAlgo} keyAlgo=${pub!.key.algo}`);
          let ok = false;
          for (const a of ["RSA-SHA512", "RSA-SHA256", "RSA-SHA1"]) {
            try {
              if (cryptoVerify(a, pub!.blob as Buffer, pubKeyObject, pub!.signature as Buffer)) { ok = true; break; }
            } catch (e) {
              step(`server: verify ${a} err ${(e as Error).message}`);
            }
          }
          step(`server: verify=${ok}`);
          if (ok) ctx.accept();
          else ctx.reject();
        }
      } else ctx.reject();
    });
    client.on("ready", () => step("server: session ready"));
    client.on("error", (e) => step(`server: error ${(e as Error).message}`));
  });

  await new Promise<void>((r, rej) => server.listen(2223, "127.0.0.1", r));
  step("server listening");

  try {
    step("testing password auth…");
    await withTimeout(testSshConnection({ host: "127.0.0.1", port: 2223, username: "root", authType: "password", password: "secret123" }), 15000, "password");
    step("PASS password auth");

    step("testing public-key auth…");
    await withTimeout(testSshConnection({ host: "127.0.0.1", port: 2223, username: "root", authType: "key", password: "", privateKey }), 15000, "key");
    step("PASS public-key auth");
  } catch (e) {
    console.error("FAIL:", (e as Error).message);
    process.exitCode = 1;
  } finally {
    server.close();
    process.exit();
  }
}

main();
