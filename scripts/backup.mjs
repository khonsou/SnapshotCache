import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await mkdir('.backups', { recursive: true });
const destination = `.backups/source-${new Date().toISOString().replace(/[:.]/g, '-')}.tgz`;
// Explicit source allowlist. Never include .env, credentials, npm caches, test traces or .git.
execFileSync('tar', ['-czf', destination, 'AGENTS.md', 'PRD.md', 'README.md', '.gitignore', '.openai/hosting.json', 'package.json', 'package-lock.json', 'playwright.config.mjs', 'contracts', 'docs', 'examples', 'scripts', 'server', 'src', 'tests']);
console.log(destination);
