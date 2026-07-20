import { BankLevel, BankConfig } from '../db/schema.js';

export interface Bank {
  id: string;
  name: string;
  level: BankLevel;
  parentId?: string;
  config: BankConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBankInput {
  name: string;
  level: BankLevel;
  parentId?: string;
  config?: Partial<BankConfig>;
}

export interface BankHierarchy {
  bank: Bank;
  children: BankHierarchy[];
  path: string[];
}
