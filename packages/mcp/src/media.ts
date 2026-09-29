/**
 * media.ts — `upload_media`, the one tool that runs on this machine instead of
 * calling the management gateway.
 *
 * It uploads a local image to Uploadfile (ADR 0020) and returns what a draft
 * needs: the public URL, the storage key, and the pixel dimensions. It reads
 * only the file it is given, accepts only image types by extension *and* by
 * content, and caps the size, so it cannot be used to exfiltrate arbitrary
 * files. `UPLOADFILE_TOKEN` comes from the repository `.env` through
 * `local.ts`; it never appears in a tool argument or result.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import { z } from 'zod';

const MAX_BYTES = 10 * 1024 * 1024;

const TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
};

export const uploadMediaInput = z.object({
  path: z.string().min(1).max(4096).describe('Absolute path to a local image (png, jpg, gif, webp, avif or svg), at most 10 MB.'),
  name: z.string().min(1).max(120).regex(/^[A-Za-z0-9._ -]+$/).optional()
    .describe('Stored file name. Defaults to the local file name.'),
}).strict();

export type UploadedMedia = {
  url: string; storageKey: string; name: string; contentType: string; size: number;
  width: number | null; height: number | null;
};

/** Width and height from the file header; null when the format does not say (e.g. an SVG with no size). */
export function imageSize(bytes: Buffer, type: string): { width: number; height: number } | null {
  if (type === 'image/png' && bytes.length >= 24 && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (type === 'image/gif' && bytes.length >= 10) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (type === 'image/jpeg') {
    let offset = 2;
    while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1] ?? 0;
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
    return null;
  }
  if (type === 'image/webp' && bytes.length >= 30 && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    return null;
  }
  if (type === 'image/avif') {
    const ispe = bytes.indexOf('ispe');
    return ispe > 0 && ispe + 16 <= bytes.length
      ? { width: bytes.readUInt32BE(ispe + 8), height: bytes.readUInt32BE(ispe + 12) }
      : null;
  }
  if (type === 'image/svg+xml') {
    const head = bytes.toString('utf8', 0, Math.min(bytes.length, 4096));
    const tag = /<svg\b[^>]*>/i.exec(head)?.[0] ?? '';
    const num = (attr: string) => {
      const match = new RegExp(`\\b${attr}="\\s*([\\d.]+)(px)?\\s*"`, 'i').exec(tag);
      return match ? Math.round(Number(match[1])) : null;
    };
    const width = num('width');
    const height = num('height');
    if (width && height) return { width, height };
    const box = /\bviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/i.exec(tag);
    return box ? { width: Math.round(Number(box[1])), height: Math.round(Number(box[2])) } : null;
  }
  return null;
}

/** Check the bytes really are the claimed image type, not a renamed file. */
function matchesType(bytes: Buffer, type: string): boolean {
  const hex = bytes.subarray(0, 12).toString('hex');
  switch (type) {
    case 'image/png': return hex.startsWith('89504e470d0a1a0a');
    case 'image/jpeg': return hex.startsWith('ffd8ff');
    case 'image/gif': return bytes.toString('ascii', 0, 4) === 'GIF8';
    case 'image/webp': return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    case 'image/avif': return bytes.toString('ascii', 4, 12).startsWith('ftypavi');
    case 'image/svg+xml': return /<svg\b/i.test(bytes.toString('utf8', 0, Math.min(bytes.length, 4096)));
    default: return false;
  }
}

export async function uploadMedia(input: z.infer<typeof uploadMediaInput>): Promise<UploadedMedia> {
  if (!isAbsolute(input.path)) throw new Error('Pass an absolute file path.');
  const type = TYPES[extname(input.path).toLowerCase()];
  if (!type) throw new Error('Only png, jpg, gif, webp, avif and svg images can be uploaded.');
  const info = await stat(input.path);
  if (!info.isFile()) throw new Error('That path is not a file.');
  if (info.size > MAX_BYTES) throw new Error('Images are limited to 10 MB. Resize or compress it first.');
  const bytes = await readFile(input.path);
  if (!matchesType(bytes, type)) throw new Error(`The file content is not a valid ${type} image.`);

  const token = process.env.UPLOADFILE_TOKEN;
  if (!token) throw new Error('UPLOADFILE_TOKEN is not set in the repository .env.');
  const { UFApi, UFFile } = await import('@uploadfile/core/server');
  const name = input.name ?? basename(input.path);
  const api = new UFApi({ token, logLevel: 'Error' });
  const { data, error } = await api.uploadFiles(new UFFile([bytes], name, { type }), {
    contentDisposition: 'inline', acl: 'public-read',
  });
  if (error || !data) throw new Error(`Uploadfile rejected the upload: ${error?.message ?? 'unknown error'}`);
  const size = imageSize(bytes, type);
  return {
    url: data.ufsUrl, storageKey: data.key, name, contentType: type, size: bytes.length,
    width: size?.width ?? null, height: size?.height ?? null,
  };
}
