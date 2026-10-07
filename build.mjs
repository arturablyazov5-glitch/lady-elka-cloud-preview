import { cp, rm, readFile } from 'node:fs/promises';
const config = await readFile(new URL('./site/f/storefront-config.js', import.meta.url), 'utf8');
if (!config.includes('"payment":null') || !config.includes('"mode":"preview"')) {
  throw new Error('This repository deploys only the preview with payment disabled');
}
await rm(new URL('./dist/', import.meta.url), { recursive: true, force: true });
await cp(new URL('./site/', import.meta.url), new URL('./dist/', import.meta.url), { recursive: true });
console.log('Static preview copied to dist; payment disabled');
