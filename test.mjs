// Tests for main.ts (node test.mjs): hand-assembled ISA programs through the real entrypoint.
// Rows: program hex, input, expected stdout, expected exit ('-' is empty).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const C = `01ff5000 - -1 0
020000008001ff135000 - -2147483648 0
020000008001ff145000 - 0 0
01ff0102155000 - 2147483647 0
01ff0101225001ff0101215000 - 01 0
02a086010004125000 - 1410065408 0
01f801011d5001f801011e5000 - -42147483644 0
010550010101001300 - 5 4
01630107410107405000 - 99 0
5251525000 A A-1 0
01ff53 - - 255
03 - - 2
1f - - 5
330000 - - 7
0101 - - 9
30fdff - - 10`.split('\n').map((l) => {
  const [p, n, o, e] = l.split(' ');
  return [p, n === '-' ? '' : n, o === '-' ? '' : o, +e];
});
C.push([Array(257).fill([1, 0]).flat(), '', '', 3]);
C.push(['02000000805030f7ff', '', '-2147483648'.repeat(5957), 11]);
const R = mkdtempSync('/tmp/vt-'), I = join(R, 'i'), O = join(R, 'o');
C.forEach(([p, n], i) => {
  const d = join(I, 't' + i);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'program.bin'), typeof p === 'string' ? Buffer.from(p, 'hex') : Uint8Array.from(p));
  writeFileSync(join(d, 'input.bin'), n);
});
execFileSync(process.execPath, [join(process.cwd(), 'main.ts')],
  { env: { MAKEFUN_INPUT_DIR: I, MAKEFUN_OUTPUT_DIR: O } });
let bad = 0;
C.forEach(([, , wo, we], i) => {
  const go = readFileSync(join(O, 't' + i, 'stdout.bin'), 'latin1');
  const ge = Number(readFileSync(join(O, 't' + i, 'exit.txt'), 'utf8'));
  if (go !== wo || ge !== we) { bad++; console.log('FAIL', i, 'got exit', ge, 'want', we); }
});
console.log(bad ? `${bad} failed` : `all ${C.length} tests passed`);
process.exit(bad ? 1 : 0);
