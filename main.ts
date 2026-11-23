// A tiny stack VM for make.fun's tiny stack ISA v1, faithful to the reference semantics in every
// rule, hard ones included: wrapping MUL, INT_MIN / -1, unsigned DIVU/MODU/LTU, 5-bit shift counts,
// all ten trap codes, the step and output limits. It answers the instances in $MAKEFUN_INPUT_DIR
// (default /input) under $MAKEFUN_OUTPUT_DIR (default /output).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

// Per-opcode [immediate bytes, pops, pushes] for every defined opcode; a missing entry is trap 5.
const META: Record<number, [number, number, number]> = {
  0x00: [0,0,0], 0x01: [1,0,1], 0x02: [4,0,1], 0x03: [0,1,0], 0x04: [0,1,2],
  0x05: [0,2,2], 0x06: [0,2,3], 0x07: [0,3,3],
  0x30: [2,0,0], 0x31: [2,1,0], 0x32: [2,1,0], 0x33: [2,0,0], 0x34: [0,0,0],
  0x40: [0,1,1], 0x41: [0,2,0], 0x50: [0,1,0], 0x51: [0,1,0], 0x52: [0,0,1], 0x53: [0,1,0],
};
for (let op = 0x10; op <= 0x22; op++) if (op !== 0x1f) META[op] = [0, op === 0x17 || op === 0x1b ? 1 : 2, 1];

// The binary operators, by opcode; a zero divisor for 0x13 to 0x16 traps in the caller.
const BIN: Record<number, (a: number, b: number) => number> = {
  0x10: (a, b) => (a + b) | 0, 0x11: (a, b) => (a - b) | 0, 0x12: (a, b) => Math.imul(a, b),
  0x13: (a, b) => (a === -2147483648 && b === -1 ? a : (a / b) | 0),
  0x14: (a, b) => (b === -1 ? 0 : a % b | 0),
  0x15: (a, b) => Math.floor((a >>> 0) / (b >>> 0)) | 0,
  0x16: (a, b) => (a >>> 0) % (b >>> 0) | 0,
  0x18: (a, b) => a & b, 0x19: (a, b) => a | b, 0x1a: (a, b) => a ^ b,
  0x1c: (a, b) => a << (b & 31), 0x1d: (a, b) => a >> (b & 31),
  0x1e: (a, b) => (a >>> (b & 31)) | 0, 0x20: (a, b) => (a === b ? 1 : 0),
  0x21: (a, b) => (a < b ? 1 : 0), 0x22: (a, b) => ((a >>> 0) < (b >>> 0) ? 1 : 0),
};

function run(p: Uint8Array, inp: Uint8Array): { out: Uint8Array; code: number } {
  const n = p.length;
  const D = new Int32Array(256);
  const C = new Int32Array(64);
  const M = new Int32Array(256);
  const buf = new Uint8Array(65536);
  let sp = 0, csp = 0, olen = 0, ip = 0, pc = 0, steps = 0;
  const done = (code: number) => ({ out: buf.slice(0, olen), code });
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const meta = META[p[pc]];
    if (meta === undefined) return done(5);
    const im = meta[0];
    if (pc + im >= n) return done(9);
    steps++;
    const next = pc + 1 + im;
    if (sp < meta[1]) return done(2);
    if (sp - meta[1] + meta[2] > 256) return done(3);
    const op = p[pc];
    pc = next;
    switch (op) {
      case 0x00: return done(0);
      case 0x01: D[sp++] = (p[next - 1] << 24) >> 24; break;
      case 0x02: D[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16;
        const v = op === 0x30 ? 1 : D[--sp];
        if (op === 0x30 || (op === 0x31) === (v === 0)) pc = next + rel;
        break;
      }
      case 0x33:
        if (csp === 64) return done(7);
        C[csp++] = next;
        pc = p[next - 2] | (p[next - 1] << 8);
        break;
      case 0x34:
        if (csp === 0) return done(8);
        pc = C[--csp];
        break;
      case 0x40: case 0x41: {
        const a = D[sp - 1];
        if (a < 0 || a > 255) return done(6);
        if (op === 0x40) D[sp - 1] = M[a];
        else { sp -= 2; M[a] = D[sp]; }
        break;
      }
      case 0x50: {
        const s = String(D[sp - 1]);
        if (olen + s.length > 65536) return done(11);
        sp--;
        for (let i = 0; i < s.length; i++) buf[olen++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (olen + 1 > 65536) return done(11);
        buf[olen++] = D[--sp] & 255;
        break;
      case 0x52: D[sp++] = ip < inp.length ? inp[ip++] : -1; break;
      case 0x53: return done(D[--sp] & 255);
      default: {
        const b = D[sp - 1], a = D[sp - 2];
        if (b === 0 && op >= 0x13 && op <= 0x16) return done(4);
        sp -= 2;
        D[sp++] = BIN[op](a, b);
      }
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I)) {
  const r = run(readFileSync(`${I}/${id}/program.bin`), readFileSync(`${I}/${id}/input.bin`));
  mkdirSync(`${O}/${id}`, { recursive: true });
  writeFileSync(`${O}/${id}/stdout.bin`, r.out);
  writeFileSync(`${O}/${id}/exit.txt`, `${r.code}\n`);
}
