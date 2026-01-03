import { readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname } from 'path';
import { parse, stringify } from 'yaml';

/**
 * TaskQueue - Manages tasks for the supervisor
 */
export class TaskQueue {
  constructor(source) {
    this.source = source;
    this.tasks = [];
    this.loaded = false;
  }

  /**
   * Load tasks from file or directory
   */
  async load() {
    if (this.loaded) return;
    
    if (!existsSync(this.source)) {
      console.log(`Task source not found: ${this.source}`);
      this.tasks = [];
      this.loaded = true;
      return;
    }
    
    const stat = await import('fs').then(fs => 
      new Promise(resolve => fs.stat(this.source, (_, s) => resolve(s)))
    );
    
    if (stat?.isDirectory()) {
      // Load all YAML/JSON files from directory
      const files = await readdir(this.source);
      const taskFiles = files.filter(f => 
        ['.yaml', '.yml', '.json'].includes(extname(f).toLowerCase())
      );
      
      for (const file of taskFiles) {
        const content = await readFile(join(this.source, file), 'utf-8');
        const tasks = this.parseTaskFile(content, file);
        this.tasks.push(...tasks);
      }
    } else {
      // Single file
      const content = await readFile(this.source, 'utf-8');
      this.tasks = this.parseTaskFile(content, this.source);
    }
    
    // Sort by priority
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    this.tasks.sort((a, b) => 
      (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1)
    );
    
    // Assign IDs if not present
    this.tasks = this.tasks.map((task, i) => ({
      id: task.id || `task-${i + 1}`,
      status: 'pending',
      ...task
    }));
    
    this.loaded = true;
  }

  /**
   * Parse a task file
   */
  parseTaskFile(content, filename) {
    try {
      if (filename.endsWith('.json')) {
        const data = JSON.parse(content);
        return Array.isArray(data) ? data : [data];
      } else {
        const data = parse(content);
        if (Array.isArray(data)) return data;
        if (data?.tasks) return data.tasks;
        return [data];
      }
    } catch (error) {
      console.error(`Error parsing ${filename}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get all pending tasks
   */
  async getTasks() {
    await this.load();
    return this.tasks.filter(t => t.status === 'pending');
  }

  /**
   * Add a new task
   */
  async addTask(task) {
    await this.load();
    
    const newTask = {
      id: `task-${Date.now()}`,
      status: 'pending',
      priority: 'normal',
      created: new Date().toISOString(),
      ...task
    };
    
    this.tasks.push(newTask);
    await this.save();
    
    return newTask;
  }

  /**
   * Mark a task as complete
   */
  async markComplete(taskId) {
    await this.load();
    
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'complete';
      task.completedAt = new Date().toISOString();
      await this.save();
    }
  }

  /**
   * Mark a task as failed
   */
  async markFailed(taskId, error) {
    await this.load();
    
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'failed';
      task.error = error;
      task.failedAt = new Date().toISOString();
      await this.save();
    }
  }

  /**
   * Save tasks back to file
   */
  async save() {
    const content = stringify({ tasks: this.tasks });
    
    if (this.source.endsWith('.json')) {
      await writeFile(this.source, JSON.stringify({ tasks: this.tasks }, null, 2));
    } else {
      await writeFile(
        this.source.replace(/\.(yaml|yml)$/, '') + '.yaml',
        content
      );
    }
  }

  /**
   * Get queue statistics
   */
  async getStats() {
    await this.load();
    
    return {
      total: this.tasks.length,
      pending: this.tasks.filter(t => t.status === 'pending').length,
      complete: this.tasks.filter(t => t.status === 'complete').length,
      failed: this.tasks.filter(t => t.status === 'failed').length
    };
  }
}
