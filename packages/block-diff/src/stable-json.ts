/**
 * Serialise JSON-shaped data independently of key order, for equality only.
 *
 * Keys sort by UTF-16 code unit, never `localeCompare`: a locale-dependent
 * order would make equality depend on the host's ICU data. `undefined` members
 * are dropped, as `JSON.stringify` does. Not a canonical form to hash and store;
 * use RFC 8785 (the `canonicalize` package) for that.
 */
export function stableJson(
  value: unknown,
  omit?: (key: string, value: unknown) => boolean,
): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item === undefined ? null : item, omit)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const members: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const member = record[key];
      if (member === undefined || omit?.(key, member)) continue;
      members.push(`${JSON.stringify(key)}:${stableJson(member, omit)}`);
    }
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
