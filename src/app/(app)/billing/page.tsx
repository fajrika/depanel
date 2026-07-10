"use client";

import { useCallback, useEffect, useState } from "react";

type BillingSummary = {
  current_balance?: number;
  actual_balance?: number;
  current_cost?: number;
  current_hour_cost?: number;
  estimated_monthly_total?: number;
  last_topup?: { amount: number; date: string }[];
};

type AccountEntry = {
  accountId: string;
  accountName: string;
  ok: boolean;
  error?: string;
  summary?: BillingSummary;
};

type Paged<T> = { data?: T[]; page?: { total?: number } } | null;

type CreditRow = { id: number; type: string; description: string; amount: string; balance_after: string; created_at: string };
type DepositRow = {
  id: string;
  invoice_number: string;
  description: string;
  detail?: { amount?: number; vat?: number; payment_fee?: number };
  method?: string;
  status?: string;
  created_at?: string;
};
type ReportRow = { id: string; billing_periode: string; billing_date?: string; status?: string; total?: number };

type Detail = {
  accountName: string;
  summary: BillingSummary | null;
  credit: Paged<CreditRow>;
  deposits: Paged<DepositRow>;
  reports: Paged<ReportRow>;
};

function rupiah(n?: number): string {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
}

const card = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const th = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";
const td = "px-4 py-2.5 text-slate-700 dark:text-slate-200";

function rows<T>(p: Paged<T>): T[] {
  if (!p) return [];
  const d = (p as Record<string, unknown>).data;
  return Array.isArray(d) ? (d as T[]) : [];
}

