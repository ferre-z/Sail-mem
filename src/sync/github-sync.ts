import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { getConfig } from '../config/index.js';
import { MemoryStore } from '../core/memory-store.js';
import { BankManager } from '../core/bank-manager.js';
import { createSnapshot, MemorySnapshot } from './snapshot.js';

const execAsync = promisify(exec);

export class GitHubSync {
  private memoryStore: MemoryStore;
  private bankManager: BankManager;
  private repoPath: string;

  constructor() {
    this.memoryStore = new MemoryStore();
    this.bankManager = new BankManager();
    this.repoPath = getConfig().sync.repoPath;
  }

  async initialize(): Promise<void> {
    // Ensure repo directory exists
    await mkdir(this.repoPath, { recursive: true });

    // Initialize git repo if not exists
    try {
      await access(join(this.repoPath, '.git'));
    } catch {
      await execAsync('git init', { cwd: this.repoPath });
      await execAsync('git checkout -b main', { cwd: this.repoPath });
    }
  }

  async createSnapshot(bankId: string): Promise<MemorySnapshot> {
    const memories = await this.memoryStore.listByBank(bankId);
    const bank = await this.bankManager.getById(bankId);

    return createSnapshot(bankId, memories, bank || undefined);
  }

  async exportMemories(bankId: string): Promise<string> {
    const snapshot = await this.createSnapshot(bankId);
    return JSON.stringify(snapshot, null, 2);
  }

  async importMemories(json: string): Promise<void> {
    const snapshot = JSON.parse(json);

    // Import bank if exists
    if (snapshot.bank) {
      await this.bankManager.create({
        name: snapshot.bank.name,
        level: snapshot.bank.level,
        parentId: snapshot.bank.parentId,
        config: snapshot.bank.config,
      });
    }

    // Import memories
    for (const memory of snapshot.memories) {
      await this.memoryStore.create({
        bankId: memory.bankId,
        type: memory.type,
        content: memory.content,
        metadata: memory.metadata,
        embedding: memory.embedding,
      });
    }
  }

  async commit(bankId: string, message?: string): Promise<string> {
    const config = getConfig().sync;
    const snapshotFile = join(this.repoPath, `${bankId}.json`);

    // Export and write snapshot
    const json = await this.exportMemories(bankId);
    await writeFile(snapshotFile, json);

    // Git operations
    await execAsync('git add -A', { cwd: this.repoPath });

    const commitMessage = message || `${config.commitMessage} - ${bankId}`;
    await execAsync(`git commit -m "${commitMessage}"`, { cwd: this.repoPath });

    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: this.repoPath });
    return stdout.trim();
  }

  async pull(): Promise<void> {
    await execAsync('git pull origin main', { cwd: this.repoPath });
  }

  async push(): Promise<void> {
    await execAsync('git push origin main', { cwd: this.repoPath });
  }

  async sync(bankId: string): Promise<void> {
    await this.pull();
    await this.commit(bankId);
    await this.push();
  }

  async getHistory(
    bankId: string,
    limit = 10
  ): Promise<
    Array<{
      hash: string;
      message: string;
      date: string;
    }>
  > {
    const { stdout } = await execAsync(`git log --oneline -${limit} -- ${bankId}.json`, {
      cwd: this.repoPath,
    });

    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line: string) => {
        const [hash, ...messageParts] = line.split(' ');
        return {
          hash,
          message: messageParts.join(' '),
          date: new Date().toISOString(),
        };
      });
  }

  async restore(bankId: string, hash: string): Promise<void> {
    await execAsync(`git checkout ${hash} -- ${bankId}.json`, { cwd: this.repoPath });
    const json = await readFile(join(this.repoPath, `${bankId}.json`), 'utf-8');
    await this.importMemories(json);
  }
}
