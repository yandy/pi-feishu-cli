import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as net from "node:net";
import { rmSync } from "node:fs";
import { createIPCServer, IPCServer } from "../../src/ipc/server.js";
import { stringifyMessage } from "../../src/ipc/protocol.js";

const SOCK = "/tmp/test-pi-feishu-im-server.sock";

describe("IPCServer", () => {
  let server: ReturnType<typeof createIPCServer> | null = null;

  beforeAll(() => {
    try { rmSync(SOCK); } catch {}
  });

  afterAll(async () => {
    if (server) await server.close();
    try { rmSync(SOCK); } catch {}
  });

  function createClient(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const s = net.createConnection(SOCK, () => resolve(s));
      s.on("error", reject);
    });
  }

  it("can start and stop", async () => {
    server = createIPCServer(SOCK);
    await server.listen();
    expect(server.listening).toBe(true);
    await server.close();
    expect(server.listening).toBe(false);
    server = null;
  });

  it("accepts a client connection and emits 'connect'", async () => {
    server = createIPCServer(SOCK);
    await server.listen();

    const connectPromise = new Promise<void>((resolve) => {
      server!.on("connect", () => resolve());
    });

    const client = await createClient();
    await connectPromise;

    client.destroy();
    await server.close();
    server = null;
  });

  it("receives JSON-line messages from client", async () => {
    server = createIPCServer(SOCK);
    await server.listen();

    const msgPromise = new Promise<unknown>((resolve) => {
      server!.on("message", (msg) => resolve(msg));
    });

    const client = await createClient();
    const msg = stringifyMessage({ type: "shutdown" });
    client.write(msg);

    const received = await msgPromise;
    expect(received).toEqual({ type: "shutdown" });

    client.destroy();
    await server.close();
    server = null;
  });

  it("can send messages to client", async () => {
    server = createIPCServer(SOCK);
    await server.listen();

    server.on("connect", () => {
      server!.sendToClient({ type: "ready", botIdentity: { name: "bot" } });
    });

    const client = await createClient();
    const data = await new Promise<string>((resolve) => {
      client.once("data", (d) => resolve(d.toString()));
    });

    expect(data).toContain('"type":"ready"');
    expect(data).toContain('"name":"bot"');

    client.destroy();
    await server.close();
    server = null;
  });

  it("emits 'disconnect' when client disconnects", async () => {
    server = createIPCServer(SOCK);
    await server.listen();

    const disconnectPromise = new Promise<void>((resolve) => {
      server!.on("disconnect", () => resolve());
    });

    const connectPromise = new Promise<void>((resolve) => {
      server!.on("connect", () => resolve());
    });
    const client = await createClient();
    await connectPromise;

    client.destroy();
    await disconnectPromise;

    await server.close();
    server = null;
  });

  it("rejects second client with bye message", async () => {
    server = createIPCServer(SOCK);
    await server.listen();

    let rejectCount = 0;
    server.on("reject", () => { rejectCount++; });

    const client1 = await createClient();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.activeSocket).not.toBeNull();

    const client2 = await createClient();

    const byeData = await new Promise<string>((resolve) => {
      client2.once("data", (d) => resolve(d.toString()));
    });

    const bye = JSON.parse(byeData.trim());
    expect(bye.type).toBe("bye");
    expect(rejectCount).toBe(1);

    client1.destroy();
    client2.destroy();
    await server.close();
    server = null;
  });

  it("accepts new client after first disconnects", async () => {
    server = createIPCServer(SOCK);
    await server.listen();

    const client1 = await createClient();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.activeSocket).not.toBeNull();

    client1.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.activeSocket).toBeNull();

    let connected = false;
    server.on("connect", () => { connected = true; });

    const client2 = await createClient();
    await new Promise((r) => setTimeout(r, 50));
    expect(connected).toBe(true);

    client2.destroy();
    await server.close();
    server = null;
  });

  it("sendToClient returns false when no client connected", () => {
    server = createIPCServer(SOCK);
    const result = server.sendToClient({ type: "ready", botIdentity: { name: "bot" } });
    expect(result).toBe(false);
  });

  it("activeSocket returns null before any client connects", async () => {
    server = createIPCServer(SOCK);
    await server.listen();

    expect(server.activeSocket).toBeNull();

    await server.close();
    server = null;
  });

  it("emits error event when parseMessage fails", async () => {
    server = createIPCServer(SOCK);
    await server.listen();

    const errorPromise = new Promise<Error>((resolve) => {
      server!.on("error", (err) => resolve(err));
    });

    const client = await createClient();
    client.write("not valid json\n");

    const err = await errorPromise;
    expect(err).toBeInstanceOf(Error);

    client.destroy();
    await server.close();
    server = null;
  });
});
