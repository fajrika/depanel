"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";

const KINDS = ["servers", "sshConns", "sshCmdJobs", "dbJobs", "dirCloneJobs", "healthChecks", "sshHealthChecks"] as const;
type Kind = (typeof KINDS)[number];
type Items = Record<Kind, string[]>;
type Opt = { id: string; label: string; sub?: string | null; status?: string | null; group?: string | null };
type Options = Record<Kind, Opt[]>;

type Report = {
  id: string;
  name: string;
  description: string | null;
  rangeDays: number;
  timezone: string;
  items: Items;
  itemCount: number;
  updatedAt: string;
};

type State = "up" | "down" | "partial" | "none";
type Cell = string | number | null | undefined;
type Block =
  | { type: "heading"; text: string; level?: 1 | 2 | 3 }
  | { type: "text"; text: string; muted?: boolean; bold?: boolean }
  | { type: "kv"; rows: [string, Cell][] }
  | { type: "table"; columns: { label: string; width?: number; align?: "left" | "right" | "center" }[]; rows: Cell[][]; rowStates?: (State | null | undefined)[] }
  | { type: "statusStrip"; items: { label?: string; state: State }[]; caption?: string }
  | { type: "code"; text: string; maxLines?: number }
  | { type: "spacer"; size?: number }
  | { type: "pageBreak" };
type Spec = { title: string; subtitle?: string; generatedAt?: string; blocks: Block[]; from: string; to: string };

const KIND_ICON: Record<Kind, string> = {
  servers: "🖥️",
  sshConns: "🔐",
  sshCmdJobs: "⌨️",
  dbJobs: "💾",
  dirCloneJobs: "📦",
  healthChecks: "🩺",
  sshHealthChecks: "🧪",
};

const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const label = "block text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btnPrimary =
  "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";
const btnGhost =
  "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";

const emptyItems = (): Items => ({ servers: [], sshConns: [], sshCmdJobs: [], dbJobs: [], dirCloneJobs: [], healthChecks: [], sshHealthChecks: [] });

/** YYYY-MM-DD di zona Asia/Jakarta. */
function ymd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const STATE_BG: Record<State, string> = {
  up: "bg-emerald-500",
  down: "bg-red-500",
  partial: "bg-amber-400",
  none: "bg-slate-200 dark:bg-slate-700",
};

