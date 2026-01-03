/**
 * SmartDetector - Advanced action detection with context awareness
 * 
 * Features:
 * - Multi-pattern matching with confidence scores
 * - Context-aware risk assessment
 * - File impact analysis
 * - Command safety scoring
 * - Learning from session history
 */
export class SmartDetector {
  constructor() {
    this.history = [];
    this.fileStats = new Map();
    this.commandStats = new Map();
    
    // Action definitions with patterns and risk factors
    this.actionDefs = {
      file_create: {
        patterns: [
          { regex: /(?:Creating|Writing|Generating)\s+(?:new\s+)?file[:\s]+['"]?([^\s'"]+)/i, confidence: 0.95 },
          { regex: /touch\s+([^\s;|&]+)/i, confidence: 0.9 },
          { regex: />\s*([^\s;|&]+\.\w+)/i, confidence: 0.7 },
          { regex: /fs\.writeFile(?:Sync)?\s*\(\s*['"]([^'"]+)/i, confidence: 0.95 },
          { regex: /echo\s+.*>\s*([^\s;|&]+)/i, confidence: 0.8 }
        ],
        baseRisk: 0.2,
        riskFactors: {
          path_depth: (path) => path.split('/').length > 5 ? 0.1 : 0,
          extension: (path) => {
            const dangerous = ['.sh', '.bash', '.env', '.pem', '.key'];
            return dangerous.some(ext => path.endsWith(ext)) ? 0.4 : 0;
          },
          system_path: (path) => path.startsWith('/etc') || path.startsWith('/usr') ? 0.5 : 0
        }
      },
      
      file_edit: {
        patterns: [
          { regex: /(?:Editing|Modifying|Updating)\s+(?:file\s+)?['"]?([^\s'"]+)/i, confidence: 0.95 },
          { regex: /str_replace.*?(?:in|path)[:\s]+['"]?([^\s'"]+)/i, confidence: 0.95 },
          { regex: /sed\s+-i.*?\s+([^\s;|&]+)/i, confidence: 0.9 },
          { regex: /patch\s+([^\s;|&]+)/i, confidence: 0.85 }
        ],
        baseRisk: 0.3,
        riskFactors: {
          config_file: (path) => /\.(json|yaml|yml|toml|ini|conf)$/.test(path) ? 0.2 : 0,
          sensitive_file: (path) => /\.(env|pem|key|secret)/.test(path) ? 0.5 : 0,
          frequency: (path, stats) => {
            const edits = stats.get(path)?.edits || 0;
            return edits > 5 ? 0.3 : 0; // Suspicious if editing same file repeatedly
          }
        }
      },

      file_delete: {
        patterns: [
          { regex: /(?:Deleting|Removing)\s+(?:file\s+)?['"]?([^\s'"]+)/i, confidence: 0.95 },
          { regex: /rm\s+(?:-[rf]+\s+)?([^\s;|&]+)/i, confidence: 0.9 },
          { regex: /unlink\s*\(\s*['"]([^'"]+)/i, confidence: 0.9 },
          { regex: /fs\.(?:unlink|rm)(?:Sync)?\s*\(\s*['"]([^'"]+)/i, confidence: 0.95 }
        ],
        baseRisk: 0.7,
        riskFactors: {
          recursive: (_, text) => /rm\s+-r/.test(text) ? 0.3 : 0,
          force: (_, text) => /rm\s+.*-f/.test(text) ? 0.2 : 0,
          glob_pattern: (path) => /[*?]/.test(path) ? 0.4 : 0,
          important_file: (path) => {
            const important = ['package.json', 'tsconfig.json', '.gitignore', 'Dockerfile'];
            return important.some(f => path.endsWith(f)) ? 0.3 : 0;
          }
        }
      },

      terminal_command: {
        patterns: [
          { regex: /(?:Running|Executing)\s+(?:command)?[:\s]+['"]?(.+?)['"]?\s*$/i, confidence: 0.9 },
          { regex: /\$\s+(.+)/m, confidence: 0.7 },
          { regex: /bash[:\s]+(.+)/i, confidence: 0.85 },
          { regex: /exec(?:Sync)?\s*\(\s*['"]([^'"]+)/i, confidence: 0.9 }
        ],
        baseRisk: 0.4,
        riskFactors: {
          sudo: (cmd) => /sudo/.test(cmd) ? 0.5 : 0,
          pipe_to_shell: (cmd) => /\|\s*(?:bash|sh|zsh)/.test(cmd) ? 0.6 : 0,
          curl_pipe: (cmd) => /curl.*\|/.test(cmd) ? 0.5 : 0,
          network: (cmd) => /(?:curl|wget|nc|netcat)/.test(cmd) ? 0.3 : 0,
          destructive: (cmd) => /(?:rm|kill|pkill|shutdown|reboot)/.test(cmd) ? 0.4 : 0
        }
      },

      npm_install: {
        patterns: [
          { regex: /npm\s+(?:install|i|add)\s+([^\s;|&]+)/i, confidence: 0.95 },
          { regex: /yarn\s+add\s+([^\s;|&]+)/i, confidence: 0.95 },
          { regex: /pnpm\s+(?:add|install)\s+([^\s;|&]+)/i, confidence: 0.95 }
        ],
        baseRisk: 0.3,
        riskFactors: {
          global: (cmd) => /-g|--global/.test(cmd) ? 0.3 : 0,
          unknown_package: async (pkg) => {
            // Could integrate with npm registry API to check package reputation
            const suspicious = ['crypto-', 'wallet-', 'password-'];
            return suspicious.some(s => pkg.includes(s)) ? 0.4 : 0;
          },
          dev_only: (cmd) => /-D|--save-dev/.test(cmd) ? -0.1 : 0
        }
      },

      git_commit: {
        patterns: [
          { regex: /git\s+commit\s+(?:-[am]+\s+)?['"]?([^'"]+)/i, confidence: 0.95 },
          { regex: /Commit(?:ting)?[:\s]+['"]?([^'"]+)/i, confidence: 0.8 }
        ],
        baseRisk: 0.2,
        riskFactors: {
          empty_message: (msg) => !msg || msg.length < 5 ? 0.2 : 0,
          amend: (_, text) => /--amend/.test(text) ? 0.3 : 0
        }
      },

      git_push: {
        patterns: [
          { regex: /git\s+push(?:\s+([^\s;|&]+))?/i, confidence: 0.95 },
          { regex: /Push(?:ing)?\s+to\s+(\w+)/i, confidence: 0.85 }
        ],
        baseRisk: 0.6,
        riskFactors: {
          force: (_, text) => /-f|--force/.test(text) ? 0.4 : 0,
          main_branch: (branch) => /^(main|master|prod)$/.test(branch) ? 0.3 : 0,
          all: (_, text) => /--all/.test(text) ? 0.2 : 0
        }
      },

      database_operation: {
        patterns: [
          { regex: /(?:migrate|migration)\s+(?:run|up|down)/i, confidence: 0.95 },
          { regex: /prisma\s+(?:migrate|db\s+push)/i, confidence: 0.95 },
          { regex: /supabase\s+(?:db|migration)/i, confidence: 0.95 },
          { regex: /DROP\s+(?:TABLE|DATABASE|INDEX)/i, confidence: 0.99 },
          { regex: /TRUNCATE\s+/i, confidence: 0.95 },
          { regex: /DELETE\s+FROM\s+\w+(?!\s+WHERE)/i, confidence: 0.9 }
        ],
        baseRisk: 0.8,
        riskFactors: {
          drop: (_, text) => /DROP/.test(text) ? 0.5 : 0,
          truncate: (_, text) => /TRUNCATE/.test(text) ? 0.4 : 0,
          production: () => process.env.NODE_ENV === 'production' ? 0.5 : 0
        }
      },

      env_modification: {
        patterns: [
          { regex: /(?:edit|modify|create|update).*\.env/i, confidence: 0.95 },
          { regex: /export\s+(\w+)=/i, confidence: 0.7 },
          { regex: /process\.env\.(\w+)\s*=/i, confidence: 0.9 }
        ],
        baseRisk: 0.7,
        riskFactors: {
          secret_key: (_, text) => /(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL)/i.test(text) ? 0.3 : 0,
          api_key: (_, text) => /API[_-]?KEY/i.test(text) ? 0.2 : 0
        }
      },

      approval_prompt: {
        patterns: [
          { regex: /Do you want to (?:proceed|continue)\??/i, confidence: 0.95 },
          { regex: /\[Y\/n\]/i, confidence: 0.9 },
          { regex: /Press (?:y|enter) to continue/i, confidence: 0.9 },
          { regex: /Approve\?/i, confidence: 0.95 },
          { regex: /Are you sure\?/i, confidence: 0.85 }
        ],
        baseRisk: 0.5
      }
    };

    // Dangerous command patterns that should always flag
    this.dangerousPatterns = [
      { pattern: /rm\s+-rf\s+\/(?!\s|$)/i, severity: 'critical', reason: 'Recursive delete from root' },
      { pattern: />\s*\/dev\/sd[a-z]/i, severity: 'critical', reason: 'Direct disk write' },
      { pattern: /mkfs\./i, severity: 'critical', reason: 'Filesystem format' },
      { pattern: /dd\s+.*of=\/dev/i, severity: 'critical', reason: 'Direct disk write' },
      { pattern: /:(){ :|:& };:/i, severity: 'critical', reason: 'Fork bomb' },
      { pattern: /chmod\s+777\s+\//i, severity: 'high', reason: 'Insecure root permissions' },
      { pattern: /curl.*\|\s*sudo/i, severity: 'high', reason: 'Piping to sudo' },
      { pattern: /eval\s*\(\s*\$\{?[A-Z_]+/i, severity: 'high', reason: 'Eval with env variable' },
      { pattern: /base64\s+-d.*\|\s*(?:bash|sh)/i, severity: 'high', reason: 'Base64 decode to shell' }
    ];
  }

  /**
   * Detect and analyze action from text
   */
  detect(text) {
    const results = [];

    for (const [actionType, def] of Object.entries(this.actionDefs)) {
      for (const patternDef of def.patterns) {
        const match = text.match(patternDef.regex);
        if (match) {
          const target = match[1] || '';
          const confidence = patternDef.confidence;
          
          // Calculate risk score
          const riskScore = this.calculateRisk(actionType, target, text, def);
          
          results.push({
            type: actionType,
            target,
            confidence,
            riskScore,
            riskLevel: this.riskLevel(riskScore),
            raw: match[0],
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // Check for dangerous patterns
    const dangers = this.checkDangerous(text);
    if (dangers.length > 0) {
      results.push(...dangers.map(d => ({
        type: 'dangerous_command',
        target: d.match,
        confidence: 1.0,
        riskScore: d.severity === 'critical' ? 1.0 : 0.9,
        riskLevel: 'critical',
        reason: d.reason,
        raw: d.match,
        timestamp: new Date().toISOString()
      })));
    }

    // Sort by confidence and return best match
    results.sort((a, b) => b.confidence - a.confidence);
    
    if (results.length > 0) {
      this.recordAction(results[0]);
      return results[0];
    }

    return null;
  }

  /**
   * Calculate risk score for an action
   */
  calculateRisk(actionType, target, text, def) {
    let risk = def.baseRisk || 0.5;

    if (def.riskFactors) {
      for (const [factorName, factorFn] of Object.entries(def.riskFactors)) {
        try {
          const factorRisk = factorFn(target, text, this.fileStats);
          risk += factorRisk;
        } catch (e) {
          // Skip failed risk factors
        }
      }
    }

    // Clamp to 0-1
    return Math.max(0, Math.min(1, risk));
  }

  /**
   * Convert risk score to level
   */
  riskLevel(score) {
    if (score >= 0.8) return 'critical';
    if (score >= 0.6) return 'high';
    if (score >= 0.4) return 'medium';
    if (score >= 0.2) return 'low';
    return 'minimal';
  }

  /**
   * Check for dangerous patterns
   */
  checkDangerous(text) {
    const found = [];
    
    for (const { pattern, severity, reason } of this.dangerousPatterns) {
      const match = text.match(pattern);
      if (match) {
        found.push({ match: match[0], severity, reason });
      }
    }

    return found;
  }

  /**
   * Record action for learning/stats
   */
  recordAction(action) {
    this.history.push(action);
    
    // Track file statistics
    if (action.target && action.type.startsWith('file_')) {
      const stats = this.fileStats.get(action.target) || { creates: 0, edits: 0, deletes: 0 };
      
      if (action.type === 'file_create') stats.creates++;
      if (action.type === 'file_edit') stats.edits++;
      if (action.type === 'file_delete') stats.deletes++;
      
      this.fileStats.set(action.target, stats);
    }

    // Track command statistics
    if (action.type === 'terminal_command') {
      const cmd = action.target.split(' ')[0];
      const count = this.commandStats.get(cmd) || 0;
      this.commandStats.set(cmd, count + 1);
    }

    // Trim history to last 1000 actions
    if (this.history.length > 1000) {
      this.history = this.history.slice(-1000);
    }
  }

  /**
   * Get session insights
   */
  getInsights() {
    const byType = {};
    const byRisk = { critical: 0, high: 0, medium: 0, low: 0, minimal: 0 };
    
    for (const action of this.history) {
      byType[action.type] = (byType[action.type] || 0) + 1;
      byRisk[action.riskLevel] = (byRisk[action.riskLevel] || 0) + 1;
    }

    const mostEdited = [...this.fileStats.entries()]
      .sort((a, b) => b[1].edits - a[1].edits)
      .slice(0, 10);

    const mostUsedCommands = [...this.commandStats.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      totalActions: this.history.length,
      byType,
      byRisk,
      mostEdited,
      mostUsedCommands,
      averageRisk: this.history.length > 0
        ? this.history.reduce((sum, a) => sum + a.riskScore, 0) / this.history.length
        : 0
    };
  }

  /**
   * Suggest whether to auto-accept based on history and patterns
   */
  shouldAutoAccept(action, config) {
    const modeConfig = config[config.mode];
    
    // Always require approval for dangerous commands
    if (action.type === 'dangerous_command' || action.riskLevel === 'critical') {
      return { accept: false, reason: 'Critical risk detected', confidence: 1.0 };
    }

    // Check explicit require_approval list
    if (modeConfig.require_approval?.includes(action.type)) {
      return { accept: false, reason: 'Action type requires approval', confidence: 0.9 };
    }

    // Check auto_accept list
    if (modeConfig.auto_accept?.includes(action.type)) {
      // But still check risk level
      if (action.riskScore > 0.7) {
        return { 
          accept: false, 
          reason: `High risk score: ${action.riskScore.toFixed(2)}`,
          confidence: action.riskScore 
        };
      }
      return { accept: true, reason: 'Action type auto-accepted', confidence: 0.9 };
    }

    // Check quick_confirm list (copilot mode)
    if (modeConfig.quick_confirm?.includes(action.type)) {
      return { 
        accept: 'quick_confirm', 
        reason: 'Quick confirmation',
        timeout: modeConfig.timeout_seconds || 2 
      };
    }

    // Default based on risk
    return {
      accept: action.riskScore < 0.5,
      reason: `Risk score: ${action.riskScore.toFixed(2)}`,
      confidence: 1 - action.riskScore
    };
  }
}
