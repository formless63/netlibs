/**
 * Key-based redaction: any object key that names secret material has its value
 * replaced, whatever the value's shape, through nested objects and arrays.
 * Pure and dependency-free, so it also runs in a browser.
 */

export const REDACTED = '[REDACTED]';
/** Put in place of an object that contains itself. */
export const CIRCULAR = '[Circular]';

/**
 * Exact sensitive names, compared after {@link normalizeKey}: `secret_access_key`,
 * `secretAccessKey` and `SECRET-ACCESS-KEY` are all `secretaccesskey`.
 */
export const SENSITIVE_KEYS: readonly string[] = Object.freeze([
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'ciphertext',
  'nonce',
  'authtag',
  'secretaccesskey',
  'accesskeyid',
  'apikey',
  'privatekey',
  'passphrase',
  'credentials',
  'authorization',
  'cookie',
  'sessiontoken'
]);
const EXACT = new Set(SENSITIVE_KEYS);

/** Lower case, letters and digits only. */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface RedactOptions {
  /** More exact names to redact, in any spelling; they are normalized like the built-in ones. */
  extraKeys?: readonly string[];
  /** Decides further keys. It sees the original key; the built-in rules still apply. */
  isSensitive?: (key: string) => boolean;
  /** Put in place of a redacted value. Default {@link REDACTED}. */
  replacement?: unknown;
}

/**
 * Whether a key names secret material: one of {@link SENSITIVE_KEYS}, anything
 * containing `password` or `passphrase`, or anything ending in `secret`,
 * `token`, `apikey` or `privatekey`. `tokenCount` and `keyId` are not.
 */
export function isSensitiveKey(key: string, options: Pick<RedactOptions, 'extraKeys' | 'isSensitive'> = {}): boolean {
  const normalized = normalizeKey(key);
  if (EXACT.has(normalized)) return true;
  if (options.extraKeys?.some((extra) => normalizeKey(extra) === normalized)) return true;
  if (options.isSensitive?.(key) === true) return true;
  return (
    normalized.includes('password') ||
    normalized.includes('passphrase') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('token') ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('privatekey')
  );
}

/**
 * A deep copy of `value` with every sensitive key's value replaced. Values
 * that are not objects pass through. Objects with `toJSON` (such as `Date`)
 * are converted first, as `JSON.stringify` would; other objects are copied as
 * their own enumerable string keys. An object inside itself becomes
 * {@link CIRCULAR}; one shared by two branches is copied twice.
 */
export function redactJson(value: unknown, options: RedactOptions = {}): unknown {
  const replacement = 'replacement' in options ? options.replacement : REDACTED;
  const sensitive = (key: string): boolean => isSensitiveKey(key, options);
  const ancestors = new Set<object>();

  function walk(node: unknown, key: string): unknown {
    if (node === null || typeof node !== 'object') return node;
    const json = (node as { toJSON?: unknown }).toJSON;
    if (typeof json === 'function') return walk((json as (key: string) => unknown).call(node, key), key);
    if (ancestors.has(node)) return CIRCULAR;
    ancestors.add(node);
    try {
      if (Array.isArray(node)) return node.map((entry, index) => walk(entry, String(index)));
      const out: Record<string, unknown> = {};
      for (const [name, entry] of Object.entries(node)) {
        // Defined, not assigned, so a parsed `__proto__` key stays a plain key.
        Object.defineProperty(out, name, {
          value: sensitive(name) ? replacement : walk(entry, name),
          enumerable: true,
          writable: true,
          configurable: true
        });
      }
      return out;
    } finally {
      ancestors.delete(node);
    }
  }

  return walk(value, '');
}
