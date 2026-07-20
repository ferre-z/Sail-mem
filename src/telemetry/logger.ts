export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogMeta {
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, meta?: LogMeta): void;
  info(msg: string, meta?: LogMeta): void;
  warn(msg: string, meta?: LogMeta): void;
  error(msg: string, meta?: LogMeta): void;
  child(meta: LogMeta): Logger;
}

export interface MetricsCollector {
  incrementCounter(name: string, tags?: LogMeta): void;
  recordTiming(name: string, ms: number, tags?: LogMeta): void;
  recordGauge(name: string, value: number, tags?: LogMeta): void;
}

export class ConsoleLogger implements Logger {
  constructor(private readonly base: LogMeta = {}, private readonly minLevel: LogLevel = 'info') {}

  child(meta: LogMeta): Logger {
    return new ConsoleLogger({ ...this.base, ...meta }, this.minLevel);
  }

  private write(level: LogLevel, msg: string, meta?: LogMeta): void {
    if (!shouldEmit(level, this.minLevel)) return;
    const line = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...this.base,
      ...meta,
    };
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(JSON.stringify(line) + '\n');
  }

  debug(msg: string, meta?: LogMeta): void { this.write('debug', msg, meta); }
  info(msg: string, meta?: LogMeta): void { this.write('info', msg, meta); }
  warn(msg: string, meta?: LogMeta): void { this.write('warn', msg, meta); }
  error(msg: string, meta?: LogMeta): void { this.write('error', msg, meta); }
}

export class NoopLogger implements Logger {
  child(): Logger { return this; }
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

export class NoopMetrics implements MetricsCollector {
  incrementCounter(): void {}
  recordTiming(): void {}
  recordGauge(): void {}
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function shouldEmit(level: LogLevel, min: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[min];
}
