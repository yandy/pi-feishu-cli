import * as net from "node:net";
import { parseMessage, stringifyMessage, type DaemonMessage, type ExtensionMessage } from "./protocol.js";

export class IPCClient {
  private socket: net.Socket | null = null;
  private socketPath: string;
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();
  private buffer = "";

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  on(event: string, handler: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  private emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach((h) => h(...args));
  }

  connect(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        resolve(true);
        return;
      }

      this.socket = net.createConnection(this.socketPath, () => {
        resolve(true);
      });

      this.socket.on("data", (data: Buffer) => {
        this.buffer += data.toString();
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = parseMessage(line);
            if (msg.type === "bye") {
              this.emit("message", msg as DaemonMessage);
              this.disconnect();
              return;
            }
            this.emit("message", msg as DaemonMessage);
          } catch (err) {
            this.emit("error", err as Error);
          }
        }
      });

      this.socket.on("close", () => {
        this.socket = null;
        this.emit("disconnect");
      });

      this.socket.on("error", (err) => {
        if (!this.socket) {
          reject(err);
          return;
        }
        this.emit("error", err);
      });
    });
  }

  send(msg: ExtensionMessage): void {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("Not connected");
    }
    this.socket.write(stringifyMessage(msg));
  }

  disconnect(): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
    }
  }
}

export function createIPCClient(socketPath: string): IPCClient {
  return new IPCClient(socketPath);
}
