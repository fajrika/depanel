import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/power";
import { isSpeedtestBusy, runSpeedtestJob } from "@/lib/speedtest";
import { loadOwnJob } from "../../_shared";

/** Jalankan speedtest sekarang (latar belakang). Hasil muncul di riwayat ±30-60 dtk kemudian. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const job = await loadOwnJob(user.id, id);
  if (!job) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });

  // cek lintas proses (worker juga bisa sedang menguji server yang sama)
  const active = await prisma.speedtestResult.findFirst({
    where: { status: "running", startedAt: { gte: new Date(Date.now() - 20 * 60 * 1000) }, job: { sshId: job.sshId } },
    select: { id: true },
  });
  if (active || isSpeedtestBusy(job.id, job.sshId)) {
    return NextResponse.json({ ok: false, message: "Speedtest di server ini sedang berjalan, tunggu sampai selesai" }, { status: 409 });
  }

  await logActivity({ teamId: job.teamId, userId: user.id, action: "speedtest-run", message: `Jalankan speedtest "${job.name}"` });
  void runSpeedtestJob(id, "manual").catch((e) => console.error(`[SPEEDTEST] "${job.name}": ${(e as Error).message}`));
  return NextResponse.json({ ok: true, data: { started: true } });
}
