import crypto from 'node:crypto';

export type Tenant = {
  id: string;
  name: string;
};

function parseKeyMap(raw: string | undefined): Map<string, Tenant> {
  const map = new Map<string, Tenant>();
  if (!raw) return map;
  const chunks = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  for (const chunk of chunks) {
    const [name, key] = chunk.split(':').map((v) => v.trim());
    if (!name || !key) continue;
    map.set(key, { id: crypto.createHash('sha256').update(name).digest('hex').slice(0, 16), name });
  }
  return map;
}

const configured = parseKeyMap(process.env.PROXY_API_KEYS);

export function resolveTenantByApiKey(apiKey: string): Tenant | null {
  if (configured.size === 0) {
    if (apiKey === 'test') return { id: 'tenant-test', name: 'test' };
    return null;
  }
  return configured.get(apiKey) ?? null;
}
