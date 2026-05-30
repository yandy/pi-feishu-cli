import * as net from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { parseMessage, stringifyMessage, type DaemonMessage, type ExtensionMessage } from "./protocol.js";

export class IPCServer {
  private server: net.Server | null = null;
  private _sockets: Set<net.Socket> = new Set();
  private socketPath: string;
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  get listening(): boolean {
    return this.server?.listening ?? false;
  }

  get activeSocket(): net.Socket | null {
    for (const sock of this._sockets) {
      if (!sock.destroyed) return sock;
    }
    return null;
  }

  get socketCount(): number {
    let count = 0;
    for (const sock of this._sockets) {
      if (!sock.destroyed) count++;
    }
    return count;
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
      if (existsSync(this.socketPath)) {
        unlinkSync(this.socketPath);
      }

      this.server = net.createServer((socket) => {
        this._sockets.add(socket);
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
          this._sockets.delete(socket);
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
    let sent = false;
    for (const sock of this._sockets) {
      if (!sock.destroyed) {
        this.send(sock, msg);
        sent = true;
      }
    }
    return sent;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      for (const sock of this._sockets) {
        if (!sock.destroyed) {
          sock.end();
          sock.destroy();
        }
      }
      this._sockets.clear();
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
