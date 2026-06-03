import { describe, expect, it, vi } from "vitest";
import { processAttachments } from "../../src/feishu/attachments.js";
import type { NormalizedMessage } from "../../src/feishu/channel.js";

function testMsg(resources: any[]): NormalizedMessage {
  return {
    messageId: "msg-1",
    chatId: "chat-1",
    chatType: "p2p" as const,
    senderId: "user-1",
    content: "look at this",
    rawContentType: "text",
    resources,
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: Date.now(),
  };
}

describe("processAttachments", () => {
  it("returns empty result when msg has no resources", async () => {
    const channel = { downloadMessageResource: vi.fn() };
    const result = await processAttachments(
      channel as any,
      testMsg([]),
      "/tmp/test",
    );
    expect(result.images).toEqual([]);
    expect(result.text).toBe("");
  });

  it("downloads image and returns base64 ImageContent", async () => {
    const pngBuffer = Buffer.from("fake-png-data");
    const channel = {
      downloadMessageResource: vi.fn().mockResolvedValue(pngBuffer),
    };

    const msg = testMsg([
      { type: "image", fileKey: "img-1", fileName: "photo.png" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(channel.downloadMessageResource).toHaveBeenCalledWith(
      "msg-1",
      "img-1",
      "image",
    );
    expect(result.images).toHaveLength(1);
    expect(result.images[0].type).toBe("image");
    expect(result.images[0].mimeType).toBe("image/png");
    expect(result.images[0].data).toBe(pngBuffer.toString("base64"));
    expect(result.text).toBe("");
  });

  it("infer mimeType from fileName extension", async () => {
    const cases = [
      ["photo.jpg", "image/jpeg"],
      ["photo.jpeg", "image/jpeg"],
      ["photo.gif", "image/gif"],
      ["photo.webp", "image/webp"],
      ["photo.bmp", "image/bmp"],
      ["unknown.xyz", "image/png"],
      ["noextension", "image/png"],
    ];

    for (const [fileName, expectedMime] of cases) {
      const channel = {
        downloadMessageResource: vi.fn().mockResolvedValue(Buffer.from("x")),
      };
      const msg = testMsg([{ type: "image", fileKey: "k", fileName }]);
      const result = await processAttachments(channel as any, msg, "/tmp/test");
      expect(result.images[0].mimeType).toBe(expectedMime);
    }
  });

  it("reads small text file and includes content in text", async () => {
    const textContent = "const x = 1;\nconsole.log(x);";
    const buffer = Buffer.from(textContent, "utf-8");
    const channel = {
      downloadMessageResource: vi.fn().mockResolvedValue(buffer),
    };

    const msg = testMsg([
      { type: "file", fileKey: "file-1", fileName: "code.js" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(result.text).toContain("[文件内容: code.js]");
    expect(result.text).toContain(textContent);
    expect(result.images).toEqual([]);
  });

  it("saves large or binary files and includes path in text", async () => {
    const channel = {
      downloadMessageResource: vi.fn().mockResolvedValue(Buffer.alloc(40000)),
    };

    const msg = testMsg([
      { type: "file", fileKey: "file-1", fileName: "data.bin" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(result.text).toContain("[文件: data.bin");
    expect(result.text).toContain("/tmp/test/data.bin");
    expect(result.images).toEqual([]);
  });

  it("handles multiple resources of mixed types", async () => {
    const pngBuffer = Buffer.from("png");
    const textBuffer = Buffer.from("hello", "utf-8");
    const channel = {
      downloadMessageResource: vi
        .fn()
        .mockResolvedValueOnce(pngBuffer)
        .mockResolvedValueOnce(textBuffer),
    };

    const msg = testMsg([
      { type: "image", fileKey: "img-1", fileName: "a.png" },
      { type: "file", fileKey: "file-1", fileName: "readme.txt" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(result.images).toHaveLength(1);
    expect(result.text).toContain("[文件内容: readme.txt]");
    expect(result.text).toContain("hello");
  });

  it("handles download errors gracefully", async () => {
    const channel = {
      downloadMessageResource: vi
        .fn()
        .mockRejectedValue(new Error("download failed")),
    };

    const msg = testMsg([
      { type: "file", fileKey: "bad", fileName: "missing.pdf" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(result.text).toContain("下载失败");
    expect(result.text).toContain("missing.pdf");
  });

  it("detects binary files by null bytes in first 4096 bytes", async () => {
    const binaryBuffer = Buffer.concat([
      Buffer.from("text"),
      Buffer.from([0x00]),
      Buffer.from("binary"),
    ]);
    const channel = {
      downloadMessageResource: vi.fn().mockResolvedValue(binaryBuffer),
    };

    const msg = testMsg([
      { type: "file", fileKey: "f", fileName: "binary.pdf" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(result.text).toContain("[文件: binary.pdf");
    expect(result.text).toContain("/tmp/test/binary.pdf");
    expect(result.text).not.toContain("[文件内容: binary.pdf]");
  });

  it("falls back to fileKey.bin when fileName is missing", async () => {
    const channel = {
      downloadMessageResource: vi
        .fn()
        .mockResolvedValue(Buffer.from("text", "utf-8")),
    };

    const msg = testMsg([{ type: "file", fileKey: "file-1" }]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(result.text).toContain("[文件内容: file-1.bin]");
  });

  it("handles audio/video by saving and including path", async () => {
    const channel = {
      downloadMessageResource: vi
        .fn()
        .mockResolvedValue(Buffer.from("audio-data")),
    };

    const msg = testMsg([
      { type: "audio", fileKey: "aud-1", fileName: "recording.mp3" },
      { type: "video", fileKey: "vid-1", fileName: "clip.mp4" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(result.text).toContain("[音频: recording.mp3");
    expect(result.text).toContain("[视频: clip.mp4");
  });

  it("ignores sticker resources", async () => {
    const channel = { downloadMessageResource: vi.fn() };

    const msg = testMsg([
      { type: "sticker", fileKey: "stick-1" },
      { type: "image", fileKey: "img-1", fileName: "a.png" },
    ]);
    await processAttachments(channel as any, msg, "/tmp/test");

    expect(channel.downloadMessageResource).toHaveBeenCalledTimes(1);
    expect(channel.downloadMessageResource).toHaveBeenCalledWith(
      "msg-1",
      "img-1",
      "image",
    );
  });

  it("text-only 模型下图片保存到文件并在 text 中提示路径", async () => {
    const pngBuffer = Buffer.from("fake-png-data");
    const channel = {
      downloadMessageResource: vi.fn().mockResolvedValue(pngBuffer),
    };

    const msg = testMsg([
      { type: "image", fileKey: "img-1", fileName: "photo.png" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test", [
      "text",
    ]);

    expect(channel.downloadMessageResource).toHaveBeenCalledWith(
      "msg-1",
      "img-1",
      "image",
    );
    expect(result.images).toHaveLength(0);
    expect(result.text).toContain("[图片: photo.png");
    expect(result.text).toContain("/tmp/test/photo.png");
  });
});
