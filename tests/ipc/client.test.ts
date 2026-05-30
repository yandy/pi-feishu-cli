import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { createIPCServer } from "../../src/ipc/server.js";
import { createIPCClient } from "../../src/ipc/client.js";

const SOCK = "/tmp/test-pi-feishu-im-client.sock";

describe("IPCClient", () => {
  let server: ReturnType<typeof createIPCServer> | null = null;

  beforeAll(() => {
    try { rmSync(SOCK); } catch {}
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  afterAll(() => {
    try { rmSync(SOCK); } catch {}
  });

  async function startServer(): Promise<ReturnType<typeof createIPCServer>> {
    const s = createIPCServer(SOCK);
    await s.listen();
    return s;
  }

  it("connects to server", async () => {
    server = await startServer();
    const client = createIPCClient(SOCK);

    const connected = await client.connect();
    expect(connected).toBe(true);
    expect(client.connected).toBe(true);

    client.disconnect();
  });

  it("receives 'ready' message on connect", async () => {
    server = await startServer();
    server.on("connect", (socket) => {
      server!.send(socket, { type: "ready", botIdentity: { name: "bot" } });
    });

    const client = createIPCClient(SOCK);
    const readyMsg = new Promise((resolve) => {
      client.on("message", (msg) => resolve(msg));
    });

    await client.connect();
    const msg = await readyMsg;
    expect(msg).toEqual({ type: "ready", botIdentity: { name: "bot" } });

    client.disconnect();
  });

  it("can send messages to server", async () => {
    server = await startServer();
    const serverMsg = new Promise((resolve) => {
      server!.on("message", (msg) => resolve(msg));
    });

    const client = createIPCClient(SOCK);
    await client.connect();

    client.send({ type: "shutdown" });
    const msg = await serverMsg;
    expect(msg).toEqual({ type: "shutdown" });

    client.disconnect();
  });

  it("emits 'disconnect' when client disconnects", async () => {
    server = await startServer();
    const client = createIPCClient(SOCK);
    await client.connect();

    const disconnectPromise = new Promise<void>((resolve) => {
      client.on("disconnect", () => resolve());
    });

    client.disconnect();
    await disconnectPromise;
    expect(client.connected).toBe(false);
  });

  it("throws when sending while not connected", async () => {
    const client = createIPCClient(SOCK);
    expect(() => client.send({ type: "shutdown" })).toThrow("Not connected");
  });

  it("handles bye message from server", async () => {
    server = await startServer();
    const client1 = createIPCClient(SOCK);
    await client1.connect();

    const client2 = createIPCClient(SOCK);
    const messages: any[] = [];
    const disconnectPromise = new Promise<void>((resolve) => {
      client2.on("disconnect", () => resolve());
    });
    client2.on("message", (msg: any) => messages.push(msg));

    await client2.connect();
    await disconnectPromise;

    expect(messages.length).toBe(1);
    expect(messages[0]).toEqual({ type: "bye", reason: "already connected" });
    expect(client1.connected).toBe(true);

    client1.disconnect();
  });

  it("connect() rejects on bad path", async () => {
    const client = createIPCClient("/tmp/nonexistent-path-xyz.sock");
    await expect(client.connect()).rejects.toThrow();
    expect(client.connected).toBe(false);
  });

  it("connect() when already connected resolves immediately", async () => {
    server = await startServer();
    const client = createIPCClient(SOCK);
    await client.connect();
    expect(client.connected).toBe(true);

    const result = await client.connect();
    expect(result).toBe(true);

    client.disconnect();
  });

  it("emits error on malformed message", async () => {
    server = await startServer();
    const client = createIPCClient(SOCK);
    await client.connect();

    const errorPromise = new Promise<Error>((resolve) => {
      client.on("error", (err: Error) => resolve(err));
    });

    server!.activeSocket!.write("not valid json\n");

    const err = await errorPromise;
    expect(err).toBeInstanceOf(Error);

    client.disconnect();
  });
});
