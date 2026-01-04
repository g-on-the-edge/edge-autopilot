import { spawn } from 'child_process';

const prompt = `[Task]
Say "Hello from spawn test!" and count to 3.
Do not ask questions - just do it.`;

console.log('Starting spawn test...');

const proc = spawn('claude', ['-p', '--dangerously-skip-permissions', prompt], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, FORCE_COLOR: '1' }
});

proc.stdout.setEncoding('utf8');
proc.stderr.setEncoding('utf8');

proc.stdout.on('data', (data) => {
  console.log('STDOUT:', data);
});

proc.stderr.on('data', (data) => {
  console.log('STDERR:', data);
});

proc.on('close', (code) => {
  console.log('Process exited with code:', code);
});

proc.on('error', (err) => {
  console.error('Spawn error:', err);
});

console.log('Spawn started, waiting for output...');
