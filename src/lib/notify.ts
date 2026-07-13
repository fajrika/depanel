// Outbound notifications for a team: Telegram, Discord, or a generic webhook.
// Worker-safe (no next/headers). Called by the scheduler worker and routes.
import { prisma } from "./db";

export type NotifyEvent = "power" | "backup" | "error" | "balance";

const EVENT_FIELD: Record<NotifyEvent, "onPower" | "onBackup" | "onError" | "onBalance"> = {
  power: "onPower",
  backup: "onBackup",
  error: "onError",
  balance: "onBalance",
};

/** Deliver a plain-text message to one channel. Returns null on success, else an error string. */
export async function sendToChannel(
  channel: { type: string; config: string },
  text: string,
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
      const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cfg.chatId, text, disable_web_page_preview: true }),
      });
      if (!res.ok) {
        // Telegram mengembalikan {ok:false, description:"..."} — tampilkan agar jelas penyebabnya
        const detail = await res.json().catch(() => null);
        const desc = detail?.description ? `: ${detail.description}` : "";
        return `Telegram HTTP ${res.status}${desc}`;
      }
      return null;
    }
    if (channel.type === "discord") {
      if (!cfg.url) return "URL webhook Discord kosong";
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return `Discord HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`;
      }
      return null;
    }
    // generic webhook
    if (!cfg.url) return "URL webhook kosong";
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, message: text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return `Webhook HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`;
    }
    return null;
  } catch (e) {
    return `Gagal menghubungi endpoint: ${(e as Error).message}`;
  }
}

/** Send a message to every enabled channel of a team that is subscribed to `event`. */
export async function notifyTeam(teamId: string | null | undefined, event: NotifyEvent, text: string): Promise<void> {
  if (!teamId) return;
  const field = EVENT_FIELD[event];
  const channels = await prisma.notifyChannel.findMany({
    where: { teamId, enabled: true, [field]: true },
  });
  await Promise.all(channels.map((c) => sendToChannel(c, `⚡ Depanel\n${text}`)));
}
