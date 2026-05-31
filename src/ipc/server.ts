import * as net from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { parseMessage, stringifyMessage, type DaemonMessage, type ExtensionMessage } from "./protocol.js";

export class IPCServer {
  private server: net.Server | null = null;
  private _activeSocket: net.Socket | null = null;
  private socketPath: string;
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  get listening(): boolean {
    return this.server?.listening ?? false;
  }

  get activeSocket(): net.Socket | null {
    return this._activeSocket && !this._activeSocket.destroyed ? this._activeSocket : null;
  }

  on(event: string, handler: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  private emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach((h) => h(...args));
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      try { if (existsSync(this.socketPath)) { unlinkSync(this.socketPath); } } catch {}

      this.server = net.createServer((socket) => {
        if (this._activeSocket && !this._activeSocket.destroyed) {
          socket.write(stringifyMessage({ type: "bye", reason: "already connected" }));
          socket.end();
          socket.on("error", () => {});
          this.emit("reject");
          return;
        }

        this._activeSocket = socket;
        let buffer = "";

        socket.on("data", (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = parseMessage(line);
              this.emit("message", msg, socket);
            } catch (err) {
              this.emit("error", err);
            }
          }
        });

        socket.on("close", () => {
          this._activeSocket = null;
          this.emit("disconnect");
        });

        socket.on("error", (err) => {
          this.emit("error", err);
        });

        this.emit("connect", socket);
      });

      this.server.on("error", (err) => {
        this.emit("error", err);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        resolve();
      });
    });
  }

  send(socket: net.Socket, msg: DaemonMessage): void {
    if (socket.destroyed) return;
    socket.write(stringifyMessage(msg));
  }

  sendToClient(msg: DaemonMessage): boolean {
    const sock = this.activeSocket;
    if (!sock) return false;
    this.send(sock, msg);
    return true;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this._activeSocket && !this._activeSocket.destroyed) {
        this._activeSocket.end();
        this._activeSocket.destroy();
        this._activeSocket = null;
      }
      if (this.server) {
        this.server.close((err) => {
          if (err) this.emit("error", err);
          try { unlinkSync(this.socketPath); } catch {}
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export function createIPCServer(socketPath: string): IPCServer {
  return new IPCServer(socketPath);
}
