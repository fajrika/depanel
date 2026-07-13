// Periodic metric/status sampling for uptime & history. Worker-safe.
import { prisma } from "./db";
import { clientForAccount } from "./power";

type RrdPoint = { cpu?: number; raw_max_memory?: number; raw_usage_memory?: number };

/** Take one sample per server (status always; cpu/mem best-effort for running ones). */
export async function sampleAllMetrics(): Promise<number> {
  const servers = await prisma.server.findMany({
    where: { account: { active: true } },
    select: { id: true, uuid: true, accountId: true, status: true },
  });

  let count = 0;
  for (const s of servers) {
    let cpu: number | null = null;
    let memPct: number | null = null;

    if (s.status === "running") {
      try {
        const client = await clientForAccount(s.accountId);
        const rrd = (await client.metrics(s.uuid, "hour")) as {
          cpu?: RrdPoint[];
          memory?: RrdPoint[];
        };
        const cpuArr = rrd.cpu ?? [];
        const memArr = rrd.memory ?? [];
        // second-to-last point (last is the in-progress zero bucket)
        const cp = cpuArr.length >= 2 ? cpuArr[cpuArr.length - 2] : cpuArr.at(-1);
        const mp = memArr.length >= 2 ? memArr[memArr.length - 2] : memArr.at(-1);
        if (typeof cp?.cpu === "number") cpu = Math.round(cp.cpu * 10) / 10;
        if (mp && mp.raw_max_memory) memPct = Math.round(((mp.raw_usage_memory ?? 0) / mp.raw_max_memory) * 1000) / 10;
      } catch {
        /* rate-limit / transient — record status only */
      }
    }

    await prisma.metricSample.create({ data: { serverId: s.id, status: s.status, cpu, memPct } });
    count++;
  }

  // retention: keep ~30 days of samples
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await prisma.metricSample.deleteMany({ where: { at: { lt: cutoff } } });
  return count;
}

/** Uptime % and sample series for a server over the last `hours`. */
export async function getServerHistory(serverId: string, hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const samples = await prisma.metricSample.findMany({
    where: { serverId, at: { gte: since } },
    orderBy: { at: "asc" },
    select: { at: true, status: true, cpu: true, memPct: true },
  });
  const total = samples.length;
  const up = samples.filter((s) => s.status === "running").length;
  return {
    uptimePct: total ? Math.round((up / total) * 1000) / 10 : null,
    samples: samples.map((s) => ({ t: s.at.toISOString(), status: s.status, cpu: s.cpu, memPct: s.memPct })),
  };
}
