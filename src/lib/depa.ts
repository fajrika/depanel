// Thin typed client for the depa cloud API (https://api.depa.id/v1).
// Auth: header `x-apikey`. Responses: { message, data }.

const BASE = process.env.DEPA_API_BASE || "https://api.depa.id/v1";

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

/** Normalize a raw depa instance object into our shape (defensive against field naming). */
export function normalizeInstance(raw: Record<string, unknown>): DepaInstance {
  const uuid = String(pick(raw, ["uuid", "id", "instance_uuid"]) ?? "");
  const hostname = String(pick(raw, ["hostname", "name", "label"]) ?? uuid);
  const status = canonicalStatus(String(pick(raw, ["status", "state", "power_state"]) ?? "unknown"));
  return {
    uuid,
    hostname,
    status,
    location: pick<string>(raw, ["location", "location_name", "region"]),
    tier: pick<string>(raw, ["tier", "tier_name", "plan"]),
    ip: pick<string>(raw, ["ip", "public_ip", "ip_address", "ipv4"]),
    cpu: parseSize(pick(raw, ["cpu", "vcpu", "cores"]), "MB"),
    memoryMb: parseSize(pick(raw, ["memory", "memory_mb", "ram"]), "MB"),
    storageGb: parseSize(pick(raw, ["storage", "storage_gb", "disk"]), "GB"),
    raw,
  };
}

