// Tiny stack VM — full ISA interpreter (see ISA.md).
// 32-bit wrapping integers, data stack <= 256, call stack <= 64,
// 256 words of memory, 1,000,000 steps, 65,536 bytes of output.
// The entry runs once for the whole instance set: it reads every
// <id> in the input dir and writes stdout.bin + exit.txt per id.
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// Per-opcode facts, indexed by opcode byte:
//   immLen: bytes of immediate after the opcode (0, 1, 2 or 4)
//   pops:   values the opcode takes off the data stack
//   pushes: values the opcode puts on the data stack
const immLen = new Uint8Array(256);
const pops = new Int8Array(256);
const pushes = new Int8Array(256);
const known = new Uint8Array(256);
for (const [op, imm, pop, push] of [
  [0x00, 0, 0, 0], [0x01, 1, 0, 1], [0x02, 4, 0, 1], [0x03, 0, 1, 0],
  [0x04, 0, 1, 2], [0x05, 0, 2, 2], [0x06, 0, 2, 3], [0x07, 0, 3, 3],
  [0x10, 0, 2, 1], [0x11, 0, 2, 1], [0x12, 0, 2, 1], [0x13, 0, 2, 1],
  [0x14, 0, 2, 1], [0x15, 0, 2, 1], [0x16, 0, 2, 1], [0x17, 0, 1, 1],
  [0x18, 0, 2, 1], [0x19, 0, 2, 1], [0x1a, 0, 2, 1], [0x1b, 0, 1, 1],
  [0x1c, 0, 2, 1], [0x1d, 0, 2, 1], [0x1e, 0, 2, 1], [0x20, 0, 2, 1],
  [0x21, 0, 2, 1], [0x22, 0, 2, 1], [0x30, 2, 0, 0], [0x31, 2, 1, 0],
  [0x32, 2, 1, 0], [0x33, 2, 0, 0], [0x34, 0, 0, 0], [0x40, 0, 1, 1],
  [0x41, 0, 2, 0], [0x50, 0, 1, 0], [0x51, 0, 1, 0], [0x52, 0, 0, 1],
  [0x53, 0, 1, 0],
]) {
  known[op] = 1;
  immLen[op] = imm;
  pops[op] = pop;
  pushes[op] = push;
}

