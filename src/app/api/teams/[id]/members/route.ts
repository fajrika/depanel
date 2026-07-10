import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { membershipOf, staffOf } from "@/lib/team";
import { logActivity } from "@/lib/power";

const addSchema = z.object({ email: z.string().email("Format email tidak valid") });

/** Tambah anggota berdasarkan email (owner/admin). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await staffOf(user.id, id))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }
  const team = await prisma.team.findUnique({ where: { id } });
  if (team?.isPersonal) {
    return NextResponse.json({ ok: false, message: "Tim pribadi tidak bisa menerima anggota lain" }, { status: 400 });
  }

  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const target = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!target || !target.active) {
    return NextResponse.json(
      { ok: false, message: "User dengan email itu belum terdaftar — minta admin aplikasi mendaftarkannya dulu" },
      { status: 404 },
    );
  }

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: id, userId: target.id } },
    create: { teamId: id, userId: target.id, role: "member" },
    update: {},
  });
  await logActivity({ teamId: id, userId: user.id, action: "member-add", message: `Tambah ${target.email}` });
  return NextResponse.json({ ok: true });
}

const patchSchema = z.object({
  userId: z.string().min(1),
  canViewBilling: z.boolean().optional(),
  canSchedule: z.boolean().optional(),
  canBackup: z.boolean().optional(),
  hiddenServerIds: z.array(z.string()).max(500).optional(),
  role: z.enum(["owner", "admin", "member"]).optional(),
});

/**
 * Ubah izin/role anggota.
 * - canViewBilling: owner/admin.
 * - angkat/turunkan admin: hanya owner.
 * - role "owner" = transfer ownership (hanya owner; owner lama otomatis jadi admin).
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const me = await membershipOf(user.id, id);
  if (!me || (me.role !== "owner" && me.role !== "admin")) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  const { userId, role, canViewBilling, canSchedule, canBackup, hiddenServerIds } = parsed.data;

  const target = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: id, userId } } });
  if (!target) return NextResponse.json({ ok: false, message: "Anggota tidak ditemukan" }, { status: 404 });

  // --- perubahan role ---
  if (role !== undefined) {
    if (me.role !== "owner") {
      return NextResponse.json({ ok: false, message: "Hanya owner yang boleh mengubah role" }, { status: 403 });
    }
    if (userId === user.id) {
      return NextResponse.json({ ok: false, message: "Ubah role sendiri lewat transfer ownership" }, { status: 400 });
    }
    if (role === "owner") {
      // transfer ownership — owner lama turun jadi admin
      await prisma.$transaction([
        prisma.teamMember.update({ where: { id: me.id }, data: { role: "admin" } }),
        prisma.teamMember.update({ where: { id: target.id }, data: { role: "owner", canViewBilling: true } }),
      ]);
      await logActivity({ teamId: id, userId: user.id, action: "ownership-transfer", message: `Ownership dialihkan ke user ${userId}` });
      return NextResponse.json({ ok: true, data: { transferred: true } });
    }
    await prisma.teamMember.update({ where: { id: target.id }, data: { role } });
    await logActivity({ teamId: id, userId: user.id, action: "role-update", message: `Role ${userId} → ${role}` });
  }

  // --- izin per-member (saldo / jadwal / backup) ---
  const flags: { canViewBilling?: boolean; canSchedule?: boolean; canBackup?: boolean } = {};
  if (canViewBilling !== undefined) flags.canViewBilling = canViewBilling;
  if (canSchedule !== undefined) flags.canSchedule = canSchedule;
  if (canBackup !== undefined) flags.canBackup = canBackup;
  if (Object.keys(flags).length > 0) {
    if (target.role !== "member") {
      return NextResponse.json({ ok: false, message: "Owner/admin selalu punya izin penuh" }, { status: 400 });
    }
    await prisma.teamMember.update({ where: { id: target.id }, data: flags });
  }

  // --- visibilitas server per member (daftar server yang DISEMBUNYIKAN) ---
  if (hiddenServerIds !== undefined) {
    if (target.role !== "member") {
      return NextResponse.json({ ok: false, message: "Owner/admin selalu melihat semua server" }, { status: 400 });
    }
    // hanya server milik tim ini yang valid
    const owned = await prisma.server.findMany({
      where: { id: { in: hiddenServerIds }, account: { teamId: id } },
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.memberServerHide.deleteMany({ where: { memberId: target.id } }),
      prisma.memberServerHide.createMany({
        data: owned.map((s) => ({ memberId: target.id, serverId: s.id })),
      }),
    ]);
  }

  return NextResponse.json({ ok: true });
}

const delSchema = z.object({ userId: z.string().min(1) });

/**
 * Keluarkan anggota / keluar sendiri.
 * - owner boleh kick siapa pun (admin & member), kecuali dirinya.
 * - admin hanya boleh kick member (tidak bisa kick owner atau admin lain).
 * - semua orang boleh keluar sendiri, kecuali owner (harus transfer dulu).
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const me = await membershipOf(user.id, id);
  if (!me) return NextResponse.json({ ok: false, message: "Anda bukan anggota tim ini" }, { status: 403 });

  const parsed = delSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  const targetId = parsed.data.userId;

  const team = await prisma.team.findUnique({ where: { id } });
  if (team?.isPersonal) {
    return NextResponse.json({ ok: false, message: "Tim pribadi tidak bisa ditinggalkan" }, { status: 400 });
  }

  const target = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: id, userId: targetId } } });
  if (!target) return NextResponse.json({ ok: false, message: "Anggota tidak ditemukan" }, { status: 404 });

  if (targetId === user.id) {
    // keluar sendiri
    if (me.role === "owner") {
      return NextResponse.json(
        { ok: false, message: "Owner tidak bisa keluar — transfer ownership dulu atau hapus tim" },
        { status: 400 },
      );
    }
  } else {
    // kick orang lain
    if (target.role === "owner") {
      return NextResponse.json({ ok: false, message: "Owner tidak bisa dikeluarkan" }, { status: 403 });
    }
    if (me.role === "admin" && target.role !== "member") {
      return NextResponse.json({ ok: false, message: "Admin hanya boleh mengeluarkan member" }, { status: 403 });
    }
    if (me.role === "member") {
      return NextResponse.json({ ok: false, message: "Member tidak boleh mengeluarkan anggota" }, { status: 403 });
    }
  }

  await prisma.teamMember.delete({ where: { id: target.id } });
  await logActivity({
    teamId: id,
    userId: user.id,
    action: "member-remove",
    message: targetId === user.id ? "Keluar dari tim" : `Keluarkan user ${targetId}`,
  });
  return NextResponse.json({ ok: true });
}
