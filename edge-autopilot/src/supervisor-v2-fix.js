// Paste this to replace the runSingle method (around line 160)
// Find "async runSingle" and replace the entire function with:

  async runSingle(prompt, context = '') {
    const fullPrompt = this.buildPrompt(prompt, context);
    this.logger.info(`Running: ${prompt.slice(0, 100)}...`);
    
    return new Promise((resolve, reject) => {
      const args = ['-p', '--dangerously-skip-permissions', fullPrompt];
      const workDir = this.config.workingDirectory || process.cwd();
      
      const proc = spawn('claude', args, {
        cwd: workDir,
        stdio: 'inherit',
        env: { ...process.env, FORCE_COLOR: '1' }
      });

      proc.on('close', (code) => {
        this.activeProcess = null;
        this.logger.info(`Task completed with code ${code}`);
        this.sessionStats.tasksCompleted++;
        this.sessionStats.filesChanged++;
        this.dashboard.updateStats(this.sessionStats);
        resolve({ code });
      });

      proc.on('error', (err) => {
        this.activeProcess = null;
        this.sessionStats.errors++;
        this.sessionStats.tasksFailed++;
        this.logger.error('Spawn error:', err.message);
        reject(err);
      });

      this.activeProcess = proc;
    });
  }
