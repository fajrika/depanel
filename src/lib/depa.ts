// Thin typed client for the depa cloud API V2 (https://api.depa.id/api).
// Auth: header `x-apikey`. Responses: { message, data } (+ `page` for paginated lists).
//
// Catatan V2: endpoint berikut TIDAK tersedia untuk API key (HTTP 403 "not available
// with an API token"): /customer/tiers, /customer/tiers/{id}/pricing, /systems,
// /customer/vm/size-template, /customer/setting/firewall-rule-types, /storage/block*,
// /key_management/ssh_keys*. Klien tetap memanggil path V2 yang benar; pemanggil
// menangani error-nya. Pengganti yang berfungsi dengan API key: /customer/os-templates
// (daftar OS) dan /vm/size-template (template ukuran).

const BASE = process.env.DEPA_API_BASE || "https://api.depa.id/api";

export class DepaError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DepaError";
    this.status = status;
  }
}

export interface DepaInstance {
  uuid: string;
  hostname: string;
  status: string; // running | stopped | ...
  location?: string;
  tier?: string;
  ip?: string;
  cpu?: number;
  memoryMb?: number;
  storageGb?: number;
  raw: Record<string, unknown>;
}

function pick<T = unknown>(obj: Record<string, unknown>, keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
  }
  return undefined;
}

/**
 * Map depa's raw status vocabulary to a canonical "running" | "stopped" | <other>.
 * The reconciler compares against these canonical values, so this keeps it robust
 * regardless of whether depa says active/on/poweron vs shutoff/halted/off.
 */
export function canonicalStatus(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (["running", "active", "on", "poweron", "power_on", "started", "up"].includes(s)) return "running";
  if (["stopped", "shutoff", "shut_off", "off", "poweroff", "power_off", "halted", "down", "inactive"].includes(s))
    return "stopped";
  return s;
}

/**
 * Parse a size value that depa may return as a bare number (assumed already in
 * `targetUnit`) or as a labeled string like "4 GB" / "20GB" / "512 MB", and
 * convert it to `targetUnit` (MB or GB). Returns undefined if unparseable.
 */
function parseSize(value: unknown, targetUnit: "MB" | "GB"): number | undefined {
  if (typeof value === "number") return Math.round(value);
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^([\d.]+)\s*(TB|GB|MB|KB)?$/i);
  if (!match) return undefined;
  const num = parseFloat(match[1]);
  if (Number.isNaN(num)) return undefined;
  const unit = (match[2] ?? targetUnit).toUpperCase();
  const toMb: Record<string, number> = { KB: 1 / 1024, MB: 1, GB: 1024, TB: 1024 * 1024 };
  const mb = num * (toMb[unit] ?? 1);
  return Math.round(targetUnit === "MB" ? mb : mb / 1024);
}

/** V2 mengirim objek bersarang (location, public_network) — ambil teksnya saja. */
function textOf(v: unknown, keys: string[]): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of keys) if (typeof o[k] === "string" && o[k]) return o[k] as string;
  }
  return undefined;
}

/**
 * Normalize a raw depa instance object into our shape (defensive against field naming).
 * V2: memory/storage berupa angka dalam GB, location & public_network berupa objek.
 */
export function normalizeInstance(raw: Record<string, unknown>): DepaInstance {
  const uuid = String(pick(raw, ["uuid", "id", "instance_uuid"]) ?? "");
  const hostname = String(pick(raw, ["hostname", "name", "label"]) ?? uuid);
  const status = canonicalStatus(String(pick(raw, ["status", "state", "power_state"]) ?? "unknown"));
  const memMb = pick(raw, ["memory_mb"]);
  const memGb = pick(raw, ["memory", "ram"]);
  return {
    uuid,
    hostname,
    status,
    location: textOf(pick(raw, ["location", "location_name", "region"]), ["name", "alias"]),
    tier: textOf(pick(raw, ["tier", "tier_name", "plan"]), ["name"]),
    ip:
      textOf(pick(raw, ["public_network"]), ["ipv4_address", "ip_address"]) ??
      textOf(pick(raw, ["ip", "public_ip", "ip_address", "ipv4"]), ["ip_address", "ipv4_address"]),
    cpu: parseSize(pick(raw, ["cpu", "vcpu", "cores"]), "MB"),
    memoryMb:
      memMb !== undefined
        ? parseSize(memMb, "MB")
        : typeof memGb === "number"
          ? Math.round(memGb * 1024) // V2: angka polos = GB
          : parseSize(memGb, "MB"),
    storageGb: parseSize(pick(raw, ["storage", "storage_gb", "disk"]), "GB"),
    raw,
  };
}

