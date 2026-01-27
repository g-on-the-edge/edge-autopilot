#!/usr/bin/env node

import { spawn } from 'child_process';

const SERVER_PORT = 3849;
const MAX_WAIT_MS = 10000;
const POLL_INTERVAL_MS = 200;

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

async function waitForServer(port, maxWaitMs = MAX_WAIT_MS) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/projects`);
      if (response.ok) {
        console.log(`[command-center] Server ready on port ${port}`);
        return true;
      }
    } catch {
      // Server not ready yet, keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.error(`[command-center] Server failed to start within ${maxWaitMs}ms`);
  return false;
}

async function main() {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  console.log('[command-center] Starting server...');
  const server = run(npmCmd, ['run', 'commander:server']);

  // Wait for server to be ready before starting UI
  const serverReady = await waitForServer(SERVER_PORT);

  if (!serverReady) {
    console.error('[command-center] Aborting: server did not start');
    server.kill('SIGTERM');
    process.exit(1);
  }

  console.log('[command-center] Starting UI...');
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
