import { describe, expect, it, vi } from 'vitest';
import { ConsoleLogger } from '../../src/telemetry/logger.ts';

describe('ConsoleLogger', () => {
  it('writes JSON lines with all metadata', () => {
    const allWrites: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s: any) => {
      allWrites.push(s.toString());
      return true;
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s: any) => {
      allWrites.push(s.toString());
      return true;
    });

    const logger = new ConsoleLogger({ service: 'sail-mem-test' });
    logger.info('hello', { user: 'alice' });
    logger.warn('careful');
    logger.error('boom');

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    const written = allWrites.join('');
    expect(written).toContain('"msg":"hello"');
    expect(written).toContain('"user":"alice"');
    expect(written).toContain('"msg":"careful"');
    expect(written).toContain('"msg":"boom"');
  });

  it('respects minLevel', () => {
    const allWrites: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s: any) => {
      allWrites.push('STDOUT:' + s.toString());
      return true;
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s: any) => {
      allWrites.push('STDERR:' + s.toString());
      return true;
    });
    const logger = new ConsoleLogger({}, 'warn');
    logger.info('skipped at warn');
    logger.warn('kept at warn');
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    const out = allWrites.join('');
    expect(out).not.toContain('skipped');
    expect(out).toContain('kept');
  });

  it('child() inherits base metadata', () => {
    const writes: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s: any) => {
      writes.push(s.toString());
      return true;
    });
    const parent = new ConsoleLogger({ service: 'sail' });
    const child = parent.child({ component: 'mcp' });
    child.info('hi');
    stdoutSpy.mockRestore();
    expect(writes.join('')).toContain('"service":"sail"');
    expect(writes.join('')).toContain('"component":"mcp"');
  });
});