/** Detail V2 → tambahkan kunci tampilan yang dipakai UI (os_name, public_ip, dst.). */
export function normalizeDetail(raw: Record<string, unknown>): Record<string, unknown> {
  const withUnit = (v: unknown, unit: string) => (typeof v === "number" ? `${v} ${unit}` : v);
  return {
    ...raw,
    os_name: textOf(raw.template, ["name"]) ?? raw.os_name,
    cpu: withUnit(raw.cpu, "vCPU"),
    memory: withUnit(raw.memory, "GB"),
    storage: withUnit(raw.storage, "GB"),
    location: textOf(raw.location, ["name"]),
    tier: textOf(raw.tier, ["name"]),
    public_ip:
      raw.public_ip ??
      (textOf(raw.public_network, ["ipv4_address"]) ? { ip_address: textOf(raw.public_network, ["ipv4_address"]) } : undefined),
    estimated_monthly_price: raw.estimated_monthly_price ?? raw.estimated_monthly_cost,
    is_cpu_dedicated: typeof raw.is_cpu_shared === "boolean" ? !raw.is_cpu_shared : raw.is_cpu_dedicated,
  };
}

type Row = Record<string, unknown>;

/**
 * RRD V2 (Proxmox) → satuan tampilan yang konsisten.
 * Mentah dari depa: `cpu` pecahan 0–1, `raw_*_memory` byte, `raw_net*`/`raw_disk*` byte per detik.
 * Hasil: cpu persen (0–100), memory GB, network & disk byte/detik.
 */
export type RrdNorm = {
  cpu: { time: string; cpu: number }[];
  memory: { time: string; usedGb: number; maxGb: number }[];
  network: { time: string; inBps: number; outBps: number }[];
  disk: { time: string; readBps: number; writeBps: number }[];
};
export function normalizeRrd(raw: unknown): RrdNorm {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as Record<string, unknown>[]) : []);
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v)) || 0;
  const GB = 1024 ** 3;
  const cpuRaw = arr("cpu");
  // Proxmox selalu pecahan; bila suatu saat depa sudah kirim persen (>1.5), jangan dikali lagi.
  const pecahan = cpuRaw.every((p) => num(p.cpu) <= 1.5);
  return {
    cpu: cpuRaw.map((p) => ({ time: String(p.time), cpu: Math.min(100, num(p.cpu) * (pecahan ? 100 : 1)) })),
    memory: arr("memory").map((p) => ({ time: String(p.time), usedGb: num(p.raw_usage_memory) / GB, maxGb: num(p.raw_max_memory) / GB })),
    network: arr("network").map((p) => ({ time: String(p.time), inBps: num(p.raw_netin), outBps: num(p.raw_netout) })),
    disk: arr("disk").map((p) => ({ time: String(p.time), readBps: num(p.raw_diskread), writeBps: num(p.raw_diskwrite) })),
  };
}

type PageMeta = { total?: number; count?: number; per_page?: number; current_page?: number; total_pages?: number };
export interface PagedRows {
  data: Row[];
  page: PageMeta;
}

