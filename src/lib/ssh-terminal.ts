import { Client as SshClient, ClientChannel, ConnectConfig } from "ssh2";
import { prisma } from "./db";
import { decryptSecret } from "./crypto";

type SshRow = {
  host: string;
  port: number;
  username: string;
  authType: string;
  passwordEnc: string;
  privateKeyEnc: string | null;
  keyPassphraseEnc: string | null;
};

function sshCfgFrom(r: SshRow): ConnectConfig {
  return {
    host: r.host,
    port: r.port,
    username: r.username,
    ...(r.authType === "key"
      ? {
          privateKey: r.privateKeyEnc ? decryptSecret(r.privateKeyEnc) : "",
          ...(r.keyPassphraseEnc ? { passphrase: decryptSecret(r.keyPassphraseEnc) } : {}),
        }
      : { password: decryptSecret(r.passwordEnc) }),
    readyTimeout: 15_000,
    keepaliveInterval: 30_000,
    keepaliveCountMax: 5,
  };
}

export type TerminalSession = {
  id: string;
  ssh: SshClient;
  channel: ClientChannel;
  createdAt: number;
};

const sessions = new Map<string, TerminalSession>();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 menit

export async function createTerminalSession(sshConnectionId: string): Promise<TerminalSession> {
  const row = await prisma.sshConnection.findUnique({
    where: { id: sshConnectionId },
    select: { host: true, port: true, username: true, authType: true, passwordEnc: true, privateKeyEnc: true, keyPassphraseEnc: true },
  });
  if (!row) throw new Error("Koneksi SSH tidak ditemukan");

  const cfg = sshCfgFrom(row);
  const client = new SshClient();

  await new Promise<void>((resolve, reject) => {
    client.once("ready", () => resolve());
    client.once("error", reject);
    client.connect(cfg);
  });

  const channel = await new Promise<ClientChannel>((resolve, reject) => {
    client.shell({ term: "xterm-256color", cols: 80, rows: 24 }, (err, ch) => {
      if (err) reject(err);
      else resolve(ch);
    });
  });

  const id = `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const session: TerminalSession = { id, ssh: client, channel, createdAt: Date.now() };
  sessions.set(id, session);

  client.on("close", () => sessions.delete(id));
  client.on("error", () => sessions.delete(id));

  return session;
}

export function getSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
}

export function resizeTerminal(id: string, cols: number, rows: number) {
  const s = sessions.get(id);
  if (s?.channel) s.channel.setWindow(rows, cols, 0, 0);
}

export function closeSession(id: string) {
  const s = sessions.get(id);
  if (s) {
    try { s.channel.close(); } catch {}
    try { s.ssh.end(); } catch {}
    sessions.delete(id);
  }
}

// Cleanup expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) closeSession(id);
  }
}, 60_000);
