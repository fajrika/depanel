import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { createTerminalSession, resizeTerminal, closeSession } from "../src/lib/ssh-terminal";

const PORT = Number(process.env.SSH_WS_PORT) || 3001;

const wss = new WebSocketServer({ port: PORT });
console.log(`🔐 SSH Terminal WS server listening on :${PORT}`);

wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const sshId = url.searchParams.get("sshId");
  if (!sshId) {
    ws.close(4001, "sshId required");
    return;
  }

  let session;
  try {
    session = await createTerminalSession(sshId);
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", message: (e as Error).message }));
    ws.close(4002, "SSH connect failed");
    return;
  }

  ws.send(JSON.stringify({ type: "connected", sessionId: session.id }));

  // SSH → WS
  session.channel.on("data", (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "output", data: data.toString("utf-8") }));
    }
  });

  session.channel.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "disconnected" }));
      ws.close();
    }
  });

  session.channel.stderr?.on("data", (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "output", data: data.toString("utf-8") }));
    }
  });

  // WS → SSH
  ws.on("message", (msg: Buffer) => {
    try {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === "input" && session.channel.writable) {
        session.channel.write(parsed.data);
      } else if (parsed.type === "resize") {
        resizeTerminal(session.id, parsed.cols, parsed.rows);
      }
    } catch {
      // fallback: treat as raw input
      if (session.channel.writable) {
        session.channel.write(msg.toString());
      }
    }
  });

  ws.on("close", () => closeSession(session.id));
  ws.on("error", () => closeSession(session.id));
});
