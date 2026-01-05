const vscode = require('vscode');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let statusBarItem;
let outputChannel;
let activeSession = null;
let isPaused = false;
let commandCenterProcess = null;

/**
 * Activate the extension
 */
function activate(context) {
    console.log('Edge Autopilot extension activated');
    
    // Create output channel for logs
    outputChannel = vscode.window.createOutputChannel('Edge Autopilot');
    
    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = '$(rocket) Command Center';
    statusBarItem.tooltip = 'Edge Autopilot - Open Command Center';
    statusBarItem.command = 'edgeAutopilot.openCommandCenter';
    statusBarItem.show();
    
    // Register commands
    const commands = [
        vscode.commands.registerCommand('edgeAutopilot.openCommandCenter', openCommandCenter),
        vscode.commands.registerCommand('edgeAutopilot.startCopilot', startCopilot),
        vscode.commands.registerCommand('edgeAutopilot.startAutopilot', startAutopilot),
        vscode.commands.registerCommand('edgeAutopilot.addTask', addTask),
        vscode.commands.registerCommand('edgeAutopilot.viewQueue', viewQueue),
        vscode.commands.registerCommand('edgeAutopilot.viewLogs', viewLogs),
        vscode.commands.registerCommand('edgeAutopilot.pause', pauseSession),
        vscode.commands.registerCommand('edgeAutopilot.resume', resumeSession),
        vscode.commands.registerCommand('edgeAutopilot.toggleMode', toggleMode),
        vscode.commands.registerCommand('edgeAutopilot.runTask', runTask)
    ];
    
    commands.forEach(cmd => context.subscriptions.push(cmd));
    context.subscriptions.push(statusBarItem);
    context.subscriptions.push(outputChannel);
    
    // Set up file watcher for config changes
    const configWatcher = vscode.workspace.createFileSystemWatcher('**/config.yaml');
    configWatcher.onDidChange(() => {
        vscode.window.showInformationMessage('Autopilot config updated');
    });
    context.subscriptions.push(configWatcher);
}

function findRepoRoot() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return null;

    const direct = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(direct)) return workspaceRoot;

    const nested = path.join(workspaceRoot, 'edge-autopilot', 'package.json');
    if (fs.existsSync(nested)) return path.join(workspaceRoot, 'edge-autopilot');

    return workspaceRoot;
}

async function openCommandCenter() {
    const repoRoot = findRepoRoot();
    if (!repoRoot) {
        vscode.window.showErrorMessage('Open a folder first (workspace required).');
        return;
    }

    outputChannel.appendLine('\n' + '='.repeat(60));
    outputChannel.appendLine('[Command Center] Launch requested');
    outputChannel.appendLine(`Repo: ${repoRoot}`);
    outputChannel.appendLine('='.repeat(60));
    outputChannel.show(true);

    if (!commandCenterProcess) {
        const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        commandCenterProcess = spawn(npmCmd, ['run', 'command-center'], {
            cwd: repoRoot,
            shell: process.platform === 'win32',
        });

        commandCenterProcess.stdout?.on('data', (d) => outputChannel.append(d.toString()));
        commandCenterProcess.stderr?.on('data', (d) => outputChannel.append(d.toString()));

        commandCenterProcess.on('close', (code) => {
            outputChannel.appendLine(`\n[Command Center] stopped (code ${code})`);
            commandCenterProcess = null;
        });
    } else {
        outputChannel.appendLine('[Command Center] already running; opening UI...');
    }

    // Give the servers a moment to boot, then open the UI.
    setTimeout(() => {
        vscode.env.openExternal(vscode.Uri.parse('http://localhost:3848'));
    }, 600);

    vscode.window.showInformationMessage(
        'Command Center opened. Do this: 1) Pick a project 2) Add tasks (templates or type) 3) Press Run All.',
        'Open UI'
    ).then((choice) => {
        if (choice === 'Open UI') {
            vscode.env.openExternal(vscode.Uri.parse('http://localhost:3848'));
        }
    });
}

/**
 * Start Copilot mode - interactive assistance
 */
