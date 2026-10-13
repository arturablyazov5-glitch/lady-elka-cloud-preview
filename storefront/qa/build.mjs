// Preserve the isolated, noindex QA entry when the catalog is rebuilt.
// Contains no order payload, payment URL, or authorization credentials.
import {mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function copyQaPage(target) {
  await mkdir(join(target,'qa/payment'),{recursive:true});
  await copyFile(new URL('./payment/index.html',import.meta.url),join(target,'qa/payment/index.html'));
}
