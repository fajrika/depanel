import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { membershipOf, isStaff } from "@/lib/team";
import { clientForAccount } from "@/lib/power";

/** Rincian billing satu akun depa: ringkasan, riwayat kredit, top-up, laporan. */
export async function GET(_req: Request, ctx: { params: Promise<{ accountId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { accountId } = await ctx.params;
  const account = await prisma.depaAccount.findUnique({ where: { id: accountId } });
  if (!account?.teamId) return NextResponse.json({ ok: false, message: "Akun tidak ditemukan" }, { status: 404 });

  const m = await membershipOf(user.id, account.teamId);
  if (!m || (!isStaff(m.role) && !m.canViewBilling)) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi akses melihat saldo tim ini" }, { status: 403 });
  }

  try {
    const client = await clientForAccount(accountId);
    // ambil paralel; bagian yang gagal (mis. postpaid-only) tidak menggagalkan semuanya
    const [summary, credit, deposits, reports] = await Promise.allSettled([
      client.billingSummary(),
      client.creditHistory(),
      client.depositHistory(),
      client.billingReports(),
    ]);
    const val = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
    return NextResponse.json({
      ok: true,
      data: {
        accountName: account.name,
        summary: val(summary),
        credit: val(credit),
        deposits: val(deposits),
        reports: val(reports),
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
