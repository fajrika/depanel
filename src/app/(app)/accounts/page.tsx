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

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/accounts");
    if (res.ok) setAccounts((await res.json()).data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
    if (!res.ok || !d.ok) {
      setMsg(d.message ?? "Gagal menambah akun");
      return;
    }
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
    <div>
      <h1 className="text-xl font-semibold">Akun API depa</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">API key disimpan terenkripsi di server, tidak pernah dikirim ke browser.</p>

      <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div>
          <label className="block text-sm font-medium">Nama akun</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="mis. Depa Utama"
            className="mt-1 w-52 rounded-md border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">API key</label>
          <input
            required
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="x-apikey depa"
            className="mt-1 w-72 rounded-md border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? "…" : "Tambah & sync"}
        </button>
      </form>

      {msg && <p className="mt-3 rounded-md bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm">{msg}</p>}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {loading ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Memuat…</p>
        ) : accounts.length === 0 ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Belum ada akun.</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Nama</th>
                <th className="px-4 py-2 font-medium">API key</th>
                <th className="px-4 py-2 font-medium">Server</th>
                <th className="px-4 py-2 font-medium">Sync terakhir</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 font-medium">{a.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{a.maskedKey}</td>
                  <td className="px-4 py-2">{a.serverCount}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                    {a.lastSyncedAt ? new Date(a.lastSyncedAt).toLocaleString("id-ID") : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => sync(a.id)} disabled={busy} className="mr-2 text-slate-700 dark:text-slate-200 hover:underline">
                      Sync
                    </button>
                    <button onClick={() => remove(a.id, a.name)} disabled={busy} className="text-red-600 hover:underline">
                      Hapus
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
