import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isStaff, membershipOf } from "@/lib/team";
import { clientForAccount } from "@/lib/power";

interface ReportSummary {
  id: string;
  billing_periode: string;
  billing_date: string;
  status: string;
  total: number;
}

interface ReportDetailService {
  service: string;
  total: number;
  reports: {
    service_name: string;
    service_type: string;
    total_cost: number;
    tier_name?: string;
    details: {
      name: string;
      description: string;
      base_price: number;
      total_uptime_hour: number;
      total_cost: number;
    }[];
  }[];
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start"); // YYYY-MM-DD
  const end = searchParams.get("end"); // YYYY-MM-DD
  const accountId = searchParams.get("accountId"); // optional: specific account

  // Get all depa accounts for the user's team
  const accounts = await prisma.depaAccount.findMany({
    where: {
      active: true,
      ...(accountId ? { id: accountId } : {}),
    },
  });

  if (accounts.length === 0) {
    return NextResponse.json({ ok: false, message: "Tidak ada akun depa aktif" }, { status: 404 });
  }

  // Check access for first account's team
  const firstAccount = accounts[0];
  if (!firstAccount.teamId) {
    return NextResponse.json({ ok: false, message: "Akun tidak terhubung ke tim" }, { status: 400 });
  }
  const m = await membershipOf(user.id, firstAccount.teamId);
  if (!m || (!isStaff(m.role) && !m.canViewBilling)) {
    return NextResponse.json({ ok: false, message: "Anda tidak punya akses melihat laporan billing" }, { status: 403 });
  }

  const results = [];

  for (const account of accounts) {
    try {
      const client = await clientForAccount(account.id);

      // Fetch all data in parallel
      const [summaryRes, creditRes, depositRes, reportsRes] = await Promise.allSettled([
        client.billingSummary(),
        client.creditHistory({ start: start ?? undefined, end: end ?? undefined }),
        client.depositHistory({ start: start ?? undefined, end: end ?? undefined }),
        client.billingReports(),
      ]);

      const summary = summaryRes.status === "fulfilled" ? summaryRes.value : null;
      const credit = creditRes.status === "fulfilled" ? creditRes.value : null;
      const deposits = depositRes.status === "fulfilled" ? depositRes.value : null;
      const reports = reportsRes.status === "fulfilled" ? reportsRes.value : null;

      // Fetch report details for each report
      const reportDetails: ReportDetailService[] = [];
      if (reports && typeof reports === "object") {
        const reportList = (reports as { data?: ReportSummary[] }).data ?? [];
        for (const report of reportList) {
          // Filter reports within date range if specified
          if (start || end) {
            const reportDate = new Date(report.billing_date);
            if (start && reportDate < new Date(start)) continue;
            if (end && reportDate > new Date(end + "T23:59:59")) continue;
          }

          try {
            const detail = await client.reportDetail(report.id);
            if (detail && typeof detail === "object") {
              const d = detail as { services?: ReportDetailService[] };
              if (d.services) {
                reportDetails.push(...d.services);
              }
            }
          } catch {
            // Skip failed report details
          }
        }
      }

      // Parse credit data — depa client returns body.data, so shape is { data: [...], page }
      const creditRaw = credit && typeof credit === "object" ? credit as Record<string, unknown> : null;
      const creditData = Array.isArray(creditRaw?.data) ? creditRaw!.data as Array<{ type: string; amount: string; description: string; created_at: string; balance_after: string }> : [];

      // Parse deposit data
      const depositRaw = deposits && typeof deposits === "object" ? deposits as Record<string, unknown> : null;
      const depositData = Array.isArray(depositRaw?.data) ? depositRaw!.data as Array<{ id: string; description: string; detail?: { amount: number; vat: number; payment_fee: number }; method: string; status: string; created_at: string }> : [];

      // Calculate totals
      const totalTopup = depositData
        .filter((d) => d.status === "SUCCESS")
        .reduce((sum, d) => sum + (d.detail?.amount ?? 0), 0);
      const totalDeduct = creditData
        .filter((c) => c.type === "Deduct")
        .reduce((sum, c) => {
          // Parse "Rp3.483.790,40" format
          const amount = parseFloat(c.amount.replace(/[Rp.,\s]/g, "").replace(",", ".")) || 0;
          return sum + amount;
        }, 0);

      results.push({
        accountName: account.name,
        accountId: account.id,
        summary,
        creditHistory: creditData,
        deposits: depositData,
        reportDetails,
        totals: {
          topup: totalTopup,
          usage: totalDeduct,
        },
      });
    } catch (e) {
      results.push({
        accountName: account.name,
        accountId: account.id,
        error: (e as Error).message,
      });
    }
  }

  return NextResponse.json({ ok: true, data: results });
}
