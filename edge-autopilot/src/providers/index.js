/**
 * AI Provider Abstraction Layer
 *
 * Supports multiple AI providers:
 * - claude: Anthropic Claude (via Claude Code CLI)
 * - openai: OpenAI GPT models (via API)
 */

import { spawn } from 'child_process';

/**
 * Available providers and their model mappings
 */
export const PROVIDERS = {
  claude: {
    name: 'Claude',
    models: {
      opus: 'claude-opus-4-5-20250514',
      sonnet: 'claude-sonnet-4-20250514',
      haiku: 'claude-haiku-3-5-20250615',
      // Aliases
      default: 'sonnet',
      fast: 'haiku',
      best: 'opus'
    },
    defaultModel: 'sonnet'
  },
  openai: {
    name: 'OpenAI',
    models: {
      'gpt-4o': 'gpt-4o',
      'gpt-4-turbo': 'gpt-4-turbo',
      'gpt-4': 'gpt-4',
      'gpt-3.5-turbo': 'gpt-3.5-turbo',
      'o1': 'o1',
      'o1-mini': 'o1-mini',
      // Aliases for consistency with claude naming
      opus: 'gpt-4o',
      sonnet: 'gpt-4-turbo',
      haiku: 'gpt-3.5-turbo',
      default: 'gpt-4o',
      fast: 'gpt-3.5-turbo',
      best: 'gpt-4o'
    },
    defaultModel: 'gpt-4o'
  }
};

/**
 * Resolve model name to actual model ID
 */
export function resolveModel(provider, modelName) {
  const providerConfig = PROVIDERS[provider];
  if (!providerConfig) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  if (!modelName) {
    return providerConfig.models[providerConfig.defaultModel];
  }

  // Check if it's an alias or direct model name
  const resolved = providerConfig.models[modelName] || modelName;
  return resolved;
}

/**
 * Get provider info for display
 */
export function getProviderInfo(provider, model) {
  const providerConfig = PROVIDERS[provider];
  if (!providerConfig) {
    return { provider: 'unknown', model: model || 'default' };
  }

  const resolvedModel = resolveModel(provider, model);
  return {
    provider: providerConfig.name,
    model: resolvedModel
  };
}

/**
 * Claude Provider - Uses Claude Code CLI
 */
export class ClaudeProvider {
  constructor(config) {
    this.config = config;
  }

  async runTask(prompt, options = {}) {
    const { model, workDir, onOutput, onError } = options;

    return new Promise((resolve, reject) => {
      const args = ['-p', '--dangerously-skip-permissions'];

      if (model) {
        args.push('--model', model);
      }

      args.push(prompt);

      const proc = spawn('claude', args, {
        cwd: workDir || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '1' }
      });

      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');

      proc.stdout.on('data', (data) => {
        if (onOutput) onOutput(data);
        process.stdout.write(data);
      });

      proc.stderr.on('data', (data) => {
        if (onError) onError(data);
        process.stderr.write(data);
      });

      proc.on('close', (code) => {
        resolve({ code, provider: 'claude' });
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }
}

/**
 * OpenAI Provider - Uses OpenAI API directly
 */
export class OpenAIProvider {
  constructor(config) {
    this.config = config;
    this.apiKey = process.env.OPENAI_API_KEY;

    if (!this.apiKey) {
      console.warn('Warning: OPENAI_API_KEY not set. OpenAI provider will not work.');
    }
  }

  async runTask(prompt, options = {}) {
    const { model = 'gpt-4o', workDir, onOutput, onError } = options;

    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required for OpenAI provider');
    }

    try {
      // Build the system prompt for code tasks
      const systemPrompt = this.buildSystemPrompt(workDir);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          max_tokens: 16384,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';

      if (onOutput) onOutput(content);
      process.stdout.write(content + '\n');

      // Parse any code blocks and execute them if they look like shell commands
      await this.executeCodeBlocks(content, workDir, onOutput, onError);

      return { code: 0, provider: 'openai', response: content };
    } catch (error) {
      if (onError) onError(error.message);
      throw error;
    }
  }

  buildSystemPrompt(workDir) {
    return `You are an expert software engineer assistant. You help with coding tasks by:
1. Analyzing code and requirements
2. Writing high-quality code
3. Explaining your changes

When you need to make file changes, output them in this format:
\`\`\`file:path/to/file.ts
// file contents here
\`\`\`

When you need to run shell commands, output them in this format:
\`\`\`bash
command here
\`\`\`

Current working directory: ${workDir || process.cwd()}

Be concise and focus on completing the task. Don't ask clarifying questions - make reasonable assumptions and proceed.`;
  }

  async executeCodeBlocks(content, workDir, onOutput, onError) {
    // Extract bash code blocks
    const bashRegex = /```bash\n([\s\S]*?)```/g;
    let match;

    while ((match = bashRegex.exec(content)) !== null) {
      const command = match[1].trim();

      // Skip dangerous commands
      if (this.isDangerousCommand(command)) {
        const msg = `Skipping potentially dangerous command: ${command}\n`;
        if (onError) onError(msg);
        process.stderr.write(msg);
        continue;
      }

      try {
        await this.executeCommand(command, workDir, onOutput, onError);
      } catch (err) {
        if (onError) onError(`Command failed: ${err.message}\n`);
      }
    }

    // Extract file blocks and write them
    const fileRegex = /```file:([^\n]+)\n([\s\S]*?)```/g;
    const fs = await import('fs/promises');
    const path = await import('path');

    while ((match = fileRegex.exec(content)) !== null) {
      const filePath = match[1].trim();
      const fileContent = match[2];

      try {
        const fullPath = path.default.isAbsolute(filePath)
          ? filePath
          : path.default.join(workDir || process.cwd(), filePath);

        // Ensure directory exists
        await fs.mkdir(path.default.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, fileContent);

        const msg = `Wrote file: ${filePath}\n`;
        if (onOutput) onOutput(msg);
        process.stdout.write(msg);
      } catch (err) {
        if (onError) onError(`Failed to write ${filePath}: ${err.message}\n`);
      }
    }
  }

  isDangerousCommand(command) {
    const dangerous = [
      /rm\s+-rf\s+[\/~]/,
      /rm\s+-rf\s+\*/,
      />\s*\/dev\/sd/,
      /mkfs\./,
      /dd\s+if=/,
      /:(){ :|:& };:/,
      /chmod\s+-R\s+777\s+\//,
      /curl.*\|\s*sh/,
      /wget.*\|\s*sh/
    ];

    return dangerous.some(pattern => pattern.test(command));
  }

  async executeCommand(command, workDir, onOutput, onError) {
    return new Promise((resolve, reject) => {
      const proc = spawn('sh', ['-c', command], {
        cwd: workDir || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
      });

      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');

      proc.stdout.on('data', (data) => {
        if (onOutput) onOutput(data);
        process.stdout.write(data);
      });

      proc.stderr.on('data', (data) => {
        if (onError) onError(data);
        process.stderr.write(data);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ code });
        } else {
          reject(new Error(`Command exited with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }
}

/**
 * Create a provider instance based on config
 */
export function createProvider(provider, config = {}) {
  switch (provider) {
    case 'claude':
      return new ClaudeProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    default:
      throw new Error(`Unknown provider: ${provider}. Available: claude, openai`);
  }
}
