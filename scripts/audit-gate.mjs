#!/usr/bin/env node
// Audit gate: fail on any high or critical advisory that is not allowlisted.
//
// `npm audit --audit-level=high` cannot ignore a single advisory, so one
// unfixable advisory in build tooling turns every branch red and pushes the
// gate towards being disabled. This keeps the high gate and tolerates only the
// advisories listed, each with a reason and a review date, in
// scripts/audit-allowlist.json.
//
// Usage: node scripts/audit-gate.mjs   (run after `npm ci`)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];
const GATE = LEVELS.indexOf('high');
const here = path.dirname(fileURLToPath(import.meta.url));
const allow = JSON.parse(readFileSync(path.join(here, 'audit-allowlist.json'), 'utf8')).advisories;
const allowed = new Map(allow.map((a) => [a.id, a]));

let raw;
try {
  raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
  raw = e.stdout;
  if (!raw) throw e;
}
const report = JSON.parse(raw);
if (report.error) {
  console.error('npm audit failed:', report.error.summary || report.error);
  process.exit(2);
}

// Leaf advisories are the objects in each package's `via`; string entries only
// point at another vulnerable package, whose own advisories are listed there.
const seen = new Map();
for (const [pkg, v] of Object.entries(report.vulnerabilities || {})) {
  for (const via of v.via || []) {
    if (typeof via !== 'object') continue;
    const id = (via.url || '').split('/').pop() || String(via.source);
    if (!seen.has(id)) seen.set(id, { id, pkg: via.name || pkg, severity: via.severity, title: via.title, url: via.url });
  }
}

const blocking = [];
const tolerated = [];
for (const adv of seen.values()) {
  if (LEVELS.indexOf(adv.severity) < GATE) continue;
  (allowed.has(adv.id) ? tolerated : blocking).push(adv);
}

const today = new Date().toISOString().slice(0, 10);
for (const adv of tolerated) {
  const a = allowed.get(adv.id);
  const late = a.review_by && a.review_by < today ? ` (review date ${a.review_by} has passed)` : '';
  console.log(`allowlisted  ${adv.severity.padEnd(8)} ${adv.pkg}  ${adv.id}  ${adv.title}${late}`);
}
for (const a of allow) {
  if (![...seen.values()].some((s) => s.id === a.id)) {
    console.log(`::warning::${a.id} (${a.package}) is allowlisted but no longer reported: remove it from scripts/audit-allowlist.json`);
  }
}
for (const adv of blocking) {
  console.log(`BLOCKING     ${adv.severity.padEnd(8)} ${adv.pkg}  ${adv.id}  ${adv.title}  ${adv.url || ''}`);
}

if (blocking.length) {
  console.error(`\n${blocking.length} high or critical advisor${blocking.length === 1 ? 'y' : 'ies'} not on the allowlist. Upgrade, or add an entry with a reason and review date to scripts/audit-allowlist.json.`);
  process.exit(1);
}
console.log(`\naudit gate passed: no high or critical advisories outside the allowlist (${tolerated.length} allowlisted).`);
