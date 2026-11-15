#!/usr/bin/env node
// Assemble the static site: app/ → <out>/, stamp the service-worker version with a hash
// of the app files, and write app-config.json (repo + public keys) for the web app.

import { parseArgs } from 'node:util';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: join(repoRoot, '_site') },
    repo: { type: 'string', default: process.env.GITHUB_REPOSITORY || '' },
  },
});

const appDir = join(repoRoot, 'app');
const out = resolve(args.out);

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files;
}

const files = walk(appDir).sort();
const hash = createHash('sha1');
for (const f of files) hash.update(relative(appDir, f).split(sep).join('/')).update(readFileSync(f));
const build = hash.digest('hex').slice(0, 10);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(appDir, out, { recursive: true });

const swPath = join(out, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
if (!sw.includes("const VERSION = 'dev';")) throw new Error('sw.js is missing the VERSION placeholder');
writeFileSync(swPath, sw.replace("const VERSION = 'dev';", `const VERSION = '${build}';`));

const [owner = '', repo = ''] = args.repo.split('/');
const appConfig = {
  owner,
  repo,
  branch: 'main',
  workflow: 'scan.yml',
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  inboxPublicKey: process.env.INBOX_PUBLIC_KEY || '',
  build,
  builtAt: Date.now(),
};
writeFileSync(join(out, 'app-config.json'), JSON.stringify(appConfig, null, 2));
console.log(`✓ Built app ${build} → ${out}${appConfig.vapidPublicKey ? '' : ' (no VAPID key: push disabled)'}`);
