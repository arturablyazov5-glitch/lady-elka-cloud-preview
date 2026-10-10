import { readFile, mkdir, writeFile, rename, rm, stat, link } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSnapshot, checksum, defaultSnapshot } from './snapshot.mjs';
const args = process.argv.slice(2);
const value = flag => { const i = args.indexOf(flag); if (i < 0) return undefined; const result=args[i+1]; if (!result || result.startsWith('--')) throw new Error(`Missing value for ${flag}`); return result; };
const input = value('--input');
if (!input || args.some(a => a.startsWith('--') && !['--input','--output','--assets','--replace'].includes(a))) throw new Error('Usage: node storefront/blog/import.mjs --input export.json [--assets mapping.json] [--output snapshot.json] [--replace]');
const content = await readFile(resolve(input), 'utf8');
const mapping = value('--assets') ? JSON.parse(await readFile(resolve(value('--assets')), 'utf8')) : {};
const snapshot = await createSnapshot(JSON.parse(content), {mapping,source:basename(input),exportChecksum:checksum(content)});
const output = resolve(value('--output') || defaultSnapshot);
if (!args.includes('--replace')) { try { await stat(output); throw new Error('Snapshot already exists; use --replace explicitly'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
await mkdir(dirname(output), {recursive:true});
const temporary = `${output}.${randomUUID()}.tmp`;
try { await writeFile(temporary, JSON.stringify(snapshot,null,2)+'\n', {flag:'wx'}); if (args.includes('--replace')) await rename(temporary,output); else await link(temporary,output); } finally { await rm(temporary,{force:true}); }
console.log(`Prepared local publication: ${snapshot.posts.length} posts; ${output}; sha256=${snapshot.sha256}. Build and deployment still required; productionReady=false.`);
