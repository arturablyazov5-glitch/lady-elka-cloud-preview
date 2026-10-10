import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
export async function buildThumbnails(target, media) {
  const map = {};
  await mkdir(join(target, 'media/catalog-thumbs'), { recursive: true });
  // Sequential transforms bound memory and disk pressure during the single build.
  for (const [url, file] of media) {
    const variants = {};
    for (const width of [240, 480]) {
      const name = `${basename(url).split('.')[0]}-${width}.webp`;
      const { data, info } = await sharp(file).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
      await writeFile(join(target, 'media/catalog-thumbs', name), data);
      variants[width] = { url: `/media/catalog-thumbs/${name}`, width: info.width, height: info.height, bytes: data.length };
    }
    map[url] = variants;
  }
  return map;
}