export default function BillingPage() {
  const [accounts, setAccounts] = useState<AccountEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(() => {
    fetch("/api/billing")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setAccounts(d.data ?? []);
        else setError(d.message ?? "Gagal memuat");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  async function openDetail(accountId: string) {
    setSelected(accountId);
    setDetail(null);
    setDetailLoading(true);
    setError(null);
    const res = await fetch(`/api/billing/${accountId}`);
    const d = await res.json();
    setDetailLoading(false);
    if (d.ok) setDetail(d.data);
    else setError(d.message ?? "Gagal memuat rincian");
  }

  // ===== rincian satu akun =====
  if (selected) {
    const s = detail?.summary;
    return (
      <div className="animate-fade-up">
        <button
          onClick={() => {
            setSelected(null);
            setDetail(null);
          }}
          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          ← semua akun depa
        </button>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {detail?.accountName ?? "Rincian saldo"}
        </h1>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}

        {detailLoading ? (
          <div className="mt-5 space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`${card} h-32 animate-pulse`} />
            ))}
          </div>
        ) : detail ? (
          <div className="mt-5 space-y-6">
            {/* ringkasan */}
            {s && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  // actual_balance = kredit tercatat − biaya berjalan → sama dengan angka di web depa
                  { l: "Saldo", v: rupiah(s.actual_balance), sub: `kredit tercatat ${rupiah(s.current_balance)}` },
                  { l: "Biaya bulan ini", v: rupiah(s.current_cost), sub: "berjalan" },
                  { l: "Biaya per jam", v: rupiah(s.current_hour_cost), sub: "saat ini" },
                  {
                    l: "Estimasi sisa hari",
                    v:
                      s.actual_balance && s.current_hour_cost && s.current_hour_cost > 0
                        ? `${Math.floor(s.actual_balance / s.current_hour_cost / 24)} hari`
                        : "—",
                    sub: "dengan pemakaian sekarang",
                  },
                ].map((x) => (
                  <div key={x.l} className={`${card} p-5`}>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{x.l}</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{x.v}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{x.sub}</p>
                  </div>
                ))}
              </div>
            )}

            {/* laporan tagihan */}
            <div className={card}>
              <h2 className="px-5 pt-4 text-sm font-semibold text-slate-800 dark:text-slate-100">Laporan tagihan</h2>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className={th}>Periode</th>
                      <th className={th}>Status</th>
                      <th className={`${th} text-right`}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows<ReportRow>(detail.reports).length === 0 ? (
                      <tr><td className={`${td} text-slate-400`} colSpan={3}>Belum ada laporan.</td></tr>
                    ) : (
                      rows<ReportRow>(detail.reports).map((r) => (
                        <tr key={r.id} className="border-b border-slate-50 last:border-0 dark:border-slate-800/50">
                          <td className={td}>{r.billing_periode}</td>
                          <td className={td}>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.status === "Ongoing" ? "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-400" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                              {r.status}
                            </span>
                          </td>
                          <td className={`${td} text-right tabular-nums`}>{rupiah(r.total)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* riwayat top-up */}
            <div className={card}>
              <h2 className="px-5 pt-4 text-sm font-semibold text-slate-800 dark:text-slate-100">Riwayat top-up</h2>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className={th}>Invoice</th>
                      <th className={th}>Deskripsi</th>
                      <th className={th}>Metode</th>
                      <th className={th}>Status</th>
                      <th className={`${th} text-right`}>Jumlah</th>
                      <th className={th}>Waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows<DepositRow>(detail.deposits).length === 0 ? (
                      <tr><td className={`${td} text-slate-400`} colSpan={6}>Belum ada top-up.</td></tr>
                    ) : (
                      rows<DepositRow>(detail.deposits).map((r) => (
                        <tr key={r.id} className="border-b border-slate-50 last:border-0 dark:border-slate-800/50">
                          <td className={`${td} font-mono text-xs`}>{r.invoice_number}</td>
                          <td className={td}>{r.description}</td>
                          <td className={td}>{r.method ?? "—"}</td>
                          <td className={td}>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"}`}>
                              {r.status}
                            </span>
                          </td>
                          <td className={`${td} text-right tabular-nums`}>
                            {rupiah(r.detail?.amount)}
                            {r.detail?.vat ? <span className="block text-[10px] text-slate-400">+PPN {rupiah(r.detail.vat)}</span> : null}
                          </td>
                          <td className={`${td} whitespace-nowrap text-xs`}>{r.created_at}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* riwayat kredit */}
            <div className={card}>
              <h2 className="px-5 pt-4 text-sm font-semibold text-slate-800 dark:text-slate-100">Riwayat kredit (mutasi saldo)</h2>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className={th}>Tipe</th>
                      <th className={th}>Deskripsi</th>
                      <th className={`${th} text-right`}>Jumlah</th>
                      <th className={`${th} text-right`}>Saldo setelah</th>
                      <th className={th}>Waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows<CreditRow>(detail.credit).length === 0 ? (
                      <tr><td className={`${td} text-slate-400`} colSpan={5}>Belum ada mutasi.</td></tr>
                    ) : (
                      rows<CreditRow>(detail.credit).map((r) => (
                        <tr key={r.id} className="border-b border-slate-50 last:border-0 dark:border-slate-800/50">
                          <td className={td}>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.type === "Add" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400"}`}>
                              {r.type === "Add" ? "+ masuk" : "− keluar"}
                            </span>
                          </td>
                          <td className={`${td} max-w-md`}>{r.description}</td>
                          <td className={`${td} text-right tabular-nums`}>{r.amount}</td>
                          <td className={`${td} text-right tabular-nums`}>{r.balance_after}</td>
                          <td className={`${td} whitespace-nowrap text-xs`}>{r.created_at}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // ===== pilih akun =====
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Saldo & tagihan</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Pilih profil akun depa untuk melihat rincian saldo, top-up, mutasi kredit, dan laporan tagihan.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}

      {loading ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1].map((i) => (
            <div key={i} className={`${card} h-40 animate-pulse`} />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <p className="mt-5 text-sm text-slate-400">Belum ada akun depa.</p>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a, i) => (
            <button
              key={a.accountId}
              onClick={() => a.ok && openDetail(a.accountId)}
              disabled={!a.ok}
              className={`${card} animate-fade-up group p-5 text-left transition-all duration-300 ${
                a.ok ? "cursor-pointer hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-700" : "opacity-70"
              }`}
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-sm font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
                  {a.accountName.slice(0, 2).toUpperCase()}
                </span>
                {a.ok && <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500 dark:text-slate-600">→</span>}
              </div>
              <p className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{a.accountName}</p>
              {!a.ok ? (
                <p className="mt-1 text-xs text-red-500">{a.error}</p>
              ) : (
                <>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {rupiah(a.summary?.actual_balance)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                    biaya/jam {rupiah(a.summary?.current_hour_cost)} · bulan ini {rupiah(a.summary?.current_cost)}
                  </p>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
