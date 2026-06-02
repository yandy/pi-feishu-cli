import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Channel, NormalizedMessage } from "./channel.js";

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ProcessedAttachments {
  images: ImageContent[];
  text: string;
}

const TEXT_SIZE_LIMIT = 32 * 1024;

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
};

function inferMime(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_MAP[ext] ?? "image/png";
}

function resolveFileName(res: { fileKey: string; fileName?: string }): string {
  return res.fileName ?? `${res.fileKey}.bin`;
}

function isTextBuffer(buf: Buffer): boolean {
  return !buf.subarray(0, 4096).includes(0x00);
}

export async function processAttachments(
  channel: Pick<Channel, "downloadMessageResource">,
  msg: NormalizedMessage,
  downloadDir: string,
): Promise<ProcessedAttachments> {
  const images: ImageContent[] = [];
  const textParts: string[] = [];

  await mkdir(downloadDir, { recursive: true });

  for (const res of msg.resources) {
    const fileName = resolveFileName(res);

    if (res.type === "sticker") {
      continue;
    }

    if (res.type === "image") {
      try {
        const buf = await channel.downloadMessageResource(msg.messageId, res.fileKey, res.type);
        images.push({
          type: "image",
          data: buf.toString("base64"),
          mimeType: inferMime(fileName),
        });
      } catch (err) {
        textParts.push(`[图片: ${fileName} 下载失败: ${(err as Error).message}]`);
      }
      continue;
    }

    const isAudioVideo = res.type === "audio" || res.type === "video";

    try {
      const buf = await channel.downloadMessageResource(msg.messageId, res.fileKey, res.type);

      if (!isAudioVideo && buf.length <= TEXT_SIZE_LIMIT && isTextBuffer(buf)) {
        const content = buf.toString("utf-8");
        textParts.push(`[文件内容: ${fileName}]\n${content}`);
      } else {
        const filePath = join(downloadDir, fileName);
        await writeFile(filePath, buf);
        const label = isAudioVideo
          ? (res.type === "audio" ? "音频" : "视频")
          : "文件";
        textParts.push(`[${label}: ${fileName} 已保存到 ${filePath}]`);
      }
    } catch (err) {
      const label = isAudioVideo
        ? (res.type === "audio" ? "音频" : "视频")
        : "文件";
      textParts.push(`[${label}: ${fileName} 下载失败: ${(err as Error).message}]`);
    }
  }

  return {
    images,
    text: textParts.join("\n"),
  };
}
