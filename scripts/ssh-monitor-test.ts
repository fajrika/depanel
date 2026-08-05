// Mock SSH server + assertions for src/lib/sshmon.ts collectors.
// Run: npx tsx scripts/ssh-monitor-test.ts
import { Server } from "ssh2";
import { generateKeyPairSync } from "node:crypto";
import { collectSshMetrics, sampleSshConnection } from "../src/lib/sshmon";
import { prisma } from "../src/lib/db";
import { encryptSecret } from "../src/lib/crypto";

const step = (m: string) => console.log(`[step] ${m}`);
let failures = 0;

function check(cond: boolean, label: string, got?: unknown) {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label} — got ${JSON.stringify(got)}`);
  }
}

const OS_RELEASE = 'PRETTY_NAME="Ubuntu 22.04.3 LTS"\nNAME="Ubuntu"\nVERSION_ID="22.04"\n';
const MEMINFO = [
  "MemTotal:        8000000 kB",
  "MemFree:         1500000 kB",
  "MemAvailable:    3000000 kB",
  "Buffers:          500000 kB",
  "Cached:          1000000 kB",
].join("\n") + "\n";

const STAT_A = "cpu  100 0 150 7900 0 100 0 0 0 0";
const STAT_B = "cpu  150 0 200 8200 0 100 0 0 0 0";
const DEV_A = "Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast |bytes    packets errs drop fifo colls carrier compressed\n eth0: 1000000       100    0    0    0     0          0         0  2000000       100    0    0    0     0     0          0\n   lo:  100000       100    0    0    0     0          0         0   100000       100    0    0    0     0     0          0\n";
const DEV_B = "Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast |bytes    packets errs drop fifo colls carrier compressed\n eth0: 1600000       160    0    0    0     0          0         0  2600000       260    0    0    0     0     0          0\n   lo:  100000       100    0    0    0     0          0         0   100000       100    0    0    0     0     0          0\n";
const DF = [
  "Filesystem     1024-blocks      Used Available Capacity Mounted on",
  "/dev/vda1      104857600  52428800  52428800      50% /",
  "tmpfs            1048576         0   1048576       0% /dev/shm",
  "/dev/vdb1      209715200  83886080 125829120      40% /data",
].join("\n") + "\n";
const PS = [
  " 1234 root        12.5   3.2 nginx: master process nginx",
  " 5678 mysql        5.0  15.0 mysqld",
  " 9101 www-data     0.3   1.1 php-fpm: pool www",
].join("\n") + "\n";
const NETSTAT = [
  "Active Internet connections (only servers)",
  "Proto Recv-Q Send-Q Local Address           Foreign Address         State",
  "tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN",
  "tcp        0      0 0.0.0.0:3306            0.0.0.0:*               LISTEN",
  "tcp6       0      0 [::]:443                [::]:*                  LISTEN",
].join("\n") + "\n";
const SYSTEMD = "nginx.service          loaded failed     failed    nginx.service\n";

const counters = new Map<string, number>();
function respond(cmd: string): { out: string; code: number } {
  const n = (counters.get(cmd) ?? 0) + 1;
  counters.set(cmd, n);
  if (cmd.startsWith("cat /proc/stat")) return { out: n % 2 === 1 ? STAT_A : STAT_B, code: 0 };
  if (cmd.startsWith("cat /proc/net/dev")) return { out: n % 2 === 1 ? DEV_A : DEV_B, code: 0 };
  if (cmd.startsWith("cat /proc/meminfo")) return { out: MEMINFO, code: 0 };
  if (cmd.startsWith("cat /proc/loadavg")) return { out: "1.42 1.10 0.95 3/452 12870\n", code: 0 };
  if (cmd.startsWith("cat /proc/uptime")) return { out: "3600.12 18000.50\n", code: 0 };
  if (cmd.startsWith("cat /etc/os-release")) return { out: OS_RELEASE, code: 0 };
  if (cmd.startsWith("uname -sr")) return { out: "6.2.0-1017-azure\n", code: 0 };
  if (cmd.startsWith("cat /etc/hostname")) return { out: "web-01\n", code: 0 };
  if (cmd.startsWith("df -kP")) return { out: DF, code: 0 };
  if (cmd.startsWith("ps -eo")) return { out: PS, code: 0 };
  if (cmd.startsWith("ss -tlnH")) return { out: "", code: 1 }; // force netstat fallback
  if (cmd.startsWith("netstat -tln")) return { out: NETSTAT, code: 0 };
  if (cmd.startsWith("systemctl list-units")) return { out: SYSTEMD, code: 0 };
  return { out: "", code: 127 };
}

const PORT = 2224;

async function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${tag} timeout`)), ms))]);
}

