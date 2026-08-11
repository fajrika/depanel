// Outbound notifications for a team: Telegram, Discord, or a generic webhook.
// Also writes in-app notifications (bell) and retries webhook deliveries.
// Worker-safe (no next/headers). Called by the scheduler worker and routes.
import { prisma } from "./db";

export type NotifyEvent = "power" | "backup" | "error" | "balance" | "report";

const EVENT_FIELD: Record<NotifyEvent, "onPower" | "onBackup" | "onError" | "onBalance" | "onReport"> = {
  power: "onPower",
  backup: "onBackup",
  error: "onError",
  balance: "onBalance",
  report: "onReport",
};

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * 2 ** i));
    }
  }
  throw new Error("unreachable");
}

/** Deliver a plain-text message to one channel. Returns null on success, else an error string. */
export async function sendToChannel(
  channel: { type: string; config: string },
  text: string,
  event: NotifyEvent = "error",
): Promise<string | null> {
  let cfg: Record<string, string> = {};
  try {
    cfg = JSON.parse(channel.config);
  } catch {
    return "config rusak";
  }
  try {
    if (channel.type === "telegram") {
      if (!cfg.botToken || !cfg.chatId) return "Bot token / chat ID kosong";
      const res = await withRetry(() =>
        fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: cfg.chatId, text, disable_web_page_preview: true }),
        }),
      );
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        const desc = detail?.description ? `: ${detail.description}` : "";
        return `Telegram HTTP ${res.status}${desc}`;
      }
      return null;
    }
    if (channel.type === "discord") {
      if (!cfg.url) return "URL webhook Discord kosong";
      const res = await withRetry(() =>
        fetch(cfg.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        }),
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return `Discord HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`;
      }
      return null;
    }
    // generic webhook — payload JSON terstruktur agar mudah diintegrasikan
    if (!cfg.url) return "URL webhook kosong";
    const res = await withRetry(() =>
      fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event,
          title: text.split("\n")[0] ?? text,
          message: text,
          timestamp: new Date().toISOString(),
        }),
      }),
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return `Webhook HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`;
    }
    return null;
  } catch (e) {
    return `Gagal menghubungi endpoint: ${(e as Error).message}`;
  }
}

/**
 * Kirim pesan ke semua channel tim yang subscribe event + simpan notifikasi
 * in-app (bell). userId dipakai untuk notifikasi yang hanya untuk satu user
 * (mis. keamanan login); null = untuk semua anggota tim.
 */
export async function notifyTeam(
  teamId: string | null | undefined,
  event: NotifyEvent,
  text: string,
  opts: { userId?: string | null } = {},
): Promise<void> {
  if (!teamId) return;
  const field = EVENT_FIELD[event];
  const channels = await prisma.notifyChannel.findMany({
    where: { teamId, enabled: true, [field]: true },
  });
  await Promise.all(channels.map((c) => sendToChannel(c, `⚡ Depanel\n${text}`, event)));

  // in-app notification
  try {
    await prisma.inAppNotification.create({
      data: {
        teamId,
        userId: opts.userId ?? null,
        type: event,
        title: text.split("\n")[0]?.slice(0, 200) ?? event,
        message: text.slice(0, 2000),
      },
    });
  } catch {
    /* jangan sampai notifikasi gagal merusak alur utama */
  }
}