export function depaClient(apiKey: string) {
  async function call<T = unknown>(
    path: string,
    init?: RequestInit & { query?: Record<string, string | number | undefined> }
  ): Promise<T> {
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
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { message: text };
    }
    if (!res.ok) {
      throw new DepaError(String(body.message || `HTTP ${res.status}`), res.status);
    }
    return (body.data !== undefined ? body.data : body) as T;
  }

  return {
    /** List all instances (returns normalized array; handles paginated or plain array shapes). */
    async listInstances(): Promise<DepaInstance[]> {
      const data = await call<unknown>("/instance", { query: { limit: 100 } });
      let arr: Record<string, unknown>[] = [];
      if (Array.isArray(data)) arr = data as Record<string, unknown>[];
      else if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        if (Array.isArray(d.data)) arr = d.data as Record<string, unknown>[];
        else if (Array.isArray(d.items)) arr = d.items as Record<string, unknown>[];
        else if (Array.isArray(d.instances)) arr = d.instances as Record<string, unknown>[];
      }
      return arr.map(normalizeInstance).filter((i) => i.uuid);
    },

    async getInstance(uuid: string): Promise<DepaInstance> {
      const data = await call<Record<string, unknown>>(`/instance/${uuid}/detail`);
      const inner = (data && typeof data === "object" && (data.instance || data.data)) || data;
      return normalizeInstance(inner as Record<string, unknown>);
    },

    async start(uuid: string) {
      return call(`/instance/${uuid}/start`, { method: "PATCH" });
    },
    async stop(uuid: string) {
      return call(`/instance/${uuid}/stop`, { method: "PATCH" });
    },
    async restart(uuid: string) {
      return call(`/instance/${uuid}/restart`, { method: "PATCH" });
    },

    async metrics(uuid: string, periode: string = "day") {
      return call(`/instance/${uuid}/rrd`, { query: { periode } });
    },

    /** Raw instance detail from depa (price, cost, os, ips, timestamps, ...). */
    async instanceDetail(uuid: string) {
      return call<Record<string, unknown>>(`/instance/${uuid}/detail`);
    },

    // ---- snapshots ----
    async snapshots(uuid: string) {
      return call<Record<string, unknown>[]>(`/instance/${uuid}/snapshot/snapshots`);
    },
    async snapshotCreate(uuid: string, body: { name: string; description: string }) {
      return call(`/instance/${uuid}/snapshot/create`, { method: "POST", body: JSON.stringify(body) });
    },
    async snapshotRollback(uuid: string, snapshotUuid: string) {
      return call(`/instance/${uuid}/snapshot/${snapshotUuid}/rollback`, { method: "PATCH" });
    },
    async snapshotDelete(uuid: string, snapshotUuid: string) {
      return call(`/instance/${uuid}/snapshot/${snapshotUuid}/delete`, { method: "DELETE" });
    },

    // ---- backups (depa's own backup schedules + archives) ----
    async backupHistory(uuid: string) {
      return call<Record<string, unknown>>(`/instance/${uuid}/backup/history`);
    },
    async backupSchedules(uuid: string) {
      return call<Record<string, unknown>[]>(`/instance/${uuid}/backup/schedules`);
    },
    async backupScheduleCreate(
      uuid: string,
      body: { retention: number; schedule_type: string; schedule_at: number; schedule_on?: number },
    ) {
      return call(`/instance/${uuid}/backup/schedules/create`, { method: "POST", body: JSON.stringify(body) });
    },
    async backupScheduleUpdate(
      uuid: string,
      scheduleId: string,
      body: { retention?: number; schedule_type?: string; schedule_at?: number; schedule_on?: number },
    ) {
      return call(`/instance/${uuid}/backup/schedules/${scheduleId}/update`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    async backupScheduleDelete(uuid: string, scheduleId: string) {
      return call(`/instance/${uuid}/backup/schedules/${scheduleId}/delete`, { method: "DELETE" });
    },
    async backupRestore(uuid: string, backupId: string) {
      return call(`/instance/${uuid}/backup/restore/${backupId}`);
    },
    async backupDelete(uuid: string, backupUuid: string) {
      return call(`/instance/${uuid}/backup/${backupUuid}/delete`, { method: "DELETE" });
    },

    async billingSummary() {
      return call("/billing/summary");
    },
    async creditHistory(page = 1) {
      return call<Record<string, unknown>>("/billing/credit/history", { query: { page } });
    },
    async depositHistory(page = 1) {
      return call<Record<string, unknown>>("/billing/deposit/history", { query: { page } });
    },
    async billingReports(page = 1) {
      return call<Record<string, unknown>>("/billing/reports", { query: { page } });
    },

    // ---- top-up (creates a payment invoice; the user pays manually) ----
    async topupMethods(amount: number) {
      return call<Record<string, unknown>>("/billing/v2/methods", { query: { amount } });
    },
    async topupCreate(body: { amount: number; payment_method: string; phone_number?: string; code?: string }) {
      return call<Record<string, unknown>>("/billing/v2/topup", { method: "POST", body: JSON.stringify(body) });
    },
    async topupStatus(invoiceId: string) {
      return call<Record<string, unknown>>(`/billing/v2/topup/${invoiceId}/status`);
    },

    // ---- resize / tier ----
    async resize(uuid: string, body: { cpu: number; memory: number; storage: number; use_dedicated_cpu?: boolean }) {
      return call(`/instance/${uuid}/resize`, { method: "PATCH", body: JSON.stringify(body) });
    },
    async changeTier(uuid: string, tierId: number) {
      return call(`/instance/${uuid}/change-tier`, { method: "PATCH", body: JSON.stringify({ tier_id: tierId }) });
    },
    async changeTierPrice(uuid: string, tierId: number) {
      return call<Record<string, unknown>>(`/instance/${uuid}/change-tier/price`, { query: { tier_id: tierId } });
    },
    async tiers() {
      return call<Record<string, unknown>[]>("/tiers");
    },

    // ---- reinstall ----
    async reinstall(uuid: string, body: { template_id: number; username: string; password: string }) {
      return call(`/instance/${uuid}/reinstall`, { method: "PATCH", body: JSON.stringify(body) });
    },
    async systems() {
      return call<Record<string, unknown>[]>("/systems");
    },
    async updateHostname(uuid: string, hostname: string) {
      return call(`/instance/${uuid}/update-hostname`, { method: "PATCH", body: JSON.stringify({ hostname }) });
    },

    // ---- create / delete instance ----
    async locations() {
      return call<Record<string, unknown>[]>("/locations");
    },
    async sizeTemplate() {
      return call<Record<string, unknown>[]>("/instance/size-template");
    },
    async instanceCreate(body: Record<string, unknown>) {
      return call("/instance/create", { method: "POST", body: JSON.stringify(body) });
    },
    async instanceDelete(uuid: string, body: { remove_ip?: boolean; remove_block_storage?: boolean } = {}) {
      return call(`/instance/${uuid}`, { method: "DELETE", body: JSON.stringify(body) });
    },

    // ---- console ----
    async console(uuid: string) {
      return call<Record<string, unknown>>(`/instance/${uuid}/console-websocket`, { method: "POST" });
    },

    // ---- firewall ----
    async firewallRules(uuid: string, page = 1, limit = 50) {
      return call<Record<string, unknown>>(`/instance/${uuid}/firewall/rules`, { query: { page, limit } });
    },
    async firewallRuleTypes() {
      return call<Record<string, unknown>>("/firewall-rule-types");
    },
    async firewallDefault(uuid: string) {
      return call<Record<string, unknown>>(`/instance/${uuid}/firewall/default`);
    },
    async firewallDefaultUpdate(uuid: string, action: string) {
      return call(`/instance/${uuid}/firewall/default/update`, { method: "PATCH", body: JSON.stringify({ action }) });
    },
    async firewallCreate(uuid: string, body: Record<string, unknown>) {
      return call(`/instance/${uuid}/firewall/create`, { method: "POST", body: JSON.stringify(body) });
    },
    async firewallUpdate(uuid: string, ruleId: string, body: Record<string, unknown>) {
      return call(`/instance/${uuid}/firewall/${ruleId}/update`, { method: "PATCH", body: JSON.stringify(body) });
    },
    async firewallUpdateStatus(uuid: string, ruleId: string, body: Record<string, unknown>) {
      return call(`/instance/${uuid}/firewall/${ruleId}/update-status`, { method: "PATCH", body: JSON.stringify(body) });
    },
    async firewallDelete(uuid: string, ruleId: string) {
      return call(`/instance/${uuid}/firewall/${ruleId}/delete`, { method: "DELETE" });
    },

    // ---- block storage ----
    async blocks(query: Record<string, string | number | undefined> = {}) {
      return call<Record<string, unknown>>("/storage/blocks", { query });
    },
    async blockTypes(locationId: number) {
      return call<Record<string, unknown>>("/storage/blocks/types", { query: { location_id: locationId } });
    },
    async blockOptions(locationId: number) {
      return call<Record<string, unknown>>("/storage/blocks/options", { query: { location_id: locationId } });
    },
    async blockCreate(body: { name: string; location_id: number; storage_type: number; size: string }) {
      return call("/storage/blocks/create", { method: "POST", body: JSON.stringify(body) });
    },
    async blockAttach(blockUuid: string, instanceId: string) {
      return call(`/storage/blocks/${blockUuid}/attach`, { method: "PATCH", body: JSON.stringify({ instance_id: instanceId }) });
    },
    async blockDetach(blockUuid: string) {
      return call(`/storage/blocks/${blockUuid}/detach`, { method: "PATCH" });
    },
    async blockResize(blockUuid: string, size: number) {
      return call(`/storage/blocks/${blockUuid}/resize`, { method: "PATCH", body: JSON.stringify({ size }) });
    },
    async blockDelete(blockUuid: string) {
      return call(`/storage/blocks/${blockUuid}`, { method: "DELETE" });
    },

    // ---- ssh keys ----
    async sshKeys() {
      return call<Record<string, unknown>>("/credential/ssh");
    },
    async sshKeyCreate(body: { title: string; key: string }) {
      return call("/credential/ssh", { method: "POST", body: JSON.stringify(body) });
    },
    async sshKeyDelete(id: string) {
      return call(`/credential/ssh/${id}`, { method: "DELETE" });
    },
  };
}

export type DepaClient = ReturnType<typeof depaClient>;