async function main() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs1", format: "pem" } });
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    client.on("authentication", (ctx) => (ctx.method === "password" ? ctx.accept() : ctx.reject()));
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (acceptExec, _reject, info) => {
          const stream = acceptExec();
          const res = respond(info.command);
          if (res.out) stream.write(res.out);
          stream.exit(res.code);
          stream.end();
        });
      });
    });
    client.on("error", () => {});
  });

  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
  step("mock server listening");

  const cfg = { host: "127.0.0.1", port: PORT, username: "root", authType: "password" as const, password: "secret123" };

  try {
    step("collectSshMetrics…");
    const s = await withTimeout(collectSshMetrics(cfg), 25000, "collect");
    check(s.osName === "Ubuntu 22.04.3 LTS", "osName", s.osName);
    check(s.kernel === "6.2.0-1017-azure", "kernel", s.kernel);
    check(s.hostname === "web-01", "hostname", s.hostname);
    check(s.load1 === 1.42 && s.load5 === 1.1 && s.load15 === 0.95, "load", [s.load1, s.load5, s.load15]);
    check(s.uptimeSec === 3600, "uptimeSec", s.uptimeSec);
    check(s.cpu === 25, "cpu%", s.cpu);
    check(s.memPct === 62.5, "memPct", s.memPct);
    check(s.memTotalMb === 7813, "memTotalMb", s.memTotalMb);
    check(s.memUsedMb === 4883, "memUsedMb", s.memUsedMb);
    check(s.netInBps === 600000 && s.netOutBps === 600000, "net B/s", [s.netInBps, s.netOutBps]);
    check(s.disk.length === 2, "disk count", s.disk);
    check(s.disk[0]?.mount === "/" && s.disk[0]?.pct === 50 && s.disk[0]?.sizeMb === 102400, "disk /", s.disk[0]);
    check(s.disk[1]?.mount === "/data" && s.disk[1]?.pct === 40, "disk /data", s.disk[1]);
    check(s.topProcs.length === 3, "topProcs count", s.topProcs);
    check(s.topProcs[0]?.cpu === 12.5 && s.topProcs[0]?.comm?.startsWith("nginx"), "topProcs[0]", s.topProcs[0]);
    check(JSON.stringify(s.ports) === JSON.stringify(["22", "3306", "443"]), "ports (netstat fallback)", s.ports);
    check(JSON.stringify(s.failedSvcs) === JSON.stringify(["nginx.service"]), "failedSvcs", s.failedSvcs);
    step("collectSshMetrics OK");

    step("sampleSshConnection persistence…");
    const row = await prisma.sshConnection.create({
      data: {
        name: "test-monitor",
        host: "127.0.0.1",
        port: PORT,
        username: "root",
        authType: "password",
        passwordEnc: encryptSecret("secret123"),
        privateKeyEnc: null,
        keyPassphraseEnc: null,
      },
    });
    try {
      const res = await withTimeout(sampleSshConnection(row.id), 25000, "sample");
      check(res.ok === true, "sample ok", res);
      const saved = await prisma.sshMetricSample.findFirst({ where: { sshId: row.id, ok: true }, orderBy: { at: "desc" } });
      check(!!saved && saved.cpu === 25 && (saved.disk?.includes("/data") ?? false), "sample persisted", saved);
    } finally {
      await prisma.sshMetricSample.deleteMany({ where: { sshId: row.id } });
      await prisma.sshConnection.delete({ where: { id: row.id } });
    }
    step("sampleSshConnection OK");
  } catch (e) {
    failures++;
    console.error("ERROR:", (e as Error).message);
  } finally {
    server.close();
  }

  if (failures) {
    console.error(`\n${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll assertions PASS");
  process.exit(0);
}

main();
