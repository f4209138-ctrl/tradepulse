#!/usr/bin/env node
// One-time setup for a TradePulse repo on GitHub:
//   • generates the Web Push (VAPID) and "inbox" key pairs,
//   • stores the private keys as Actions secrets (piped to `gh`, never printed),
//   • stores the public keys as Actions variables (the app needs them),
//   • switches GitHub Pages to "deploy from GitHub Actions".
// Requires the GitHub CLI, logged in.  Usage:
//   node tools/setup.mjs [--repo owner/name] [--rotate]
// --rotate replaces existing keys; every phone must then turn alerts on again.

import { execFileSync } from 'node:child_process';
import { createECDH } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: { repo: { type: 'string' }, rotate: { type: 'boolean', default: false } } });

function gh(argv, input) {
  return execFileSync('gh', argv, { input, encoding: 'utf8', stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] }).trim();
}

function keypair() {
  const e = createECDH('prime256v1');
  e.generateKeys();
  const priv = e.getPrivateKey();
  return {
    publicKey: e.getPublicKey().toString('base64url'),
    privateKey: Buffer.concat([Buffer.alloc(Math.max(0, 32 - priv.length)), priv]).toString('base64url'),
  };
}

const repo = args.repo || gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
const [owner, name] = repo.split('/');
console.log(`Setting up ${repo}`);

const existing = JSON.parse(gh(['variable', 'list', '--repo', repo, '--json', 'name']) || '[]').map((v) => v.name);
if (existing.includes('VAPID_PUBLIC_KEY') && existing.includes('INBOX_PUBLIC_KEY') && !args.rotate) {
  console.log('• Push keys already configured (run with --rotate to replace them).');
} else {
  for (const prefix of ['VAPID', 'INBOX']) {
    const kp = keypair();
    gh(['secret', 'set', `${prefix}_PRIVATE_KEY`, '--repo', repo], kp.privateKey);
    gh(['variable', 'set', `${prefix}_PUBLIC_KEY`, '--repo', repo, '--body', kp.publicKey]);
  }
  console.log('✓ Push keys generated: private keys saved as secrets (never shown), public keys as variables.');
}

try {
  gh(['api', '-X', 'POST', `repos/${repo}/pages`, '-f', 'build_type=workflow']);
  console.log('✓ GitHub Pages enabled (deployed by the workflow).');
} catch (err) {
  const msg = String(err.stderr || err.message);
  if (/409|already/i.test(msg)) {
    gh(['api', '-X', 'PUT', `repos/${repo}/pages`, '-f', 'build_type=workflow']);
    console.log('✓ GitHub Pages set to deploy from GitHub Actions.');
  } else {
    throw err;
  }
}

const host = `${owner.toLowerCase()}.github.io`;
console.log(`\nApp URL (after the first workflow run): https://${host}/${name.toLowerCase() === host ? '' : `${name}/`}`);
