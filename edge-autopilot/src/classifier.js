/**
 * ActionClassifier - Detects and classifies actions in Claude Code output
 * 
 * Claude Code has specific patterns when it asks for approval.
 * This classifier recognizes those patterns and categorizes them.
 */
export class ActionClassifier {
  constructor() {
    // Patterns that indicate Claude Code is requesting approval
    this.patterns = [
      {
        type: 'file_create',
        patterns: [
          /Create(?:ing)?\s+(?:new\s+)?file[:\s]+(.+)/i,
          /Write(?:ing)?\s+(?:to\s+)?file[:\s]+(.+)/i,
          /Creating\s+(.+\.(?:js|ts|tsx|jsx|json|yaml|yml|md|css|html))/i
        ],
        extract: (match) => ({ file: match[1]?.trim() })
      },
      {
        type: 'file_edit',
        patterns: [
          /Edit(?:ing)?\s+file[:\s]+(.+)/i,
          /Modify(?:ing)?\s+(.+)/i,
          /Update(?:ing)?\s+(.+\.(?:js|ts|tsx|jsx|json|yaml|yml|md|css|html))/i,
          /str_replace.*in\s+(.+)/i
        ],
        extract: (match) => ({ file: match[1]?.trim() })
      },
      {
        type: 'file_delete',
        patterns: [
          /Delete(?:ing)?\s+file[:\s]+(.+)/i,
          /Remove(?:ing)?\s+file[:\s]+(.+)/i,
          /rm\s+(?:-rf?\s+)?(.+)/i
        ],
        extract: (match) => ({ file: match[1]?.trim() })
      },
      {
        type: 'terminal_command',
        patterns: [
          /Run(?:ning)?\s+command[:\s]+(.+)/i,
          /Execute(?:ing)?[:\s]+(.+)/i,
          /\$\s+(.+)/,
          /bash[:\s]+(.+)/i
        ],
        extract: (match) => ({ command: match[1]?.trim() })
      },
      {
        type: 'npm_install',
        patterns: [
          /npm\s+install\s+(.+)/i,
          /npm\s+i\s+(.+)/i,
          /yarn\s+add\s+(.+)/i,
          /pnpm\s+add\s+(.+)/i
        ],
        extract: (match) => ({ packages: match[1]?.trim() })
      },
      {
        type: 'package_removal',
        patterns: [
          /npm\s+uninstall\s+(.+)/i,
          /npm\s+remove\s+(.+)/i,
          /yarn\s+remove\s+(.+)/i
        ],
        extract: (match) => ({ packages: match[1]?.trim() })
      },
      {
        type: 'git_add',
        patterns: [
          /git\s+add\s+(.+)/i,
          /Stage(?:ing)?\s+files?/i
        ],
        extract: (match) => ({ files: match[1]?.trim() })
      },
      {
        type: 'git_commit',
        patterns: [
          /git\s+commit\s+(?:-m\s+)?['""]?(.+)['""]?/i,
          /Commit(?:ting)?[:\s]+(.+)/i
        ],
        extract: (match) => ({ message: match[1]?.trim() })
      },
      {
        type: 'git_push',
        patterns: [
          /git\s+push/i,
          /Push(?:ing)?\s+to\s+(?:remote|origin)/i
        ],
        extract: () => ({})
      },
      {
        type: 'database_migration',
        patterns: [
          /(?:run(?:ning)?|execute(?:ing)?)\s+migration/i,
          /migrate(?:ing)?\s+database/i,
          /npx\s+prisma\s+migrate/i,
          /supabase\s+(?:db\s+)?(?:push|migrate)/i
        ],
        extract: () => ({})
      },
      {
        type: 'env_modification',
        patterns: [
          /(?:edit|modify|update|create)(?:ing)?\s+\.env/i,
          /environment\s+variable/i
        ],
        extract: () => ({})
      },
      {
        type: 'approval_prompt',
        patterns: [
          /Do you want to proceed\?/i,
          /Continue\?\s*\[Y\/n\]/i,
          /Press\s+(?:y|enter)\s+to\s+continue/i,
          /Approve\?/i
        ],
        extract: () => ({})
      }
    ];
  }

  /**
   * Detect action type from text
   * @param {string} text - Output text to analyze
   * @returns {object|null} - Detected action or null
   */
  detect(text) {
    for (const actionDef of this.patterns) {
      for (const pattern of actionDef.patterns) {
        const match = text.match(pattern);
        if (match) {
          return {
            type: actionDef.type,
            details: actionDef.extract(match),
            raw: match[0],
            timestamp: new Date().toISOString()
          };
        }
      }
    }
    return null;
  }

  /**
   * Check if text contains any dangerous patterns
   * @param {string} text - Text to check
   * @returns {object|null} - Warning info or null
   */
  checkDangerous(text) {
    const dangerousPatterns = [
      { pattern: /rm\s+-rf\s+\/(?!\s|$)/i, reason: 'Dangerous rm command' },
      { pattern: /DROP\s+(?:TABLE|DATABASE)/i, reason: 'SQL DROP command' },
      { pattern: /DELETE\s+FROM\s+\w+(?!\s+WHERE)/i, reason: 'DELETE without WHERE' },
      { pattern: /chmod\s+777/i, reason: 'Insecure permissions' },
      { pattern: /curl.*\|\s*(?:bash|sh)/i, reason: 'Pipe to shell' },
      { pattern: /eval\s*\(/i, reason: 'Eval usage' }
    ];

    for (const { pattern, reason } of dangerousPatterns) {
      if (pattern.test(text)) {
        return { dangerous: true, reason, match: text.match(pattern)?.[0] };
      }
    }

    return null;
  }

  /**
   * Check if a file path is protected
   * @param {string} filePath - Path to check
   * @param {string[]} protectedPaths - List of protected patterns
   * @returns {boolean}
   */
  isProtectedPath(filePath, protectedPaths = []) {
    return protectedPaths.some(protected => {
      if (protected.includes('*')) {
        const regex = new RegExp(protected.replace(/\*/g, '.*'));
        return regex.test(filePath);
      }
      return filePath.includes(protected);
    });
  }
}
