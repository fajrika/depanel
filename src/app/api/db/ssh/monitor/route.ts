import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member" && !team.canSsh) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuka SSH Koneksi" }, { status: 403 });
  }

  const sshs = await prisma.sshConnection.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, host: true, port: true, username: true, authType: true, createdAt: true, groupId: true, group: { select: { id: true, name: true } } },
  });

  const samples = await prisma.sshMetricSample.findMany({
    where: { sshId: { in: sshs.map((s) => s.id) } },
    orderBy: { at: "desc" },
  });
  const last = new Map<string, (typeof samples)[number]>();
  for (const s of samples) {
    if (!last.has(s.sshId)) last.set(s.sshId, s);
  }

  const data = sshs.map((s) => {
    const l = last.get(s.id);
    return {
      id: s.id,
      name: s.name,
      host: s.host,
      port: s.port,
      username: s.username,
      authType: s.authType,
      createdAt: s.createdAt,
      groupName: s.group?.name ?? null,
      last: l
        ? {
            at: l.at,
            ok: l.ok,
            error: l.error,
            hostname: l.hostname,
            osName: l.osName,
            kernel: l.kernel,
            cpu: l.cpu,
            memPct: l.memPct,
            memUsedMb: l.memUsedMb,
            memTotalMb: l.memTotalMb,
            load1: l.load1,
            load5: l.load5,
            load15: l.load15,
            uptimeSec: l.uptimeSec,
            netInBps: l.netInBps,
            netOutBps: l.netOutBps,
            disk: l.disk ? JSON.parse(l.disk) : [],
            topProcs: l.topProcs ? JSON.parse(l.topProcs) : [],
            ports: l.ports ? JSON.parse(l.ports) : [],
            failedSvcs: l.failedSvcs ? JSON.parse(l.failedSvcs) : [],
          }
        : null,
    };
  });

  return NextResponse.json({ ok: true, data });
}
