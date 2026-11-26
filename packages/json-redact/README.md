# @formless63/json-redact

Replaces the values of secret-named keys in a JSON-shaped value before it is logged, stored or shown.
No dependencies, no I/O, runs in a browser.

```ts
import { isSensitiveKey, redactJson } from '@formless63/json-redact';

redactJson({ domain: 'example.com', apiToken: 'x', nested: [{ client_secret: 'y' }] });
// { domain: 'example.com', apiToken: '[REDACTED]', nested: [{ client_secret: '[REDACTED]' }] }

redactJson(event, { extraKeys: ['payload'] });  // also redact `payload`
isSensitiveKey('sshPassphrase');                // true: mask a value in a read-only view by the same rule
```

- **Keys, not values.** A key is compared lower-cased with separators removed, so `secret_access_key`,
  `secretAccessKey` and `SECRET-ACCESS-KEY` match alike. It is sensitive if it is one of `SENSITIVE_KEYS`
  (`password`, `token`, `apikey`, `authorization`, `cookie`, `nonce`, `ciphertext`, …), contains `password` or
  `passphrase`, or ends in `secret`, `token`, `apikey` or `privatekey`. `tokenCount` and `keyId` are not.
- The whole value under a sensitive key is replaced, whatever its shape.
- The input is not changed. `toJSON` is honoured as `JSON.stringify` would (a `Date` becomes its ISO string);
  other objects are copied as their own enumerable keys. A cycle becomes `[Circular]`. A parsed `__proto__`
  key stays a plain key.
- Options: `extraKeys` (more exact names), `isSensitive(key)` (your own rule, added to the built-in ones),
  `replacement` (default `[REDACTED]`).

Nothing is thrown. Limitations: a secret under an innocent key (`{ note: 'token=…' }`) or inside a string of
JSON is not found; parse it first or redact the field yourself. Keys are matched in ASCII only.