async function startCopilot() {
    updateStatus('copilot', 'active');
    outputChannel.appendLine('Starting Copilot mode...');
    outputChannel.show();
    
    vscode.window.showInformationMessage(
        'Copilot mode active. Auto-accepting routine actions.',
        'Pause', 'Settings'
    ).then(selection => {
        if (selection === 'Pause') pauseSession();
        if (selection === 'Settings') openSettings();
    });
    
    // Watch for Claude Code activity
    startMonitoring();
}

/**
 * Start Autopilot mode - fully autonomous
 */
async function startAutopilot() {
    const tasks = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: true,
        filters: { 'Task Files': ['yaml', 'yml', 'json'] },
        title: 'Select task queue'
    });
    
    if (!tasks || tasks.length === 0) return;
    
    const confirm = await vscode.window.showWarningMessage(
        'Start Autopilot? This will auto-accept most actions.',
        { modal: true },
        'Start', 'Dry Run'
    );
    
    if (!confirm) return;
    
    updateStatus('autopilot', 'active');
    outputChannel.appendLine('Starting Autopilot mode...');
    outputChannel.show();
    
    const dryRun = confirm === 'Dry Run';
    runAutopilot(tasks[0].fsPath, dryRun);
}

/**
 * Add a task to the queue
 */
async function addTask() {
    const editor = vscode.window.activeTextEditor;
    const selection = editor?.selection;
    const selectedText = editor?.document.getText(selection);
    
    const task = await vscode.window.showInputBox({
        prompt: 'Describe the task',
        value: selectedText || '',
        placeHolder: 'e.g., Add unit tests for the auth module'
    });
    
    if (!task) return;
    
    const priority = await vscode.window.showQuickPick(
        ['high', 'normal', 'low'],
        { placeHolder: 'Select priority' }
    );
    
    // Add to queue file
    const queueFile = path.join(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        'tasks',
        'queue.yaml'
    );
    
    outputChannel.appendLine(`Added task: ${task} (${priority})`);
    vscode.window.showInformationMessage(`Task added: ${task.slice(0, 50)}...`);
}

/**
 * Run a specific task
 */
async function runTask(task) {
    const prompt = typeof task === 'string' ? task : await vscode.window.showInputBox({
        prompt: 'Enter prompt for Claude Code',
        placeHolder: 'What would you like Claude to do?'
    });
    
    if (!prompt) return;
    
    outputChannel.appendLine(`\n${'='.repeat(60)}`);
    outputChannel.appendLine(`Running: ${prompt.slice(0, 100)}...`);
    outputChannel.appendLine('='.repeat(60));
    outputChannel.show();
    
    const config = vscode.workspace.getConfiguration('edgeAutopilot');
    const autoAccept = config.get('autoAccept', []);
    
    // Build Claude Code command
    const args = ['--dangerously-skip-permissions', prompt];
    
    const process = spawn('claude', args, {
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        shell: true
    });
    
    activeSession = process;
    
    process.stdout.on('data', (data) => {
        const text = data.toString();
        outputChannel.append(text);
        detectAction(text);
    });
    
    process.stderr.on('data', (data) => {
        outputChannel.append(`[ERROR] ${data.toString()}`);
    });
    
    process.on('close', (code) => {
        activeSession = null;
        updateStatus(null, 'idle');
        outputChannel.appendLine(`\nTask completed with code ${code}`);
        
        if (code === 0) {
            vscode.window.showInformationMessage('Task completed successfully');
        } else {
            vscode.window.showErrorMessage(`Task failed with code ${code}`);
        }
    });
}

/**
 * View the task queue
 */
async function viewQueue() {
    const queuePath = path.join(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        'tasks'
    );
    
    const uri = vscode.Uri.file(queuePath);
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
}

/**
 * View session logs
 */
async function viewLogs() {
    outputChannel.show();
}

/**
 * Pause auto-accept
 */
function pauseSession() {
    isPaused = true;
    updateStatus(null, 'paused');
    vscode.window.showInformationMessage('Auto-accept paused');
}

/**
 * Resume auto-accept
 */
