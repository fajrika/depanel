// Production launcher for the Docker image: runs the Next.js server and the
// scheduler worker in one container. If either exits, the other is stopped too
// (so the platform restarts the whole container — never web without scheduler).
import { spawn } from "node:child_process";

const procs = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of procs) {
    if (c.exitCode === null) c.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 1500);
}

function run(name, cmd, args) {
  const child = spawn(cmd, args, { stdio: "inherit", env: process.env });
  procs.push(child);
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[${name}] exited (${code}) — stopping container.`);
      shutdown(code ?? 1);
    }
  });
  return child;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("🚀 Depanel — starting web + scheduler worker");
// Next.js standalone server (respects PORT / HOSTNAME env)
run("web", "node", ["server.js"]);
// Compiled scheduler worker
run("worker", "node", ["dist/worker.cjs"]);