/** Bentuk paginasi V2: objek `page` (tersarang) atau kolom datar di tingkat atas. */
function pageMeta(body: Row): PageMeta {
  if (body.page && typeof body.page === "object") return body.page as PageMeta;
  return {
    total: body.total as number | undefined,
    count: body.count as number | undefined,
    per_page: body.per_page as number | undefined,
    current_page: body.current_page as number | undefined,
    total_pages: (body.total_pages ?? body.last_page) as number | undefined,
  };
}
function totalPages(body: Row): number {
  const m = pageMeta(body) as Row;
  return Number(m.total_pages ?? m.last_page ?? 1) || 1;
}
/** Ambil array baris dari `data` (array, atau objek berkunci list seperti { virtual_machines: [...] }). */
function listOf(data: unknown, listKeys: string[] = []): Row[] {
  if (Array.isArray(data)) return data as Row[];
  if (data && typeof data === "object") {
    const d = data as Row;
    for (const k of [...listKeys, "data", "items"]) if (Array.isArray(d[k])) return d[k] as Row[];
  }
  return [];
}

const MAX_PAGES = 50;

export function depaClient(apiKey: string) {
  type Query = Record<string, string | number | undefined>;

  /** Panggil endpoint dan kembalikan seluruh body JSON (termasuk `page`, bila ada). */
  async function raw(path: string, init?: RequestInit & { query?: Query }): Promise<Row> {
    const url = new URL(BASE + path);
    if (init?.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        ...init,
        headers: { "x-apikey": apiKey, "Content-Type": "application/json", Accept: "application/json", ...(init?.headers || {}) },
        // avoid Next.js fetch caching for live control data
        cache: "no-store",
      });
    } catch (e) {
      throw new DepaError(`Gagal terhubung ke depa API: ${(e as Error).message}`, 0);
    }
    const text = await res.text();
    let body: Row = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { message: text };
    }
    if (!res.ok) {
      throw new DepaError(String(body.message || `HTTP ${res.status}`), res.status);
    }
    return body;
  }

  /** Seperti raw(), tetapi mengembalikan `data` saja (atau seluruh body bila tak ada `data`). */
  async function call<T = unknown>(path: string, init?: RequestInit & { query?: Query }): Promise<T> {
    const body = await raw(path, init);
    return (body.data !== undefined ? body.data : body) as T;
  }

  /** Ambil daftar berpaginasi (`page`/`limit`); `all` = ikuti semua halaman. */
  async function paged(
    path: string,
    query: Query,
    opts: { all?: boolean; page?: number; listKeys?: string[]; map?: (r: Row) => Row } = {},
  ): Promise<PagedRows> {
    const rows: Row[] = [];
    let page = opts.page ?? 1;
    let meta: PageMeta = {};
    for (let n = 0; n < (opts.all ? MAX_PAGES : 1); n++) {
      const body = await raw(path, { query: { ...query, page, limit: 100 } });
      rows.push(...listOf(body.data, opts.listKeys));
      meta = pageMeta(body);
      if (page >= totalPages(body)) break;
      page++;
    }
    return { data: opts.map ? rows.map(opts.map) : rows, page: meta };
  }

  const json = (b: unknown) => JSON.stringify(b);
  const vm = (uuid: string) => `/instances/virtual-machines/${uuid}`;

  // ---------- instances ----------
  async function listInstances(): Promise<DepaInstance[]> {
    const { data } = await paged("/instances/virtual-machines", {}, { all: true, listKeys: ["virtual_machines"] });
    return data.map(normalizeInstance).filter((i) => i.uuid);
  }
  async function getInstance(uuid: string): Promise<DepaInstance> {
    const data = await call<Row>(vm(uuid));
    const inner = (data && typeof data === "object" && (data.virtual_machine || data.instance || data.data)) || data;
    return normalizeInstance(inner as Row);
  }
  async function instanceDetail(uuid: string) {
    const data = await call<Row>(vm(uuid));
    const inner = (data && typeof data === "object" && (data.virtual_machine || data.instance || data.data)) || data;
    return normalizeDetail(inner as Row);
  }

  // ---------- locations / tiers / systems ----------
  async function locations() {
    return call<Row[]>("/locations");
  }
  /** location: id numerik, nama lokasi, atau kosong (= lokasi pertama). */
  async function resolveLocationId(location?: number | string | null): Promise<number> {
    if (typeof location === "number") return location;
    const list = listOf(await locations());
    const byName = typeof location === "string" ? list.find((l) => String(l.name).toLowerCase() === location.toLowerCase()) : undefined;
    const found = byName ?? list[0];
    if (!found) throw new DepaError("Tidak ada lokasi aktif di depa", 404);
    return Number(found.id);
  }
  async function tiers(location?: number | string | null) {
    const location_id = await resolveLocationId(location);
    return call<Row[]>("/customer/tiers", { query: { location_id } });
  }
  /** Daftar OS. /systems ditolak untuk API key, jadi memakai /customer/os-templates. */
  async function systems(location?: number | string | null): Promise<Row[]> {
    const location_id = await resolveLocationId(location);
    const list = listOf(await call<unknown>("/customer/os-templates", { query: { location_id } }));
    return list.map((o) => ({ ...o, template_id: o.id, name: o.name || o.description }));
  }

  // ---------- backups ----------
  /** Jadwal V2 { id, schedule: { type, time, day }, retention } → kunci datar yang dipakai UI. */
  function normalizeSchedule(r: Row): Row {
    const sc = (r.schedule && typeof r.schedule === "object" ? r.schedule : {}) as Row;
    return {
      ...r,
      schedule_type: String(sc.type ?? r.schedule_type ?? "").toLowerCase(),
      schedule_at: sc.time ?? r.schedule_at,
      schedule_on: sc.day ?? r.schedule_on,
    };
  }
  async function backupSchedules(uuid: string): Promise<Row[]> {
    return listOf(await call<unknown>(`${vm(uuid)}/backups/schedules`)).map(normalizeSchedule);
  }

  // ---------- billing ----------
  const inRange = (iso: unknown, start?: string, end?: string) => {
    const d = String(iso ?? "").slice(0, 10);
    return (!start || d >= start) && (!end || d <= end);
  };
  async function topupMethods(amount: number): Promise<Row[]> {
    const body = await raw("/billing/payment-methods", { query: { amount } });
    const groups = listOf(body.payment_methods ?? (body.data as Row | undefined)?.payment_methods);
    return groups.flatMap((g) =>
      listOf(g.data).map((m) => ({
        ...m,
        code: m.method_code,
        name: m.method_name,
        label: m.method_name,
        group: g.label,
      })),
    );
  }

  // ---------- firewall ----------
  /** Body aturan firewall lama (action "A"/"D", port string) → kontrak V2. */
  function firewallBody(b: Row): Row {
    const a = String(b.action ?? "").toUpperCase();
    const out: Row = {
      direction: String(b.direction ?? "IN").toUpperCase(),
      action: a === "A" ? "ACCEPT" : a === "D" ? "DROP" : a,
      use_ipset: b.use_ipset === true,
    };
    if (b.protocol) out.protocol = String(b.protocol).toLowerCase();
    if (b.destination_port !== undefined && b.destination_port !== "") {
      const n = Number(b.destination_port);
      out.destination_port = Number.isFinite(n) ? n : b.destination_port;
    }
    if (b.description) out.description = b.description;
    if (b.source_ip && !out.use_ipset) out.source_ip = b.source_ip;
    if (b.source_ipset !== undefined) out.source_ipset = b.source_ipset;
    if (b.is_enable !== undefined) out.is_enable = b.is_enable;
    return out;
  }

  return {
    /** List all instances (semua halaman, dinormalisasi). */
    listInstances,
    getInstance,

    async start(uuid: string) {
      return call(`${vm(uuid)}/start`, { method: "PATCH" });
    },
    async stop(uuid: string) {
      return call(`${vm(uuid)}/stop`, { method: "PATCH" });
    },
    async restart(uuid: string) {
      return call(`${vm(uuid)}/restart`, { method: "PATCH" });
    },

    /** Metrik RRD (sudah dinormalkan satuannya, lihat `normalizeRrd`). */
    async metrics(uuid: string, periode: string = "day") {
      return normalizeRrd(await call<Row>(`${vm(uuid)}/rrd`, { query: { periode } }));
    },

    /** Detail instance dari depa (price, cost, os, ips, timestamps, ...), kunci tampilan dilengkapi. */
    instanceDetail,

    // ---- snapshots ----
    async snapshots(uuid: string) {
      return call<Row[]>(`${vm(uuid)}/snapshots`);
    },
    async snapshotCreate(uuid: string, body: { name: string; description: string }) {
      return call(`${vm(uuid)}/snapshots`, { method: "POST", body: json(body) });
    },
    async snapshotRollback(uuid: string, snapshotUuid: string) {
      return call(`${vm(uuid)}/snapshots/${snapshotUuid}/rollback`, { method: "PATCH" });
    },
    async snapshotDelete(uuid: string, snapshotUuid: string) {
      return call(`${vm(uuid)}/snapshots/${snapshotUuid}`, { method: "DELETE" });
    },

    // ---- backups (depa's own backup schedules + archives) ----
    async backupHistory(uuid: string) {
      return call<Row>(`${vm(uuid)}/backups/histories`);
    },
    backupSchedules,
    async backupScheduleCreate(
      uuid: string,
      body: { retention: number; schedule_type: string; schedule_at: number; schedule_on?: number },
    ) {
      const schedule = body.schedule_type.toUpperCase();
      const req: Row = { schedule, time: body.schedule_at, retention_limit: body.retention };
      // V2: hari 1-7 (mingguan) / 1-28 (bulanan); UI lama memakai 0 = Minggu
      if (schedule === "WEEKLY") req.day = body.schedule_on ? body.schedule_on : body.schedule_on === 0 ? 7 : 1;
      else if (schedule === "MONTHLY") req.day = body.schedule_on || 1;
      return call(`${vm(uuid)}/backups/schedules`, { method: "POST", body: json(req) });
    },
    /** PUT V2 mewajibkan schedule_at & retention; bila kosong, diisi dari jadwal yang ada. */
    async backupScheduleUpdate(
      uuid: string,
      scheduleId: string,
      body: { retention?: number; schedule_at?: number; schedule_on?: number },
    ) {
      let { retention, schedule_at } = body;
      if (retention === undefined || schedule_at === undefined) {
        const cur = (await backupSchedules(uuid)).find((s) => String(s.id) === scheduleId);
        if (!cur) throw new DepaError("Jadwal backup tidak ditemukan", 404);
        retention ??= Number(cur.retention);
        schedule_at ??= Number(cur.schedule_at);
      }
      const req: Row = { retention, schedule_at };
      if (body.schedule_on !== undefined) req.schedule_on = body.schedule_on === 0 ? 7 : body.schedule_on;
      return call(`${vm(uuid)}/backups/schedules/${scheduleId}`, { method: "PUT", body: json(req) });
    },
    async backupScheduleDelete(uuid: string, scheduleId: string) {
      return call(`${vm(uuid)}/backups/schedules/${scheduleId}`, { method: "DELETE" });
    },
    /** Restore menimpa instance ini (mode "replace"), setara restore lama. */
    async backupRestore(uuid: string, historyId: string) {
      return call(`${vm(uuid)}/backups/histories/${historyId}/restore`, { method: "PATCH", body: json({ mode: "replace" }) });
    },
    async backupDelete(uuid: string, historyId: string) {
      return call(`${vm(uuid)}/backups/histories/${historyId}`, { method: "DELETE" });
    },

    // ---- billing ----
    async billingSummary() {
      return call("/billing/summary");
    },
    /** Riwayat kredit: baris { id, type "A"|"D", description, amount, balance_after, created_at }. */
    async creditHistory(opts: { page?: number; all?: boolean; start?: string; end?: string; type?: string } = {}) {
      return paged("/billing/credit", { start_date: opts.start, end_date: opts.end, type: opts.type }, opts);
    },
    /** Riwayat deposit; baris dilengkapi invoice_number, method & detail { amount, vat, payment_fee }. */
    async depositHistory(opts: { page?: number; all?: boolean; start?: string; end?: string } = {}) {
      const res = await paged("/billing/deposit", {}, opts);
      res.data = res.data
        .filter((d) => inRange(d.created_at, opts.start, opts.end)) // V2 tak punya filter tanggal untuk deposit
        .map((d) => ({
          ...d,
          invoice_number: d.reference_number ?? d.id,
          method: d.payment_method,
          detail: { amount: d.amount, vat: d.tax, payment_fee: d.payment_fee },
        }));
      return res;
    },
    /** Laporan billing; `id` = uuid laporan. */
    async billingReports(opts: { page?: number; all?: boolean } = {}) {
      return paged("/billing/reports", {}, { ...opts, map: (r) => ({ ...r, id: r.uuid }) });
    },
    async reportDetail(reportUuid: string) {
      return call<Row>(`/billing/reports/${reportUuid}/details`);
    },

    // ---- top-up (creates a payment invoice; the user pays manually) ----
    /** Daftar metode dalam satu array datar: { code, name, gateway_name, fee, vat, ... }. */
    topupMethods,
    /**
     * Membuat invoice top-up (tidak memotong saldo). V2 butuh method_code + gateway_name,
     * jadi gateway dicari dari daftar metode untuk nominal yang sama. phone_number tidak
     * dikenal V2 dan diabaikan.
     */
    async topupCreate(body: { amount: number; payment_method: string; phone_number?: string; code?: string }) {
      const method = (await topupMethods(body.amount)).find((m) => m.code === body.payment_method);
      if (!method) throw new DepaError(`Metode pembayaran "${body.payment_method}" tidak tersedia untuk nominal ini`, 400);
      const req: Row = { amount: body.amount, method_code: method.code, gateway_name: method.gateway_name };
      if (body.code) req.coupon_code = body.code;
      return call<Row>("/billing/topup", { method: "POST", body: json(req) });
    },
    async topupStatus(invoiceId: string) {
      return call<Row>(`/billing/deposit/${invoiceId}`);
    },

    // ---- resize / tier ----
    async resize(uuid: string, body: { cpu: number; memory: number; storage: number; use_dedicated_cpu?: boolean }) {
      const req = { cpu: body.cpu, memory: body.memory, storage: body.storage, is_cpu_shared: !body.use_dedicated_cpu };
      return call(`${vm(uuid)}/resize`, { method: "PATCH", body: json(req) });
    },
    async changeTier(uuid: string, tierId: number) {
      return call(`${vm(uuid)}/tier`, { method: "PATCH", body: json({ tier_id: tierId }) });
    },
    async changeTierPrice(tierId: number) {
      return call<Row>(`/customer/tiers/${tierId}/pricing`);
    },
    tiers,

    // ---- reinstall ----
    async reinstall(uuid: string, body: { template_id: number; username: string; password: string }) {
      return call(`${vm(uuid)}/reinstall`, { method: "POST", body: json(body) });
    },
    systems,
    async updateHostname(uuid: string, hostname: string) {
      return call(`${vm(uuid)}/hostname`, { method: "PATCH", body: json({ hostname }) });
    },

    // ---- create / delete instance ----
    locations,
    /** Template ukuran. Versi /customer/ ditolak untuk API key; /vm/size-template publik. */
    async sizeTemplate() {
      return call<Row[]>("/vm/size-template");
    },
    /**
     * Buat instance. Kontrak V2 mewajibkan: hostname, tier_id, template_id, location_id,
     * cpu, memory, storage, is_cpu_shared, include_backup, use_public_ip, public_network,
     * vswitch, ssh_keys, username, password. `use_dedicated_cpu` dipetakan ke is_cpu_shared.
     */
    async instanceCreate(body: Row) {
      const { use_dedicated_cpu, ...rest } = body;
      const req: Row = { ...rest };
      if (typeof use_dedicated_cpu === "boolean" && req.is_cpu_shared === undefined) req.is_cpu_shared = !use_dedicated_cpu;
      return call("/instances/virtual-machines", { method: "POST", body: json(req) });
    },
    async instanceDelete(uuid: string, body: { remove_ip?: boolean; remove_block_storage?: boolean } = {}) {
      return call(vm(uuid), {
        method: "DELETE",
        body: json({ remove_ip: body.remove_ip ?? false, remove_block_storage: body.remove_block_storage ?? false }),
      });
    },

    // ---- console ----
    async console(uuid: string) {
      return call<Row>(`${vm(uuid)}/console-websocket`, { method: "POST" });
    },

    // ---- firewall ----
    async firewallRules(uuid: string) {
      return call<Row[]>(`${vm(uuid)}/firewall/rules`);
    },
    async firewallRuleTypes() {
      return call<Row>("/customer/setting/firewall-rule-types");
    },
    /** Pengganti "firewall default" lama: opsi firewall { enable, inbound, outbound }. */
    async firewallOptions(uuid: string) {
      return call<Row>(`${vm(uuid)}/firewall/options`);
    },
    async firewallOptionsUpdate(uuid: string, body: { enable?: boolean; inbound?: string; outbound?: string }) {
      return call(`${vm(uuid)}/firewall/options`, { method: "PUT", body: json(body) });
    },
    async firewallCreate(uuid: string, body: Row) {
      return call(`${vm(uuid)}/firewall/rules`, { method: "POST", body: json(firewallBody(body)) });
    },
    async firewallUpdate(uuid: string, ruleId: string, body: Row) {
      return call(`${vm(uuid)}/firewall/rules/${ruleId}`, { method: "PUT", body: json(firewallBody(body)) });
    },
    async firewallUpdateStatus(uuid: string, ruleId: string, body: { is_enable: boolean }) {
      return call(`${vm(uuid)}/firewall/rules/${ruleId}/status`, { method: "PATCH", body: json(body) });
    },
    async firewallDelete(uuid: string, ruleId: string) {
      return call(`${vm(uuid)}/firewall/rules/${ruleId}`, { method: "DELETE" });
    },

    // ---- block storage (V2: ditolak untuk API key) ----
    async blocks(query: Query = {}) {
      return call<Row>("/storage/block", { query });
    },
    async blockTypes(locationId: number) {
      return call<Row>("/storage/block/types", { query: { location_id: locationId } });
    },
    async blockOptions() {
      return call<Row>("/storage/block/options");
    },
    /** V2: { name, size, tier_id }. storage_type lama = tier_id; location_id tak dikenal lagi. */
    async blockCreate(body: { name: string; storage_type?: number; tier_id?: number; size: string | number }) {
      const req = { name: body.name, size: Number(body.size), tier_id: body.tier_id ?? body.storage_type };
      return call("/storage/block", { method: "POST", body: json(req) });
    },
    async blockAttach(blockUuid: string, instanceId: string) {
      return call(`/storage/block/${blockUuid}/attach`, { method: "PATCH", body: json({ instance_id: instanceId }) });
    },
    async blockDetach(blockUuid: string) {
      return call(`/storage/block/${blockUuid}/detach`, { method: "PATCH" });
    },
    async blockResize(blockUuid: string, size: number) {
      return call(`/storage/block/${blockUuid}/resize`, { method: "PATCH", body: json({ size }) });
    },
    async blockDelete(blockUuid: string) {
      return call(`/storage/block/${blockUuid}`, { method: "DELETE" });
    },

    // ---- ssh keys (V2: ditolak untuk API key) ----
    async sshKeys() {
      return call<Row>("/key_management/ssh_keys", { query: { limit: 100 } });
    },
    async sshKeyCreate(body: { title: string; key: string }) {
      return call("/key_management/ssh_keys", { method: "POST", body: json({ name: body.title, key: body.key }) });
    },
    async sshKeyDelete(id: string) {
      return call(`/key_management/ssh_keys/${id}`, { method: "DELETE" });
    },
  };
}

export type DepaClient = ReturnType<typeof depaClient>;
