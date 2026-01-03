import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { existsSync } from 'fs';

/**
 * Load and validate configuration
 */
export async function loadConfig(configPath) {
  const defaultConfig = {
    mode: 'copilot',
    autopilot: {
      auto_accept: ['file_create', 'file_edit', 'terminal_command'],
      require_approval: ['file_delete', 'git_push', 'database_migration'],
      stop_on: {
        error_count: 3,
        unknown_action: true
      },
      notify: {
        on_complete: true,
        on_error: true,
        method: 'system'
      }
    },
    copilot: {
      auto_accept: ['file_create', 'file_edit'],
      quick_confirm: ['terminal_command', 'npm_install'],
      require_approval: ['file_delete', 'git_push']
    },
    tasks: {
      source: './tasks/',
      on_complete: 'next',
      timeout: 30
    },
    context: {
      project_standards: '',
      current_focus: '',
      error_handling: ''
    },
    logging: {
      directory: './logs/',
      level: 'info',
      include_prompts: true,
      include_responses: true
    },
    safety: {
      protected_paths: ['.env', '.env.*', 'secrets/'],
      max_changes_per_session: 50,
      max_autonomous_hours: 8,
      dry_run: false
    }
  };

  if (!existsSync(configPath)) {
    console.log(`Config not found at ${configPath}, using defaults`);
    return defaultConfig;
  }

  try {
    const content = await readFile(configPath, 'utf-8');
    const userConfig = parse(content);
    
    // Deep merge with defaults
    return deepMerge(defaultConfig, userConfig);
  } catch (error) {
    console.error(`Error loading config: ${error.message}`);
    return defaultConfig;
  }
}

/**
 * Deep merge two objects
 */
function deepMerge(target, source) {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
}
