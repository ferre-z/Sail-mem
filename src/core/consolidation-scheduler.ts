import { ConsolidationEngine } from './consolidation.js';
import { BankManager } from './bank-manager.js';
import { getConfig } from '../config/index.js';
import { SailMemError } from '../errors.js';

export interface SchedulerOptions {
  consolidation: ConsolidationEngine;
  bankManager?: BankManager;
  intervalMs?: number;
  minEvidenceCount?: number;
  onCycleComplete?: (cycleResult: CycleResult) => Promise<void> | void;
}

export interface CycleResult {
  startedAt: Date;
  endedAt: Date;
  banksProcessed: number;
  candidatesFound: number;
  observationsCreated: number;
  errors: Array<{ bankId: string; error: string }>;
}

export class ConsolidationScheduler {
  private readonly consolidation: ConsolidationEngine;
  private readonly bankManager?: BankManager;
  private readonly intervalMs: number;
  private readonly minEvidenceCount: number;
  private readonly onCycleComplete?: (cycle: CycleResult) => Promise<void> | void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(options: SchedulerOptions) {
    this.consolidation = options.consolidation;
    this.bankManager = options.bankManager;
    this.intervalMs = options.intervalMs ?? getConfig().consolidation.autoIntervalMs;
    this.minEvidenceCount =
      options.minEvidenceCount ?? getConfig().consolidation.minEvidenceCount;
    this.onCycleComplete = options.onCycleComplete;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runCycle().catch((err) => {
        console.error('sail-mem scheduler cycle failed:', err);
      });
    }, this.intervalMs);
    if (typeof this.timer === 'object' && this.timer !== null && 'unref' in this.timer) {
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isActive(): boolean {
    return this.timer !== null;
  }

  async runCycle(): Promise<CycleResult> {
    if (this.isRunning) {
      throw new SailMemError('Consolidation cycle already in progress', 'CONCURRENT_CYCLE');
    }
    this.isRunning = true;
    const startedAt = new Date();
    let banksProcessed = 0;
    let candidatesFound = 0;
    let observationsCreated = 0;
    const errors: Array<{ bankId: string; error: string }> = [];

    try {
      const banks = await this.listBanks();
      for (const bank of banks) {
        try {
          const clusters = await this.consolidation.findConsolidationCandidates(bank.id);
          candidatesFound += clusters.length;
          for (const cluster of clusters) {
            if (cluster.length >= this.minEvidenceCount) {
              await this.consolidation.consolidate(
                bank.id,
                cluster.map((m) => m.id)
              );
              observationsCreated++;
            }
          }
          banksProcessed++;
        } catch (err) {
          errors.push({
            bankId: bank.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const result: CycleResult = {
        startedAt,
        endedAt: new Date(),
        banksProcessed,
        candidatesFound,
        observationsCreated,
        errors,
      };
      if (this.onCycleComplete) {
        await this.onCycleComplete(result);
      }
      return result;
    } finally {
      this.isRunning = false;
    }
  }

  private async listBanks() {
    if (this.bankManager) {
      return this.bankManager.listAll();
    }
    return this.consolidation['memoryStore'] && (await this.consolidation['memoryStore'].listByBank.length)
      ? []
      : [];
  }
}
