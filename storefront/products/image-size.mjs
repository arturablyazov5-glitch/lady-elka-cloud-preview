// Build-time (Node only) intrinsic size of local raster images, read from the file header.
// Used to emit width/height on <img> so the browser reserves the box before the photo loads (CLS).
import { openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';

function header(file, length = 256 * 1024) {
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    return buffer.subarray(0, readSync(fd, buffer, 0, length, 0));
  } finally { closeSync(fd); }
}

export function imageSizeFromBuffer(b) {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < b.length) {
      if (b[offset] !== 0xff) { offset++; continue; }
      const marker = b[offset + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) { offset += marker === 0xff ? 1 : 2; continue; }
      const size = b.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
        return { width: b.readUInt16BE(offset + 7), height: b.readUInt16BE(offset + 5) };
      offset += 2 + size;
    }
  }
  return null;
}

const cache = new Map();
// Resolves a site-absolute URL (/media/..., /d/...) inside the build output; external URLs return null.
export function localImageSize(url, root) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || !root) return null;
  const file = join(root, decodeURIComponent(url.split(/[?#]/)[0]));
  if (!file.startsWith(root)) return null;
  if (!cache.has(file)) {
    let size = null;
    try { size = imageSizeFromBuffer(header(file)); } catch {}
    cache.set(file, size && size.width > 0 && size.height > 0 ? size : null);
  }
  return cache.get(file);
}
