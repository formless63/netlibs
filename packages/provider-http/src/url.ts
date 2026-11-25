import { ProviderError } from './errors.ts';

function ipv4Value(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = value * 256 + Number(part);
  }
  return value;
}

const PRIVATE_V4: ReadonlyArray<readonly [base: string, prefix: number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

function isPrivateV4(value: number): boolean {
  return PRIVATE_V4.some(([base, prefix]) => {
    const size = 2 ** (32 - prefix);
    return Math.floor(value / size) === Math.floor(ipv4Value(base)! / size);
  });
}

function ipv6Value(address: string): bigint | null {
  let text = address.toLowerCase();
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const v4 = ipv4Value(tail[2]!);
    if (v4 === null) return null;
    text = `${tail[1]}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string): string[] => (part === '' ? [] : part.split(':'));
  const head = groups(halves[0]!);
  const end = halves.length === 2 ? groups(halves[1]!) : [];
  const missing = 8 - head.length - end.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  let value = 0n;
  for (const group of [...head, ...Array<string>(missing).fill('0'), ...end]) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(`0x${group}`);
  }
  return value;
}

function isPrivateV6(value: bigint): boolean {
  const top = (bits: bigint): bigint => value >> (128n - bits);
  if (value <= 1n) return true; // :: and ::1
  if (top(7n) === 0x7en) return true; // fc00::/7 unique local
  if (top(10n) === 0x3fan) return true; // fe80::/10 link local
  if (top(8n) === 0xffn) return true; // ff00::/8 multicast
  const low32 = Number(value & 0xffffffffn);
  if (top(96n) === 0xffffn) return isPrivateV4(low32); // ::ffff:0:0/96 mapped
  if (top(96n) === 0n) return isPrivateV4(low32); // ::/96 compatible
  if (top(96n) === 0x64ff9b0000000000000000n) return isPrivateV4(low32); // 64:ff9b::/96 NAT64
  return false;
}

/**
 * Whether a host is an address or name that only means something locally:
 * loopback, private, shared (CGNAT), link-local, unique-local and multicast
 * ranges, plus `localhost`, `.local`, `.internal`, `.home.arpa` and bare names.
 *
 * Names are not resolved. A public name that resolves to a private address
 * passes; block that with an egress policy or a checking resolver.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host.includes(':')) {
    const value = ipv6Value(host);
    return value === null || isPrivateV6(value);
  }
  const v4 = ipv4Value(host);
  if (v4 !== null) return isPrivateV4(v4);
  return (
    !host.includes('.') || /(^|\.)(localhost|local|internal|home\.arpa)$/.test(host)
  );
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  const v4 = ipv4Value(host);
  return v4 !== null && Math.floor(v4 / 2 ** 24) === 127;
}

export interface BaseUrlOptions {
  provider: string;
  /** Permit `http:` to a loopback host, for tests and local mocks. */
  allowLoopbackHttp?: boolean;
  /** Permit `http:` to other hosts whose transport is already encrypted. */
  allowHttpHost?: (hostname: string) => boolean;
}

/**
 * Validates and normalizes an API base URL: https only (see options), no
 * embedded credentials, no query or fragment, no trailing slash.
 */
export function normalizeBaseUrl(input: string, options: BaseUrlOptions): string {
  const fail = (message: string): never => {
    throw new ProviderError({
      provider: options.provider,
      kind: 'invalid_input',
      message: `the ${options.provider} base URL ${message}`
    });
  };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail('is not an absolute URL');
  }
  if (url.username !== '' || url.password !== '') fail('must not carry credentials');
  if (url.search !== '' || url.hash !== '') fail('must not carry a query string or fragment');
  const httpAllowed =
    url.protocol === 'http:' &&
    ((options.allowLoopbackHttp === true && isLoopbackHost(url.hostname)) ||
      options.allowHttpHost?.(url.hostname) === true);
  if (url.protocol !== 'https:' && !httpAllowed) fail(`must use https, not ${url.protocol}`);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}
