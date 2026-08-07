"use client";

import { useCallback, useEffect, useState } from "react";

type Account = {
  id: string;
  name: string;
  active: boolean;
  lastSyncedAt: string | null;
  serverCount: number;
  maskedKey: string;
};

type Server = {
  id: string;
  uuid: string;
  hostname: string;
  status: string;
  isActive: boolean;
  ipAddress: string | null;
  location: string | null;
  account: { id: string; name: string };
};

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [aRes, sRes] = await Promise.all([fetch("/api/accounts"), fetch("/api/servers")]);
    if (aRes.ok) setAccounts((await aRes.json()).data ?? []);
    if (sRes.ok) setServers((await sRes.json()).data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function toggleServerActive(serverId: string, current: boolean) {
    const res = await fetch(`/api/servers/${serverId}/active`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
    });
    const d = await res.json().catch(() => ({ ok: false }));
    if (d.ok) {
      setServers((prev) => prev.map((s) => s.id === serverId ? { ...s, isActive: !current } : s));
    } else {
      setMsg(d.message ?? "Gagal mengubah status server");
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/accounts/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok || !d.ok) { setMsg(d.message ?? "Gagal menyimpan"); return; }
    setEditId(null);
    setEditName("");
    setMsg("Nama akun diperbarui.");
    load();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, apiKey }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok || !d.ok) { setMsg(d.message ?? "Gagal menambah akun"); return; }
    setName("");
    setApiKey("");
    setMsg(`Akun ditambahkan, ${d.data.synced} server tersinkron.`);
    load();
  }

  async function sync(id: string) {
    setBusy(true);
    const res = await fetch(`/api/accounts/${id}/sync`, { method: "POST" });
    const d = await res.json();
    setBusy(false);
    setMsg(d.ok ? `Sync: ${d.data.synced} server` : `Gagal: ${d.message}`);
    load();
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Hapus akun "${name}" beserta data server-nya dari panel?`)) return;
    setBusy(true);
    await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    setBusy(false);
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Akun API depa</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          API key disimpan terenkripsi di server. Pilih server yang aktif untuk di-manage oleh anggota tim.
        </p>
      </div>

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Nama akun</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Depa Utama" className="mt-1 w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">API key</label>
          <input required value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="x-apikey depa" className="mt-1 w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300" />
        </div>
        <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300">
          {busy ? "…" : "Tambah & sync"}
        </button>
      </form>

      {msg && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">{msg}</p>}

      {loading ? (
        <div className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
      ) : accounts.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
          Belum ada akun. Tambahkan API key depa untuk memulai.
        </p>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => {
            const accServers = servers.filter((s) => s.account.id === a.id);
            const activeCount = accServers.filter((s) => s.isActive).length;
            const isExpanded = expanded.has(a.id);
            return (
              <div key={a.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                {/* Account header */}
                <div className="flex items-center gap-4 p-4">
                  {editId === a.id ? (
                    <form onSubmit={saveEdit} className="flex items-center gap-2">
                      <input autoFocus required value={editName} onChange={(e) => setEditName(e.target.value)} className="w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                      <button type="submit" disabled={busy} className="text-sm font-medium text-slate-700 hover:underline dark:text-slate-200">Simpan</button>
                      <button type="button" onClick={() => setEditId(null)} className="text-sm text-slate-400 hover:underline">Batal</button>
                    </form>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${a.active ? "bg-emerald-500" : "bg-slate-400"}`} />
                        <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{a.name}</span>
                        <span className="font-mono text-xs text-slate-400">{a.maskedKey}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {activeCount}/{accServers.length} server aktif · sync: {a.lastSyncedAt ? new Date(a.lastSyncedAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "—"}
                      </p>
                    </div>
                  )}
                  <div className="flex shrink-0 gap-2 text-xs">
                    <button onClick={() => toggleExpand(a.id)} className="rounded-lg px-2.5 py-1 font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
                      {isExpanded ? "▾ Sembunyikan" : `▸ Server (${accServers.length})`}
                    </button>
                    <button onClick={() => sync(a.id)} disabled={busy} className="rounded-lg px-2.5 py-1 font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">Sync</button>
                    <button onClick={() => { setEditId(a.id); setEditName(a.name); }} disabled={busy} className="rounded-lg px-2.5 py-1 font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">Edit</button>
                    <button onClick={() => remove(a.id, a.name)} disabled={busy} className="rounded-lg px-2.5 py-1 font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950">Hapus</button>
                  </div>
                </div>

                {/* Server list */}
                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                    {accServers.length === 0 ? (
                      <p className="text-xs text-slate-400">Tidak ada server. Klik Sync untuk mengambil dari depa.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {accServers.map((s) => {
                          const on = s.status.toLowerCase() === "running";
                          const off = s.status.toLowerCase() === "stopped";
                          return (
                            <div key={s.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <button
                                onClick={() => toggleServerActive(s.id, s.isActive)}
                                title={s.isActive ? "Nonaktifkan server ini" : "Aktifkan server ini"}
                                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${s.isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`}
                              >
                                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${s.isActive ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
                              </button>
                              <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : off ? "bg-slate-400" : "bg-amber-500 animate-pulse"}`} />
                              <span className={`min-w-0 flex-1 truncate font-medium ${s.isActive ? "text-slate-800 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}>{s.hostname}</span>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${on ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : off ? "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700" : "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:ring-amber-900"}`}>
                                {s.status}
                              </span>
                              {s.ipAddress && <span className="shrink-0 font-mono text-xs text-slate-400">{s.ipAddress}</span>}
                              {s.location && <span className="shrink-0 text-xs text-slate-400">{s.location}</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
