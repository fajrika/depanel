"use client";

import { useCallback, useEffect, useState } from "react";

type CreditRow = { id: number; type: string; description: string; amount: string; balance_after: string; created_at: string };
type DepositRow = {
  id: string;
  invoice_number?: string;
  description: string;
  detail?: { amount?: number; vat?: number; payment_fee?: number };
  method?: string;
  status?: string;
  created_at?: string;
};
type ReportDetailService = {
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
};
type BillingSummary = {
  current_balance?: number;
  actual_balance?: number;
  current_cost?: number;
  current_hour_cost?: number;
  estimated_monthly_total?: number;
};
type AccountReport = {
  accountName: string;
  accountId: string;
  summary?: BillingSummary;
  creditHistory?: CreditRow[];
  deposits?: DepositRow[];
  reportDetails?: ReportDetailService[];
  totals?: { topup: number; usage: number };
  error?: string;
};

function rupiah(n?: number): string {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
}

function parseAmount(str?: string): number {
  if (!str) return 0;
  return parseFloat(str.replace(/[Rp.,\s]/g, "").replace(",", ".")) || 0;
}

function fmtDate(d?: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const th = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";
const td = "px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200";
const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const btnPrimary =
  "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

export default function FinancialReportPage() {
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<AccountReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "credit" | "deposit" | "servers" | "perserver">("summary");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      const res = await fetch(`/api/reports/financial?${params}`);
      const d = await res.json();
      if (d.ok) setData(d.data ?? []);
      else setError(d.message ?? "Gagal memuat laporan");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    load();
  }, [load]);

  // Aggregate across all accounts
  const totalTopup = data.reduce((s, a) => s + (a.totals?.topup ?? 0), 0);
  const totalUsage = data.reduce((s, a) => s + (a.totals?.usage ?? 0), 0);
  const totalBalance = data.reduce((s, a) => s + (a.summary?.actual_balance ?? 0), 0);
  const totalServers = data.reduce((s, a) => s + (a.reportDetails?.length ?? 0), 0);
  const allCredit = data.flatMap((a) => (a.creditHistory ?? []).map((c) => ({ ...c, account: a.accountName })));
  const allDeposits = data.flatMap((a) => (a.deposits ?? []).map((d) => ({ ...d, account: a.accountName })));
  const allServerDetails = data.flatMap((a) => (a.reportDetails ?? []).map((r) => ({ ...r, account: a.accountName })));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Laporan Keuangan</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Ringkasan pemakaian, top-up, dan rincian biaya per server dari depa cloud.</p>
      </div>

      {/* Filter */}
      <div className={`${card} flex flex-wrap items-end gap-4`}>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Dari tanggal</label>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${input} mt-1`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Sampai tanggal</label>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={`${input} mt-1`} />
        </div>
        <button onClick={load} disabled={loading} className={btnPrimary}>
          {loading ? "Memuat…" : "Tampilkan"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      {data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className={card}>
            <p className="text-xs font-medium text-slate-400">Saldo Aktual</p>
            <p className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{rupiah(totalBalance)}</p>
          </div>
          <div className={card}>
            <p className="text-xs font-medium text-slate-400">Total Top-up</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{rupiah(totalTopup)}</p>
          </div>
          <div className={card}>
            <p className="text-xs font-medium text-slate-400">Total Pemakaian</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{rupiah(totalUsage)}</p>
          </div>
          <div className={card}>
            <p className="text-xs font-medium text-slate-400">Jumlah Server</p>
            <p className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{totalServers}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      {data.length > 0 && (
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {([["summary", "Ringkasan"], ["credit", "Riwayat Pemakaian"], ["deposit", "Riwayat Top-up"], ["servers", "Layanan"], ["perserver", "Per Server"]] as const).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === k ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          ))}
        </div>
      )}

      {/* Tab: Summary */}
      {!loading && tab === "summary" && data.length > 0 && (
        <div className="space-y-4">
          {data.map((a) => (
            <div key={a.accountId} className={card}>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{a.accountName}</h3>
              {a.error ? (
                <p className="mt-2 text-xs text-red-500">{a.error}</p>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-slate-400">Saldo</p>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">{rupiah(a.summary?.actual_balance)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Biaya Bulanan</p>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">{rupiah(a.summary?.current_cost)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Estimasi Akhir Bulan</p>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">{rupiah(a.summary?.estimated_monthly_total)}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tab: Credit History */}
      {!loading && tab === "credit" && (
        <div className={card + " overflow-x-auto"}>
          {allCredit.length === 0 ? (
            <p className="p-5 text-center text-sm text-slate-400">Tidak ada data pemakaian pada rentang tanggal ini.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className={th}>Tanggal</th>
                  <th className={th}>Akun</th>
                  <th className={th}>Tipe</th>
                  <th className={th}>Deskripsi</th>
                  <th className={th + " text-right"}>Jumlah</th>
                  <th className={th + " text-right"}>Saldo Sisa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {allCredit.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                    <td className={td}>{fmtDate(c.created_at)}</td>
                    <td className={td}>{c.account}</td>
                    <td className={td}>
                      <span className={c.type === "Deduct" ? "text-red-600" : "text-emerald-600"}>{c.type}</span>
                    </td>
                    <td className={td + " max-w-xs truncate"}>{c.description}</td>
                    <td className={td + " text-right font-mono"}>{c.amount}</td>
                    <td className={td + " text-right font-mono"}>{c.balance_after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab: Deposit History */}
      {!loading && tab === "deposit" && (
        <div className={card + " overflow-x-auto"}>
          {allDeposits.length === 0 ? (
            <p className="p-5 text-center text-sm text-slate-400">Tidak ada data top-up pada rentang tanggal ini.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className={th}>Tanggal</th>
                  <th className={th}>Akun</th>
                  <th className={th}>Deskripsi</th>
                  <th className={th}>Metode</th>
                  <th className={th}>Status</th>
                  <th className={th + " text-right"}>Jumlah</th>
                  <th className={th + " text-right"}>PPN</th>
                  <th className={th + " text-right"}>Biaya</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {allDeposits.map((d, i) => (
                  <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                    <td className={td}>{fmtDate(d.created_at)}</td>
                    <td className={td}>{d.account}</td>
                    <td className={td}>{d.description}</td>
                    <td className={td}>{d.method ?? "—"}</td>
                    <td className={td}>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${d.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className={td + " text-right font-mono"}>{rupiah(d.detail?.amount)}</td>
                    <td className={td + " text-right font-mono"}>{rupiah(d.detail?.vat)}</td>
                    <td className={td + " text-right font-mono"}>{rupiah(d.detail?.payment_fee)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab: Server Details */}
      {!loading && tab === "servers" && (
        <div className="space-y-4">
          {allServerDetails.length === 0 ? (
            <div className={card}>
              <p className="p-5 text-center text-sm text-slate-400">Tidak ada data rincian server pada rentang tanggal ini.</p>
            </div>
          ) : (
            allServerDetails.map((svc, i) => (
              <div key={i} className={card}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{svc.service}</h3>
                    <p className="text-xs text-slate-400">{svc.account}</p>
                  </div>
                  <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{rupiah(svc.total)}</p>
                </div>
                {svc.reports.map((r, j) => (
                  <div key={j} className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{r.service_name}</p>
                        {r.tier_name && <p className="text-xs text-slate-400">{r.tier_name}</p>}
                      </div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{rupiah(r.total_cost)}</p>
                    </div>
                    {r.details.length > 0 && (
                      <div className="mt-2 ml-4">
                        {r.details.map((d, k) => (
                          <div key={k} className="flex items-center justify-between py-0.5 text-xs text-slate-500 dark:text-slate-400">
                            <span>{d.name}</span>
                            <span className="font-mono">{d.total_uptime_hour.toFixed(1)} jam · {rupiah(d.total_cost)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Per Server */}
      {!loading && tab === "perserver" && (
        <div className="space-y-4">
          {(() => {
            // Group by server name across all service categories
            const serverMap = new Map<string, { account: string; components: { category: string; name: string; description: string; cost: number; uptime: number; basePrice: number }[]; totalCost: number }>();
            for (const svc of allServerDetails) {
              for (const r of svc.reports) {
                const key = `${r.service_name}|||${svc.account}`;
                const existing = serverMap.get(key);
                if (existing) {
                  for (const d of r.details) {
                    existing.components.push({ category: svc.service, ...d, cost: d.total_cost, uptime: d.total_uptime_hour, basePrice: d.base_price });
                    existing.totalCost += d.total_cost;
                  }
                } else {
                  const components = r.details.map((d) => ({ category: svc.service, ...d, cost: d.total_cost, uptime: d.total_uptime_hour, basePrice: d.base_price }));
                  serverMap.set(key, { account: svc.account, components, totalCost: components.reduce((s, c) => s + c.cost, 0) });
                }
              }
            }
            const servers = [...serverMap.entries()].map(([key, val]) => ({ name: key.split("|||")[0], ...val })).sort((a, b) => b.totalCost - a.totalCost);

            if (servers.length === 0) {
              return (
                <div className={card}>
                  <p className="p-5 text-center text-sm text-slate-400">Tidak ada data server pada rentang tanggal ini.</p>
                </div>
              );
            }
            return (
              <>
                <div className={`${card} flex items-center justify-between`}>
                  <p className="text-sm text-slate-500">{servers.length} server ditemukan</p>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Total: {rupiah(servers.reduce((s, sv) => s + sv.totalCost, 0))}</p>
                </div>
                {servers.map((sv, i) => (
                  <div key={i} className={card}>
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{sv.name}</h3>
                        <p className="text-xs text-slate-400">{sv.account}</p>
                      </div>
                      <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{rupiah(sv.totalCost)}</p>
                    </div>
                    <div className="mt-3 space-y-1">
                      {sv.components.map((c, j) => (
                        <div key={j} className="flex items-center justify-between py-1 text-xs text-slate-500 dark:text-slate-400">
                          <span>
                            <span className="inline-block w-20 rounded bg-slate-100 px-1.5 py-0.5 text-center text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">{c.category}</span>
                            {" "}
                            {c.name}
                            {c.description && c.description !== c.name && <span className="ml-1 text-slate-400">({c.description})</span>}
                          </span>
                          <span className="flex gap-3 font-mono">
                            {c.uptime > 0 && <span>{c.uptime.toFixed(0)} jam</span>}
                            {c.basePrice > 0 && <span className="text-slate-400">@ {rupiah(c.basePrice)}</span>}
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{rupiah(c.cost)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Per-component bar */}
                    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      {sv.components.filter((c) => c.cost > 0).map((c, j) => {
                        const pct = (c.cost / sv.totalCost) * 100;
                        const colors = ["bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500", "bg-rose-500", "bg-cyan-500"];
                        return <div key={j} className={`${colors[j % colors.length]} transition-all`} style={{ width: `${pct}%` }} title={`${c.name}: ${rupiah(c.cost)} (${pct.toFixed(1)}%)`} />;
                      })}
                    </div>
                  </div>
                ))}
              </>
            );
          })()}
        </div>
      )}

      {/* Empty state */}
      {!loading && data.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
          Tidak ada data. Pastikan akun depa sudah terhubung dan memiliki data billing.
        </div>
      )}
    </div>
  );
}
