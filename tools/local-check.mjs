// Local practice check (mirrors program/v1 scorer): run a bot dir's main.ts on the
// practice cases, compare answers.json with practice/reference/expected.json.
// Usage: node tools/local-check.mjs <kit-dir> <bot-dir> [label]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [kitDir, botDir, label = 'entry'] = process.argv.slice(2);
if (!kitDir || !botDir) { console.error('usage: local-check.mjs <kit-dir> <bot-dir> [label]'); process.exit(2); }
const inputDir = join(kitDir, 'practice', 'input');
const refDir = join(kitDir, 'practice', 'reference');
const outDir = join('/tmp', `sgs-check-${label}`);
mkdirSync(outDir, { recursive: true });
const t0 = process.hrtime.bigint();
const r = spawnSync('node', ['main.ts'], {
  cwd: botDir,
  env: { ...process.env, MAKEFUN_INPUT_DIR: inputDir, MAKEFUN_OUTPUT_DIR: outDir },
  encoding: 'utf8',
});
const t1 = process.hrtime.bigint();
if (r.status !== 0) { console.log(`[${label}] main.ts exit ${r.status}`); console.log((r.stdout || '') + (r.stderr || '')); process.exit(1); }
const expected = JSON.parse(readFileSync(join(refDir, 'expected.json'), 'utf8'));
const answers = JSON.parse(readFileSync(join(outDir, 'answers.json'), 'utf8'));
const canonical = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
};
let pass = 0; const fails = [];
expected.cases.forEach((c, i) => {
  if (canonical(answers[i]) === canonical(c.output)) pass++;
  else fails.push(c.id);
});
console.log(`[${label}] ${pass}/${expected.cases.length} cases pass; wall ${(Number(t1 - t0) / 1e6).toFixed(0)} ms` + (fails.length ? `; FAIL: ${fails.join(', ')}` : ''));
if (fails.length) {
  // Show first diff: first differing key path (shallow)
  const i = expected.cases.findIndex((c) => c.id === fails[0]);
  const exp = expected.cases[i].output, got = answers[i];
  const ek = Object.keys(exp), gk = Object.keys(got || {});
  console.log(` first fail ${fails[0]}: expected keys ${ek.length}, got keys ${gk.length}`);
  for (const k of ek) {
    if (canonical(exp[k]) !== canonical(got?.[k])) {
      console.log(`  key ${k}: expected ${String(canonical(exp[k])).slice(0, 300)}`);
      console.log(`  key ${k}: got      ${String(canonical(got?.[k])).slice(0, 300)}`);
      break;
    }
  }
  const extra = gk.filter((k) => !ek.includes(k));
  const missing = ek.filter((k) => !gk.includes(k));
  if (extra.length) console.log('  extra keys:', extra.slice(0, 10));
  if (missing.length) console.log('  missing keys:', missing.slice(0, 10));
}
