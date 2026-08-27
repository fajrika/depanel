"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Project = {
  id: string;
  name: string;
  description: string | null;
  widthM: number;
  heightM: number;
  scalePxPerM: number;
  updatedAt: string;
  createdAt: string;
  _count: { accessPoints: number; walls: number };
};

type Form = {
  name: string;
  description: string;
  widthM: number;
  heightM: number;
  scalePxPerM: number;
};

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const btnPrimary =
  "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

export default function WifiProjectsPage() {
  const { t } = useLang();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({ name: "", description: "", widthM: 20, heightM: 15, scalePxPerM: 20 });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wifi/projects");
      const d = await res.json();
      if (d.ok) setProjects(d.data ?? []);
      else setMsg({ text: d.message ?? t("wif.listErr"), ok: false });
    } catch {
      setMsg({ text: t("wif.listErr"), ok: false });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  function set<K extends keyof Form>(key: K, v: Form[K]) {
    setForm((f) => ({ ...f, [key]: v }));
  }

  async function save() {
    if (!form.name.trim()) {
      setMsg({ text: t("wif.nameRequired"), ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    const isEdit = modal === "edit";
    const res = await fetch(isEdit ? `/api/wifi/projects/${editId}` : "/api/wifi/projects", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || d.ok === false) {
      setMsg({ text: d.message ?? t("wif.saveErr"), ok: false });
      return;
    }
    setModal(null);
    setMsg({ text: t("wif.saved"), ok: true });
    load();
  }

  async function remove() {
    if (!delId) return;
    setBusy(true);
    const res = await fetch(`/api/wifi/projects/${delId}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    setDelId(null);
    if (!res.ok || d.ok === false) {
      setMsg({ text: d.message ?? t("wif.deleteErr"), ok: false });
      return;
    }
    setMsg({ text: t("wif.deleted"), ok: true });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{t("wif.title")}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("wif.subtitle")}</p>
        </div>
        <button
          onClick={() => {
            setForm({ name: "", description: "", widthM: 20, heightM: 15, scalePxPerM: 20 });
            setModal("create");
          }}
          className={btnPrimary}
        >
          + {t("wif.create")}
        </button>
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
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          {t("wif.loading")}
        </div>
      ) : projects.length === 0 ? (
        <div className={`${card} py-14 text-center`}>
          <p className="text-4xl">📶</p>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t("wif.empty")}</p>
          <button
            onClick={() => {
              setForm({ name: "", description: "", widthM: 20, heightM: 15, scalePxPerM: 20 });
              setModal("create");
            }}
            className={`${btnPrimary} mt-4`}
          >
            + {t("wif.create")}
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div key={p.id} className={`${card} flex flex-col`}>
              <Link href={`/wifi/projects/${p.id}`} className="group block">
                <div className="flex h-28 items-center justify-center rounded-xl bg-slate-100 text-4xl transition group-hover:bg-slate-200 dark:bg-slate-800 dark:group-hover:bg-slate-700">
                  📐
                </div>
                <h3 className="mt-3 truncate font-semibold text-slate-900 group-hover:text-indigo-600 dark:text-slate-100">
                  {p.name}
                </h3>
                {p.description && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{p.description}</p>
                )}
              </Link>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {p.widthM}×{p.heightM} m
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  📶 {p._count.accessPoints}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  🧱 {p._count.walls}
                </span>
              </div>
              <div className="mt-auto flex items-center gap-2 pt-3 text-xs">
                <Link href={`/wifi/projects/${p.id}`} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white transition hover:bg-indigo-500">
                  {t("wif.open")}
                </Link>
                <button
                  onClick={() => {
                    setEditId(p.id);
                    setForm({ name: p.name, description: p.description ?? "", widthM: p.widthM, heightM: p.heightM, scalePxPerM: p.scalePxPerM });
                    setModal("edit");
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {t("wif.edit")}
                </button>
                <button
                  onClick={() => setDelId(p.id)}
                  className="ml-auto rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/50"
                >
                  {t("wif.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* modal buat/edit */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className={`${card} w-full max-w-md`}>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {modal === "create" ? t("wif.createTitle") : t("wif.editTitle")}
            </h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{t("wif.fieldName")}</label>
                <input value={form.name} onChange={(e) => set("name", e.target.value)} className={`${input} w-full`} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{t("wif.fieldDesc")}</label>
                <input value={form.description} onChange={(e) => set("description", e.target.value)} className={`${input} w-full`} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{t("wif.fieldWidth")}</label>
                  <input type="number" min={1} max={200} value={form.widthM} onChange={(e) => set("widthM", Number(e.target.value))} className={`${input} w-full`} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{t("wif.fieldHeight")}</label>
                  <input type="number" min={1} max={200} value={form.heightM} onChange={(e) => set("heightM", Number(e.target.value))} className={`${input} w-full`} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{t("wif.fieldScale")}</label>
                  <input type="number" min={5} max={100} value={form.scalePxPerM} onChange={(e) => set("scalePxPerM", Number(e.target.value))} className={`${input} w-full`} />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">{t("wif.scaleHint")}</p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                {t("wif.cancel")}
              </button>
              <button onClick={save} disabled={busy} className={btnPrimary}>
                {busy ? t("wif.processing") : t("wif.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* konfirmasi hapus */}
      {delId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className={`${card} w-full max-w-sm`}>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t("wif.deleteTitle")}</h3>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t("wif.deleteConfirm")}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDelId(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                {t("wif.cancel")}
              </button>
              <button onClick={remove} disabled={busy} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-60">
                {busy ? t("wif.processing") : t("wif.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
