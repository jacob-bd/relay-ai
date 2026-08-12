const SENSITIVE_KEYS = new Set([
  'authorization', 'api_key', 'apikey', 'access_token', 'refresh_token', 'chatgpt-account-id',
  'encrypted_content', 'ciphertext', 'plaintext', 'payload', 'developer_instructions',
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase()) || key.toLowerCase().includes('secret');
}

export function redactCodexTraceValue(value: unknown, inCollaboration = false): unknown {
  if (typeof value === 'string') return inCollaboration ? '[REDACTED]' : value;
  if (Array.isArray(value)) return value.map(item => redactCodexTraceValue(item, inCollaboration));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const collaboration = inCollaboration || record.type === 'agent_message';
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (isSensitiveKey(key) || (collaboration && (key === 'text' || key === 'content'))) {
      if (key === 'content' && Array.isArray(child)) out[key] = { item_count: child.length, redacted: true };
      else out[key] = '[REDACTED]';
      continue;
    }
    out[key] = redactCodexTraceValue(child, collaboration);
  }
  return out;
}