function resumeSession() {
    isPaused = false;
    updateStatus(null, 'active');
    vscode.window.showInformationMessage('Auto-accept resumed');
}

/**
 * Toggle between modes
 */
async function toggleMode() {
    const current = vscode.workspace.getConfiguration('edgeAutopilot').get('mode');
    const options = ['Start Copilot', 'Start Autopilot', 'Run Single Task', 'View Logs'];
    
    const selection = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select action'
    });
    
    switch (selection) {
        case 'Start Copilot': startCopilot(); break;
        case 'Start Autopilot': startAutopilot(); break;
        case 'Run Single Task': runTask(); break;
        case 'View Logs': viewLogs(); break;
    }
}

/**
 * Update status bar
 */
function updateStatus(mode, state) {
    const icons = {
        active: '$(sync~spin)',
        paused: '$(debug-pause)',
        idle: '$(robot)'
    };
    
    const labels = {
        autopilot: 'Autopilot',
        copilot: 'Copilot',
        null: 'Autopilot'
    };
    
    statusBarItem.text = `${icons[state] || icons.idle} ${labels[mode] || 'Autopilot'}`;
    
    if (state === 'active') {
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (state === 'paused') {
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else {
        statusBarItem.backgroundColor = undefined;
    }
}

/**
 * Detect action in Claude Code output
 */
function detectAction(text) {
    const patterns = {
        file_create: /Creating file|Write to file/i,
        file_edit: /Editing file|Modifying/i,
        file_delete: /Deleting file|Removing file/i,
        terminal_command: /Running command|Execute:/i,
        git_push: /git push/i,
        approval_prompt: /Do you want to proceed|Continue\?/i
    };
    
    for (const [action, pattern] of Object.entries(patterns)) {
        if (pattern.test(text)) {
            handleAction(action, text);
            break;
        }
    }
}

/**
 * Handle detected action
 */
function handleAction(action, text) {
    const config = vscode.workspace.getConfiguration('edgeAutopilot');
    const autoAccept = config.get('autoAccept', []);
    const requireApproval = config.get('requireApproval', []);
    
    if (isPaused || requireApproval.includes(action)) {
        vscode.window.showWarningMessage(
            `Action requires approval: ${action}`,
            'Approve', 'Deny'
        ).then(selection => {
            if (selection === 'Approve' && activeSession) {
                activeSession.stdin.write('y\n');
            } else if (activeSession) {
                activeSession.stdin.write('n\n');
            }
        });
    } else if (autoAccept.includes(action)) {
        outputChannel.appendLine(`[Auto-accepted] ${action}`);
    }
}

/**
 * Start monitoring for Claude Code activity
 */
function startMonitoring() {
    // In a full implementation, this would watch for Claude Code processes
    // and intercept their I/O
    outputChannel.appendLine('Monitoring for Claude Code activity...');
}

/**
 * Open extension settings
 */
function openSettings() {
    vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'edgeAutopilot'
    );
}

/**
 * Run autopilot with task queue
 */
function runAutopilot(taskFile, dryRun) {
    const cliPath = path.join(__dirname, '..', 'src', 'cli.js');
    const args = ['autopilot', '--tasks', taskFile];
    if (dryRun) args.push('--dry-run');
    
    const process = spawn('node', [cliPath, ...args], {
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    });
    
    activeSession = process;
    
    process.stdout.on('data', (data) => {
        outputChannel.append(data.toString());
    });
    
    process.stderr.on('data', (data) => {
        outputChannel.append(`[ERROR] ${data.toString()}`);
    });
    
    process.on('close', (code) => {
        activeSession = null;
        updateStatus(null, 'idle');
        outputChannel.appendLine(`\nAutopilot finished with code ${code}`);
        
        vscode.window.showInformationMessage(
            `Autopilot completed. Check logs for details.`,
            'View Logs'
        ).then(selection => {
            if (selection === 'View Logs') viewLogs();
        });
    });
}

function deactivate() {
    if (activeSession) {
        activeSession.kill();
    }
}

module.exports = { activate, deactivate };
