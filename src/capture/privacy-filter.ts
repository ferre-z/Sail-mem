export const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'pem-private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { name: 'openai-key',       pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'github-pat',       pattern: /\bghp_[A-Za-z0-9]{30,}\b/g },
  { name: 'github-fine-pat',  pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { name: 'aws-access-key',   pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'aws-secret',       pattern: /\baws_secret_access_key\s*=\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi },
  { name: 'slack-bot-token',  pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'stripe-secret',    pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: 'gcp-api-key',      pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'json-env-var',     pattern: /(['"](?:api[_-]?key|secret|password|token|auth(?:_?token)?|client[_-]?secret|access[_-]?token)['"]\s*:\s*['"])([^'"]+)(['"])/gi },
];

export interface StripResult {
  cleaned: string;
  redactions: Array<{ name: string; start: number; end: number }>;
}

export function stripSecrets(content: string): string {
  if (!content) return content;
  let cleaned = content;
  for (const { pattern } of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[REDACTED]');
  }
  return cleaned;
}

export function stripSecretsWithTrace(content: string): StripResult {
  if (!content) return { cleaned: content, redactions: [] };
  const redactions: Array<{ name: string; start: number; end: number }> = [];
  let cleaned = content;
  for (const { name, pattern } of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match, ...args) => {
      const offsetArg = args[args.length - 2];
      const offset = typeof offsetArg === 'number' ? offsetArg : 0;
      redactions.push({
        name,
        start: offset,
        end: offset + match.length,
      });
      return '[REDACTED]';
    });
  }
  return { cleaned, redactions };
}
