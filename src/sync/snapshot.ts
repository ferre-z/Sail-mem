import { Memory } from '../types/memory.js';
import { Bank } from '../types/bank.js';

export interface MemorySnapshot {
  version: string;
  timestamp: Date;
  bankId: string;
  bank?: Bank;
  memories: Memory[];
  metadata: {
    exportedBy?: string;
    memoryCount: number;
    checksum?: string;
  };
}

export function createSnapshot(bankId: string, memories: Memory[], bank?: Bank): MemorySnapshot {
  return {
    version: '1.0.0',
    timestamp: new Date(),
    bankId,
    bank,
    memories,
    metadata: {
      memoryCount: memories.length,
    },
  };
}

export function validateSnapshot(snapshot: any): snapshot is MemorySnapshot {
  return (
    snapshot &&
    typeof snapshot.version === 'string' &&
    snapshot.timestamp &&
    typeof snapshot.bankId === 'string' &&
    Array.isArray(snapshot.memories)
  );
}