// Run one program against one input stream.
// Returns [stdout bytes, exit code] — 0 on HALT/EXIT, else the trap code.
function run(program, input) {
  const memory = new Int32Array(256);
  const stack = new Int32Array(256);
  const calls = new Int32Array(64);
  let sp = 0;
  let cp = 0;
  let pc = 0;
  let steps = 0;
  let nextInput = 0;
  let out = '';
  let code = 0;

  const bin = (f) => { const b = stack[sp - 1], a = stack[sp - 2]; sp--; stack[sp - 1] = f(a, b); };
  const div = (f) => { const b = stack[sp - 1], a = stack[sp - 2]; if (b === 0) { code = 4; return false; } sp--; stack[sp - 1] = f(a, b); return true; };
  step: while (true) {
    if (steps === 1000000) { code = 10; break step; }
    if (pc < 0 || pc >= program.length) { code = 9; break step; }
    const op = program[pc];
    if (!known[op]) { code = 5; break step; }
    const imm = immLen[op];
    if (pc + 1 + imm > program.length) { code = 9; break step; }
    steps++;
    if (sp < pops[op]) { code = 2; break step; }
    if (sp - pops[op] + pushes[op] > 256) { code = 3; break step; }
    const ip = pc;
    pc = pc + 1 + imm;
    switch (op) {
      case 0x00: break step;
      case 0x01: stack[sp++] = (program[ip + 1] << 24) >> 24; break;
      case 0x02: stack[sp++] = program[ip + 1] | (program[ip + 2] << 8) | (program[ip + 3] << 16) | (program[ip + 4] << 24); break;
      case 0x03: sp--; break;
      case 0x04: stack[sp] = stack[sp - 1]; sp++; break;
      case 0x05: { const t = stack[sp - 1]; stack[sp - 1] = stack[sp - 2]; stack[sp - 2] = t; break; }
      case 0x06: stack[sp] = stack[sp - 2]; sp++; break;
      case 0x07: { const t = stack[sp - 3]; stack[sp - 3] = stack[sp - 2]; stack[sp - 2] = stack[sp - 1]; stack[sp - 1] = t; break; }
      case 0x10: bin((a, b) => (a + b) | 0); break;
      case 0x11: bin((a, b) => (a - b) | 0); break;
      case 0x12: bin((a, b) => Math.imul(a, b)); break;
      case 0x13: if (!div((a, b) => Math.trunc(a / b) | 0)) break step; break;
      case 0x14: if (!div((a, b) => a % b)) break step; break;
      case 0x15: if (!div((a, b) => Math.trunc((a >>> 0) / (b >>> 0)) | 0)) break step; break;
      case 0x16: if (!div((a, b) => ((a >>> 0) % (b >>> 0)) | 0)) break step; break;
      case 0x17: stack[sp - 1] = (-stack[sp - 1]) | 0; break;
      case 0x18: bin((a, b) => a & b); break;
      case 0x19: bin((a, b) => a | b); break;
      case 0x1a: bin((a, b) => a ^ b); break;
      case 0x1b: stack[sp - 1] = ~stack[sp - 1]; break;
      case 0x1c: bin((a, b) => a << (b & 31)); break;
      case 0x1d: bin((a, b) => a >> (b & 31)); break;
      case 0x1e: bin((a, b) => (a >>> (b & 31)) | 0); break;
      case 0x20: bin((a, b) => a === b ? 1 : 0); break;
      case 0x21: bin((a, b) => a < b ? 1 : 0); break;
      case 0x22: bin((a, b) => (a >>> 0) < (b >>> 0) ? 1 : 0); break;
      case 0x30: pc += ((program[ip + 1] | (program[ip + 2] << 8)) << 16) >> 16; break;
      case 0x31: { const v = stack[--sp]; if (v === 0) pc += ((program[ip + 1] | (program[ip + 2] << 8)) << 16) >> 16; break; }
      case 0x32: { const v = stack[--sp]; if (v !== 0) pc += ((program[ip + 1] | (program[ip + 2] << 8)) << 16) >> 16; break; }
      case 0x33: if (cp >= 64) { code = 7; break step; } calls[cp++] = pc; pc = program[ip + 1] | (program[ip + 2] << 8); break;
      case 0x34: if (cp === 0) { code = 8; break step; } pc = calls[--cp]; break;
      case 0x40: { const addr = stack[sp - 1]; if (addr < 0 || addr > 255) { code = 6; break step; } stack[sp - 1] = memory[addr]; break; }
      case 0x41: { const addr = stack[--sp]; const v = stack[--sp]; if (addr < 0 || addr > 255) { code = 6; break step; } memory[addr] = v; break; }
      case 0x50: { const v = stack[--sp]; const s = String(v); if (out.length + s.length > 65536) { code = 11; break step; } out += s; break; }
      case 0x51: { const v = stack[--sp]; if (out.length >= 65536) { code = 11; break step; } out += String.fromCharCode(v & 255); break; }
      case 0x52: stack[sp++] = nextInput < input.length ? input[nextInput++] : -1; break;
      case 0x53: code = stack[--sp] & 255; break step;
    }
  }
  return [Buffer.from(out, 'latin1'), code];
}

// Run every instance in the input dir, writing its outputs.
for (const id of readdirSync(inputDir).sort()) {
  const program = readFileSync(join(inputDir, id, 'program.bin'));
  const input = readFileSync(join(inputDir, id, 'input.bin'));
  const [stdout, code] = run(program, input);
  mkdirSync(join(outputDir, id), { recursive: true });
  writeFileSync(join(outputDir, id, 'stdout.bin'), stdout);
  writeFileSync(join(outputDir, id, 'exit.txt'), code + '\n');
}
