import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { getConfig } from '../config/index.js';
import { MemoryStore } from '../core/memory-store.js';
import { BankManager } from '../core/bank-manager.js';
import { createSnapshot, MemorySnapshot } from './snapshot.js';
import { SyncError, ValidationError } from '../errors.js';

const execFileAsync = promisify(execFile);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GIT_HASH_RE = /^[a-f0-9]{7,40}$/i;

function assertValidBankId(bankId: string): void {
  if (!UUID_RE.test(bankId)) {
    throw new ValidationError(`Invalid bankId: ${bankId}`);
  }
}

function assertValidHash(hash: string): void {
  if (!GIT_HASH_RE.test(hash)) {
    throw new ValidationError(`Invalid git hash: ${hash}`);
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 10;
  if (limit > 1000) return 1000;
  return Math.floor(limit);
}

function sanitizeCommitMessage(message: string): string {
  return message.replace(/[\x00-\x1f\x7f"\\`$]/g, '').slice(0, 200);
}

export interface GitHubSyncDeps {
  memoryStore?: MemoryStore;
  bankManager?: BankManager;
  repoPath?: string;
  exec?: typeof execFileAsync;
}

export class GitHubSync {
  private memoryStore: MemoryStore;
  private bankManager: BankManager;
  private repoPath: string;
  private exec: typeof execFileAsync;

  constructor(deps: GitHubSyncDeps = {}) {
    this.memoryStore = deps.memoryStore ?? new MemoryStore();
    this.bankManager = deps.bankManager ?? new BankManager();
    this.repoPath = deps.repoPath ?? getConfig().sync.repoPath;
    this.exec = deps.exec ?? execFileAsync;
  }

  async initialize(): Promise<void> {
    await mkdir(this.repoPath, { recursive: true });

    try {
      await access(join(this.repoPath, '.git'));
    } catch {
      await this.exec('git', ['init'], { cwd: this.repoPath });
      await this.exec('git', ['checkout', '-b', 'main'], { cwd: this.repoPath });
    }
  }

  async createSnapshot(bankId: string): Promise<MemorySnapshot> {
    assertValidBankId(bankId);
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

    if (snapshot.bank) {
      await this.bankManager.create({
        name: snapshot.bank.name,
        level: snapshot.bank.level,
        parentId: snapshot.bank.parentId,
        config: snapshot.bank.config,
      });
    }

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
    assertValidBankId(bankId);
    const config = getConfig().sync;
    const snapshotFile = join(this.repoPath, `${bankId}.json`);

    const json = await this.exportMemories(bankId);
    await writeFile(snapshotFile, json);

    await this.exec('git', ['add', '-A'], { cwd: this.repoPath });

    const commitMessage = sanitizeCommitMessage(
      message || `${config.commitMessage} - ${bankId}`
    );

    await this.exec('git', ['commit', '-m', commitMessage], { cwd: this.repoPath });

    const { stdout } = await this.exec('git', ['rev-parse', 'HEAD'], {
      cwd: this.repoPath,
    });
    return stdout.trim();
  }

  async pull(): Promise<void> {
    try {
      await this.exec('git', ['pull', 'origin', 'main'], { cwd: this.repoPath });
    } catch (err) {
      throw new SyncError(
        `Failed to pull from origin: ${(err as Error).message}. ` +
        `Ensure a remote is configured.`,
        err
      );
    }
  }

  async push(): Promise<void> {
    try {
      await this.exec('git', ['push', 'origin', 'main'], { cwd: this.repoPath });
    } catch (err) {
      throw new SyncError(
        `Failed to push to origin: ${(err as Error).message}. ` +
        `Ensure a remote is configured and you have push access.`,
        err
      );
    }
  }

  async sync(bankId: string): Promise<void> {
    assertValidBankId(bankId);
    await this.pull();
    await this.commit(bankId);
    await this.push();
  }

  async getHistory(
    bankId: string,
    limit = 10
  ): Promise<Array<{ hash: string; message: string; date: string }>> {
    assertValidBankId(bankId);
    const safeLimit = clampLimit(limit);

    const { stdout } = await this.exec(
      'git',
      ['log', '--oneline', `-${safeLimit}`, '--', `${bankId}.json`],
      { cwd: this.repoPath }
    );

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
    assertValidBankId(bankId);
    assertValidHash(hash);

    await this.exec('git', ['checkout', hash, '--', `${bankId}.json`], {
      cwd: this.repoPath,
    });
    const json = await readFile(join(this.repoPath, `${bankId}.json`), 'utf-8');
    await this.importMemories(json);
  }
}
