export class SailMemError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = 'SailMemError';
    this.code = code;
    this.cause = cause;
  }
}

export class ValidationError extends SailMemError {
  constructor(message: string, cause?: unknown) {
    super(message, 'VALIDATION_ERROR', cause);
    this.name = 'ValidationError';
  }
}

export class StorageError extends SailMemError {
  constructor(message: string, cause?: unknown) {
    super(message, 'STORAGE_ERROR', cause);
    this.name = 'StorageError';
  }
}

export class EmbeddingError extends SailMemError {
  readonly status?: number;

  constructor(message: string, status?: number, cause?: unknown) {
    super(message, 'EMBEDDING_ERROR', cause);
    this.name = 'EmbeddingError';
    this.status = status;
  }
}

export class SyncError extends SailMemError {
  constructor(message: string, cause?: unknown) {
    super(message, 'SYNC_ERROR', cause);
    this.name = 'SyncError';
  }
}

export class NotFoundError extends SailMemError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}