/* ---------- preview: render ReportBlock[] sebagai HTML ---------- */
function BlockView({ b }: { b: Block }) {
  switch (b.type) {
    case "heading": {
      const lv = b.level ?? 2;
      if (lv === 1) return <h2 className="mt-6 border-b border-slate-200 pb-1 text-lg font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100">{b.text}</h2>;
      if (lv === 2) return <h3 className="mt-4 text-base font-semibold text-slate-800 dark:text-slate-100">{b.text}</h3>;
      return <h4 className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-200">{b.text}</h4>;
    }
    case "text":
      return <p className={`whitespace-pre-wrap text-sm ${b.muted ? "text-slate-400" : "text-slate-700 dark:text-slate-300"} ${b.bold ? "font-semibold" : ""}`}>{b.text}</p>;
    case "kv":
      return (
        <dl className="grid grid-cols-[minmax(110px,max-content)_1fr] gap-x-4 gap-y-1 text-sm">
          {b.rows.map(([k, v], i) => (
            <div key={i} className="contents">
              <dt className="font-medium text-slate-500 dark:text-slate-400">{k}</dt>
              <dd className="break-words text-slate-800 dark:text-slate-200">{v ?? "-"}</dd>
            </div>
          ))}
        </dl>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                {b.columns.map((c, i) => (
                  <th key={i} className={`px-2 py-1.5 font-medium ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {b.rows.map((r, i) => {
                const st = b.rowStates?.[i];
                return (
                  <tr key={i} className={st === "down" ? "bg-red-50 dark:bg-red-950/30" : st === "partial" ? "bg-amber-50 dark:bg-amber-950/30" : ""}>
                    {r.map((c, j) => (
                      <td key={j} className={`px-2 py-1 align-top text-slate-700 dark:text-slate-300 ${b.columns[j]?.align === "right" ? "text-right" : ""}`}>
                        {c ?? "-"}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    case "statusStrip":
      return (
        <div>
          <div className="flex flex-wrap gap-0.5">
            {b.items.map((it, i) => (
              <span key={i} title={it.label} className={`h-5 w-2.5 rounded-sm ${STATE_BG[it.state]}`} />
            ))}
          </div>
          {b.caption && <p className="mt-1 text-[11px] text-slate-400">{b.caption}</p>}
        </div>
      );
    case "code":
      return (
        <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {b.maxLines ? b.text.split("\n").slice(0, b.maxLines).join("\n") : b.text}
        </pre>
      );
    case "spacer":
      return <div className="h-2" />;
    case "pageBreak":
      return <hr className="my-4 border-dashed border-slate-200 dark:border-slate-700" />;
  }
}

/* ---------- pemilih item per kategori ---------- */
function KindPicker({
  kind,
  options,
  selected,
  onChange,
}: {
  kind: Kind;
  options: Opt[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(selected.length > 0);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => `${o.label} ${o.sub ?? ""} ${o.group ?? ""}`.toLowerCase().includes(s));
  }, [options, q]);
  const sel = new Set(selected);

  function toggle(id: string) {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // pertahankan urutan sesuai daftar pilihan
    onChange(options.map((o) => o.id).filter((x) => next.has(x)));
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <span className={`text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`}>▾</span>
        <span>{KIND_ICON[kind]}</span>
        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{t(`lap.kind.${kind}`)}</span>
        <span className="ml-auto text-[11px] text-slate-400">
          {selected.length > 0 ? `${selected.length} ${t("lap.selected")} / ` : ""}
          {options.length}
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-3 py-2 dark:border-slate-800">
          {options.length === 0 ? (
            <p className="py-1 text-xs text-slate-400">{t("lap.noOptions")}</p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {options.length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("lap.search")} className={`${input} !py-1 w-48 text-xs`} />}
                <button type="button" onClick={() => onChange([...new Set([...selected, ...shown.map((o) => o.id)])])} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                  {t("lap.all")}
                </button>
                <button type="button" onClick={() => onChange([])} className="text-xs text-slate-400 hover:underline">
                  {t("lap.none")}
                </button>
              </div>
              <div className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
                {shown.map((o) => (
                  <label key={o.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-800 dark:text-slate-200">{o.label}</span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {[o.group, o.sub, o.status].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function LaporanPage() {
  const { t } = useLang();
  const [reports, setReports] = useState<Report[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // form
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fName, setFName] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fRange, setFRange] = useState(7);
  const [fItems, setFItems] = useState<Items>(emptyItems());
  const [busy, setBusy] = useState(false);

  // preview
  const [viewId, setViewId] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [spec, setSpec] = useState<Spec | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [today] = useState(() => ymd(new Date()));

  const load = useCallback(async () => {
    try {
      const [rRes, oRes] = await Promise.all([fetch("/api/reports/custom"), fetch("/api/reports/custom/options")]);
      if (rRes.ok) setReports((await rRes.json()).data ?? []);
      if (oRes.ok) setOptions((await oRes.json()).data ?? null);
    } catch {
      /* biarkan data lama */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditId(null);
    setFName("");
    setFDesc("");
    setFRange(7);
    setFItems(emptyItems());
    setShowForm(true);
    setViewId(null);
  }

  function openEdit(r: Report) {
    setEditId(r.id);
    setFName(r.name);
    setFDesc(r.description ?? "");
    setFRange(r.rangeDays);
    setFItems({ ...emptyItems(), ...r.items });
    setShowForm(true);
    setViewId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (KINDS.every((k) => fItems[k].length === 0)) {
      setMsg({ text: t("lap.needItem"), ok: false });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(editId ? `/api/reports/custom/${editId}` : "/api/reports/custom", {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fName, description: fDesc, rangeDays: fRange, items: fItems }),
      });
      const d = await res.json();
      if (!d.ok) {
        setMsg({ text: d.message ?? "Error", ok: false });
        return;
      }
      setMsg({ text: t("lap.saved"), ok: true });
      setShowForm(false);
      const id = editId ?? d.data?.id;
      await load();
      if (id) openView(id, fRange);
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: Report) {
    if (!confirm(t("lap.confirmDelete"))) return;
    const res = await fetch(`/api/reports/custom/${r.id}`, { method: "DELETE" });
    const d = await res.json();
    setMsg({ text: d.ok ? t("lap.deleted") : (d.message ?? "Error"), ok: !!d.ok });
    if (viewId === r.id) setViewId(null);
    load();
  }

  const fetchPreview = useCallback(async (id: string, f: string, tt: string) => {
    setSpecLoading(true);
    setSpec(null);
    try {
      const res = await fetch(`/api/reports/custom/${id}/preview?from=${f}&to=${tt}`);
      const d = await res.json();
      if (d.ok) setSpec(d.data);
      else setMsg({ text: d.message ?? "Error", ok: false });
    } catch {
      setMsg({ text: "Gagal memuat laporan", ok: false });
    } finally {
      setSpecLoading(false);
    }
  }, []);

  function openView(id: string, rangeDays: number) {
    const now = new Date();
    const f = ymd(new Date(now.getTime() - rangeDays * 86400000));
    const tt = ymd(now);
    setFrom(f);
    setTo(tt);
    setViewId(id);
    setShowForm(false);
    fetchPreview(id, f, tt);
  }

  const viewing = reports.find((r) => r.id === viewId) ?? null;
  const pdfHref = viewId ? `/api/reports/custom/${viewId}/pdf?from=${from}&to=${to}` : "#";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">📑 {t("lap.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{t("lap.subtitle")}</p>
        </div>
        {!showForm && (
          <button onClick={openCreate} className={btnPrimary}>
            {t("lap.add")}
          </button>
        )}
      </div>

      {msg && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
            msg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
          }`}
        >
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className={`${card} animate-fade-up space-y-5 p-5`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editId ? t("lap.editTitle") : t("lap.createTitle")}</h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
              ✕
            </button>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="min-w-0 flex-1 basis-56">
              <label className={label}>{t("lap.name")}</label>
              <input required maxLength={120} value={fName} onChange={(e) => setFName(e.target.value)} placeholder={t("lap.namePh")} className={`${input} mt-1 w-full`} />
            </div>
            <div>
              <label className={label}>{t("lap.range")}</label>
              <select value={fRange} onChange={(e) => setFRange(Number(e.target.value))} className={`${input} mt-1`}>
                {[1, 7, 14, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} {t("lap.days")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={label}>{t("lap.desc")}</label>
            <input maxLength={1000} value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder={t("lap.descPh")} className={`${input} mt-1 w-full`} />
          </div>
          <div>
            <label className={label}>{t("lap.items")}</label>
            <p className="mb-2 mt-0.5 text-[11px] text-slate-400">{t("lap.itemsHint")}</p>
            {!options ? (
              <div className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
            ) : (
              <div className="space-y-2">
                {KINDS.filter((k) => options[k].length > 0 || fItems[k].length > 0).map((k) => (
                  <KindPicker key={k} kind={k} options={options[k]} selected={fItems[k]} onChange={(ids) => setFItems((p) => ({ ...p, [k]: ids }))} />
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className={btnGhost}>
              {t("lap.cancel")}
            </button>
            <button disabled={busy} className={btnPrimary}>
              {busy ? t("lap.saving") : t("lap.save")}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
      ) : reports.length === 0 && !showForm ? (
        <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">{t("lap.empty")}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {reports.map((r) => (
            <div key={r.id} className={`${card} flex flex-col gap-3 p-4 ${viewId === r.id ? "ring-2 ring-indigo-400" : ""}`}>
              <div>
                <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{r.name}</h3>
                {r.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{r.description}</p>}
              </div>
              <div className="flex flex-wrap gap-1">
                {KINDS.filter((k) => r.items[k]?.length).map((k) => (
                  <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {KIND_ICON[k]} {t(`lap.kind.${k}`)} · {r.items[k].length}
                  </span>
                ))}
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-2">
                <button onClick={() => openView(r.id, r.rangeDays)} className={btnGhost}>
                  👁 {t("lap.view")}
                </button>
                <a
                  href={`/api/reports/custom/${r.id}/pdf`}
                  className={btnGhost}
                >
                  📄 {t("lap.pdf")}
                </a>
                <button onClick={() => openEdit(r)} className={btnGhost}>
                  {t("lap.edit")}
                </button>
                <button onClick={() => remove(r)} className="ml-auto text-xs text-red-500 hover:underline">
                  {t("lap.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <section className={`${card} animate-fade-up p-5`}>
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">{viewing.name}</h2>
              {spec?.subtitle && <p className="text-xs text-slate-400">{spec.subtitle}</p>}
            </div>
            <div>
              <label className={label}>{t("lap.from")}</label>
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={`${input} mt-1 !py-1.5`} />
            </div>
            <div>
              <label className={label}>{t("lap.to")}</label>
              <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={`${input} mt-1 !py-1.5`} />
            </div>
            <button onClick={() => fetchPreview(viewing.id, from, to)} disabled={specLoading} className={btnGhost}>
              {t("lap.show")}
            </button>
            <a href={pdfHref} className={btnPrimary}>
              📄 {t("lap.pdf")}
            </a>
            <button onClick={() => setViewId(null)} className="text-xs text-slate-400 hover:text-slate-600">
              {t("lap.close")}
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {specLoading && <p className="animate-pulse text-sm text-slate-400">{t("lap.loading")}</p>}
            {spec && spec.blocks.map((b, i) => <BlockView key={i} b={b} />)}
          </div>
        </section>
      )}
    </div>
  );
}
