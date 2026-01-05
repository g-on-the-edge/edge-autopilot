#!/usr/bin/env node

import { spawn } from 'child_process';

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  child.on('exit', (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      process.exitCode = code;
    }
  });

  return child;
}

function main() {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const server = run(npmCmd, ['run', 'commander:server']);
  const ui = run(npmCmd, ['run', 'commander']);

  const shutdown = () => {
    try { server.kill('SIGTERM'); } catch {}
    try { ui.kill('SIGTERM'); } catch {}
  };

  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });

  process.on('exit', shutdown);
}

main();
