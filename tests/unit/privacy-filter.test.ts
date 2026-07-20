import { describe, expect, it } from 'vitest';
import { stripSecrets } from '../../src/capture/privacy-filter.ts';

describe('stripSecrets', () => {
  it('redacts OpenAI keys', () => {
    expect(stripSecrets('here is sk-abc123def456ghi789jkl012mno345pqr')).toBe(
      'here is [REDACTED]'
    );
  });

  it('redacts GitHub personal access tokens', () => {
    expect(stripSecrets('export GITHUB_TOKEN=ghp_abc123def456ghi789jkl012mno345qr')).toContain(
      '[REDACTED]'
    );
  });

  it('redacts AWS access keys', () => {
    expect(stripSecrets('key=AKIAIOSFODNN7EXAMPLE')).toBe('key=[REDACTED]');
  });

  it('redacts JSON env-style kv pairs', () => {
    const input = '{"api_key": "hunter2hunter2hunter2", "name": "Alice"}';
    const out = stripSecrets(input);
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('"name": "Alice"');
  });

  it('redacts PEM private keys', () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ...
-----END RSA PRIVATE KEY-----`;
    expect(stripSecrets(`key=\n${pem}`)).toContain('[REDACTED]');
  });

  it('leaves normal text alone', () => {
    expect(stripSecrets('Alice likes TypeScript and Python')).toBe(
      'Alice likes TypeScript and Python'
    );
  });

  it('handles short inputs without false positives', () => {
    expect(stripSecrets('foo=bar')).toBe('foo=bar');
    expect(stripSecrets('')).toBe('');
  });
});
