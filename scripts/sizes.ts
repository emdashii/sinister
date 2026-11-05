/** Print raw, gzip and brotli sizes of files (what Netlify serves compressed). */
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(p: string): string[] {
  return statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => walk(join(p, f))) : [p];
}
const files = process.argv.slice(2).flatMap(walk);
let tr = 0, tg = 0, tb = 0;
for (const f of files) {
  const buf = new Uint8Array(await Bun.file(f).arrayBuffer());
  const g = gzipSync(buf, { level: 9 }).length;
  const b = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  tr += buf.length; tg += g; tb += b;
  if (files.length < 40) console.log(`${f.padEnd(60)} raw ${(buf.length / 1024).toFixed(0).padStart(6)} KB  gzip ${(g / 1024).toFixed(0).padStart(5)} KB  br ${(b / 1024).toFixed(0).padStart(5)} KB`);
}
console.log(`TOTAL ${files.length} files: raw ${(tr / 1024).toFixed(0)} KB, gzip ${(tg / 1024).toFixed(0)} KB, brotli ${(tb / 1024).toFixed(0)} KB`);
