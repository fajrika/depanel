// Jalankan web + worker sekaligus dalam satu proses induk.
//   node scripts/run-all.mjs dev    → next dev  + worker
//   node scripts/run-all.mjs prod   → next start + worker (jalankan `npm run build` dulu)
// Kalau salah satu mati, keduanya dihentikan (supaya tidak ada web tanpa scheduler).
import { spawn } from "node:child_process";

const mode = process.argv[2] === "prod" ? "prod" : "dev";

const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function run(name, color, cmd, args) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const prefix = `${color}[${name}]${RESET} `;
  const pipe = (stream) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(prefix + line + "\n");
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  return child;
}

const web = run("web", CYAN, "npx", mode === "prod" ? ["next", "start"] : ["next", "dev"]);
const worker = run("worker", MAGENTA, "npx", ["tsx", "worker/index.ts"]);

console.log(`🚀 Depanel (${mode}) — web + worker berjalan. Ctrl+C untuk berhenti.`);

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of [web, worker]) {
    if (c.exitCode === null) c.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 1500);
}

for (const [name, child] of [["web", web], ["worker", worker]]) {
  child.on("exit", (code) => {
    if (!shuttingDown) {
      process.stdout.write(`${RED}[${name}] berhenti (exit ${code}) — mematikan proses lainnya.${RESET}\n`);
      shutdown(code ?? 1);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
