import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_ROOT = '/Users/g/VScode-Programs/Projects';
const PORT = 3849;

// Store active sessions
const activeSessions = new Map();

// Create HTTP server for REST endpoints
const server = createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /api/projects - List projects
  if (url.pathname === '/api/projects' && req.method === 'GET') {
    try {
      const projects = scanProjects();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(projects));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // GET /api/projects/:name/tasks - List task files for a project
  if (url.pathname.match(/^\/api\/projects\/[^/]+\/tasks$/) && req.method === 'GET') {
    const projectName = url.pathname.split('/')[3];
    try {
      const tasks = getProjectTasks(projectName);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tasks));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // POST /api/stop/:sessionId - Stop a running session
  if (url.pathname.match(/^\/api\/stop\/[^/]+$/) && req.method === 'POST') {
    const sessionId = url.pathname.split('/')[3];
    const session = activeSessions.get(sessionId);
    if (session && session.process) {
      session.process.kill('SIGTERM');
      activeSessions.delete(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Create WebSocket server for real-time communication
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'start') {
        const { tasks, projectPath, sessionId } = message;
        await runAutopilot(ws, tasks, projectPath, sessionId);
      }

      if (message.type === 'stop') {
        const { sessionId } = message;
        const session = activeSessions.get(sessionId);
        if (session && session.process) {
          session.process.kill('SIGTERM');
          activeSessions.delete(sessionId);
          ws.send(JSON.stringify({ type: 'stopped', sessionId }));
        }
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

function scanProjects() {
  const projects = [];

  try {
    const entries = readdirSync(PROJECTS_ROOT);

    for (const entry of entries) {
      const fullPath = join(PROJECTS_ROOT, entry);

      try {
        const stat = statSync(fullPath);
        if (!stat.isDirectory()) continue;

        // Skip hidden directories
        if (entry.startsWith('.')) continue;

        const hasPackageJson = existsSync(join(fullPath, 'package.json'));
        const tasksDir = join(fullPath, 'tasks');
        const hasTasks = existsSync(tasksDir) && readdirSync(tasksDir).some(f => f.endsWith('.yaml') || f.endsWith('.yml'));

        // Check for nested project structure (like edge-autopilot/edge-autopilot)
        const nestedPath = join(fullPath, entry);
        if (existsSync(nestedPath) && statSync(nestedPath).isDirectory()) {
          const nestedHasPackage = existsSync(join(nestedPath, 'package.json'));
          const nestedTasksDir = join(nestedPath, 'tasks');
          const nestedHasTasks = existsSync(nestedTasksDir) && readdirSync(nestedTasksDir).some(f => f.endsWith('.yaml') || f.endsWith('.yml'));

          if (nestedHasPackage || nestedHasTasks) {
            projects.push({
              name: `${entry}/${entry}`,
              path: nestedPath,
              hasPackageJson: nestedHasPackage,
              hasTasks: nestedHasTasks,
            });
          }
        }

        projects.push({
          name: entry,
          path: fullPath,
          hasPackageJson,
          hasTasks,
        });
      } catch (e) {
        // Skip inaccessible directories
      }
    }
  } catch (error) {
    console.error('Error scanning projects:', error);
  }

  return projects.sort((a, b) => {
    // Prioritize projects with tasks
    if (a.hasTasks && !b.hasTasks) return -1;
    if (!a.hasTasks && b.hasTasks) return 1;
    return a.name.localeCompare(b.name);
  });
}

function getProjectTasks(projectName) {
  const projectPath = join(PROJECTS_ROOT, projectName);
  const tasksDir = join(projectPath, 'tasks');

  if (!existsSync(tasksDir)) {
    return [];
  }

  return readdirSync(tasksDir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => ({
      name: f,
      path: join(tasksDir, f),
    }));
}

async function runAutopilot(ws, tasks, projectPath, sessionId) {
  // Create temp YAML file with tasks
  const tempDir = join(dirname(__dirname), '..', 'temp');
  mkdirSync(tempDir, { recursive: true });

  const taskFile = join(tempDir, `commander-${sessionId}.yaml`);
  const yamlContent = generateYaml(tasks);
  writeFileSync(taskFile, yamlContent);

  ws.send(JSON.stringify({
    type: 'log',
    entry: {
      type: 'info',
      message: `Starting autopilot with ${tasks.length} tasks`,
      timestamp: new Date().toISOString(),
    }
  }));

  ws.send(JSON.stringify({
    type: 'log',
    entry: {
      type: 'info',
      message: `Project: ${projectPath}`,
      timestamp: new Date().toISOString(),
    }
  }));

  ws.send(JSON.stringify({
    type: 'log',
    entry: {
      type: 'info',
      message: `Task file: ${taskFile}`,
      timestamp: new Date().toISOString(),
    }
  }));

  // Spawn the autopilot CLI with --no-dashboard since Commander has its own UI
  const cliPath = join(dirname(__dirname), 'cli.js');
  const autopilot = spawn('node', [cliPath, 'autopilot', '-t', taskFile, '--no-dashboard'], {
    cwd: projectPath,
    stdio: ['ignore', 'pipe', 'pipe'],  // Explicitly pipe stdout/stderr
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  console.log(`[Commander] Spawned autopilot PID ${autopilot.pid}`);

  activeSessions.set(sessionId, { process: autopilot, ws });

  let currentTaskIndex = 0;
  let taskStarted = false;
  let currentTaskOutput = [];  // Collect output for current task
  let taskStartTime = Date.now();

  // Send initial task as running
  if (tasks.length > 0) {
    ws.send(JSON.stringify({
      type: 'taskUpdate',
      taskId: tasks[0].id,
      status: 'running',
    }));
    taskStarted = true;
    taskStartTime = Date.now();
  }

  // Set encoding for proper string handling
  autopilot.stdout.setEncoding('utf8');
  autopilot.stderr.setEncoding('utf8');

  autopilot.stdout.on('data', (data) => {
    const output = data.toString();

    // Collect output for current task (skip banner/boilerplate)
    if (taskStarted && !output.includes('╔═') && !output.includes('╚═') && !output.includes('║')) {
      currentTaskOutput.push(output);
    }

    const lines = output.split('\n').filter(l => l.trim());

    for (const line of lines) {
      // Parse task progress - match "Running:" which is what supervisor outputs
      if (line.includes('Running:') && !taskStarted) {
        if (currentTaskIndex < tasks.length) {
          ws.send(JSON.stringify({
            type: 'taskUpdate',
            taskId: tasks[currentTaskIndex].id,
            status: 'running',
          }));
          taskStarted = true;
          taskStartTime = Date.now();
          currentTaskOutput = [];
        }
      }

      // Match "✓ Task completed" or just "Task completed"
      if (line.includes('Task completed') || (line.includes('✓') && !line.includes('Running'))) {
        if (currentTaskIndex < tasks.length) {
          const taskDuration = Date.now() - taskStartTime;
          const fullOutput = currentTaskOutput.join('').trim();

          // Send task result with full output
          ws.send(JSON.stringify({
            type: 'taskResult',
            taskId: tasks[currentTaskIndex].id,
            description: tasks[currentTaskIndex].description,
            status: 'complete',
            output: fullOutput,
            completedAt: new Date().toISOString(),
            duration: taskDuration,
          }));

          ws.send(JSON.stringify({
            type: 'taskUpdate',
            taskId: tasks[currentTaskIndex].id,
            status: 'complete',
            completedAt: new Date().toISOString(),
            output: fullOutput,
          }));

          currentTaskIndex++;
          taskStarted = false;
          currentTaskOutput = [];

          // Start next task if available
          if (currentTaskIndex < tasks.length) {
            ws.send(JSON.stringify({
              type: 'taskUpdate',
              taskId: tasks[currentTaskIndex].id,
              status: 'running',
            }));
            taskStarted = true;
            taskStartTime = Date.now();
          }
        }
      }

      // Match task failures
      if (line.includes('Task failed') || line.includes('✗') || (line.includes('Error:') && !line.includes('error handling'))) {
        if (currentTaskIndex < tasks.length) {
          const taskDuration = Date.now() - taskStartTime;
          const fullOutput = currentTaskOutput.join('').trim();

          // Send task result with full output
          ws.send(JSON.stringify({
            type: 'taskResult',
            taskId: tasks[currentTaskIndex].id,
            description: tasks[currentTaskIndex].description,
            status: 'failed',
            output: fullOutput,
            error: line,
            completedAt: new Date().toISOString(),
            duration: taskDuration,
          }));

          ws.send(JSON.stringify({
            type: 'taskUpdate',
            taskId: tasks[currentTaskIndex].id,
            status: 'failed',
            error: line,
            output: fullOutput,
          }));

          currentTaskIndex++;
          taskStarted = false;
          currentTaskOutput = [];

          // Start next task if available
          if (currentTaskIndex < tasks.length) {
            ws.send(JSON.stringify({
              type: 'taskUpdate',
              taskId: tasks[currentTaskIndex].id,
              status: 'running',
            }));
            taskStarted = true;
            taskStartTime = Date.now();
          }
        }
      }

      // Send log entry
      ws.send(JSON.stringify({
        type: 'log',
        entry: {
          type: line.includes('Error') || line.includes('✗') ? 'error' :
                line.includes('✓') || line.includes('completed') ? 'success' :
                line.includes('Modified:') || line.includes('Created:') ? 'file-change' : 'info',
          message: line,
          timestamp: new Date().toISOString(),
        }
      }));
    }
  });

  autopilot.stderr.on('data', (data) => {
    const output = data.toString();
    ws.send(JSON.stringify({
      type: 'log',
      entry: {
        type: 'error',
        message: output,
        timestamp: new Date().toISOString(),
      }
    }));
  });

  autopilot.on('close', (code) => {
    activeSessions.delete(sessionId);

    ws.send(JSON.stringify({
      type: 'log',
      entry: {
        type: code === 0 ? 'success' : 'error',
        message: `Autopilot exited with code ${code}`,
        timestamp: new Date().toISOString(),
      }
    }));

    ws.send(JSON.stringify({
      type: 'complete',
      sessionId,
      exitCode: code,
    }));
  });

  autopilot.on('error', (error) => {
    ws.send(JSON.stringify({
      type: 'error',
      message: error.message,
    }));
  });
}

function generateYaml(tasks) {
  const lines = ['tasks:'];

  for (const task of tasks) {
    // Escape special YAML characters in id and description
    const safeId = escapeYamlString(task.id);
    const safeDesc = escapeYamlString(task.description);

    lines.push(`  - id: "${safeId}"`);
    lines.push(`    description: "${safeDesc}"`);
    lines.push(`    prompt: |`);
    const promptLines = task.prompt.split('\n');
    for (const line of promptLines) {
      lines.push(`      ${line}`);
    }
  }

  return lines.join('\n');
}

function escapeYamlString(str) {
  if (!str) return '';
  // Escape backslashes and double quotes
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

server.listen(PORT, () => {
  console.log(`Commander API server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready for connections`);
});
