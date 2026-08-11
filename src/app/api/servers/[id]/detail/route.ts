import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canTouchServer } from "@/lib/team";
import { getServerDetail } from "@/lib/power";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await canTouchServer(user.id, id))) {
    return NextResponse.json({ ok: false, message: "Anda tidak punya akses ke server ini" }, { status: 403 });
  }

  const server = await prisma.server.findUnique({
    where: { id },
    include: { account: { select: { name: true } } },
  });
  if (!server) return NextResponse.json({ ok: false, message: "Server tidak ditemukan" }, { status: 404 });

  const force = new URL(request.url).searchParams.get("refresh") === "1";
  try {
    const detail = await getServerDetail(id, force);
    const detailObj = detail as Record<string, unknown>;
    return NextResponse.json({
      ok: true,
      data: {
        server: { id: server.id, hostname: server.hostname, status: server.status, account: server.account.name },
        spec: {
          cpu: server.cpu,
          memoryGb: server.memoryMb ? Math.round(server.memoryMb / 1024) : null,
          storageGb: server.storageGb,
          useDedicatedCpu: detailObj.is_cpu_dedicated === true,
        },
        detail,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
