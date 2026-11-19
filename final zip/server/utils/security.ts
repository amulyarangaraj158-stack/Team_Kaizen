import net from 'node:net';
import path from 'node:path';

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  normalizedUrl?: string;
  hostname?: string;
}

/**
 * Checks whether an IPv4 or IPv6 address belongs to a private, loopback,
 * link-local, carrier-grade NAT, or reserved internal network range.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const cleaned = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!cleaned) return true;

  // Handle IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1
  if (cleaned.startsWith('::ffff:')) {
    const mappedV4 = cleaned.slice(7);
    if (net.isIPv4(mappedV4)) {
      return isPrivateOrReservedIp(mappedV4);
    }
  }

  if (net.isIPv4(cleaned)) {
    const parts = cleaned.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    // 0.0.0.0/8 (current network)
    if (a === 0) return true;
    // 10.0.0.0/8 (private)
    if (a === 10) return true;
    // 100.64.0.0/10 (CGNAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8 (loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (link-local & cloud metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (private)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (private)
    if (a === 192 && b === 168) return true;
    // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved)
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(cleaned)) {
    // ::1 loopback, :: unspecified
    if (cleaned === '::1' || cleaned === '::' || cleaned === '0:0:0:0:0:0:0:1') return true;
    // fc00::/7 Unique Local Addresses (fc00..fdff)
    if (cleaned.startsWith('fc') || cleaned.startsWith('fd')) return true;
    // fe80::/10 link-local
    if (cleaned.startsWith('fe8') || cleaned.startsWith('fe9') || cleaned.startsWith('fea') || cleaned.startsWith('feb')) {
      return true;
    }
    // ff00::/8 multicast
    if (cleaned.startsWith('ff')) return true;
    return false;
  }

  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

/**
 * Strict SSRF URL validation for remote Website Debugger scans.
 * Blocks private/loopback IPs, internal hostnames, non-HTTP(S) protocols,
 * embedded credentials, and non-standard dangerous ports.
 */
export function validateRemoteScanUrl(rawUrl: string): UrlValidationResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, reason: 'URL is required.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Malformed URL. Must begin with http:// or https://.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      reason: `Blocked protocol "${parsed.protocol}". Only http:// and https:// are permitted.`,
    };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Embedded URL credentials are not permitted.' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    return { valid: false, reason: 'Missing target hostname.' };
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost')
  ) {
    return {
      valid: false,
      reason: `SSRF Protection: Local or internal hostname "${hostname}" is blocked for remote URL scans.`,
    };
  }

  if (net.isIP(hostname) && isPrivateOrReservedIp(hostname)) {
    return {
      valid: false,
      reason: `SSRF Protection: Private, loopback, or reserved IP "${hostname}" is blocked.`,
    };
  }

  // Block integer/octal IP obfuscation like http://2130706433 or http://0x7f000001
  if (/^(0x[0-9a-f]+|\d+)$/i.test(hostname)) {
    return {
      valid: false,
      reason: 'SSRF Protection: Numeric or hex-encoded IP hostnames are blocked.',
    };
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
    hostname,
  };
}

/**
 * Sanitizes an uploaded or user-specified relative file path to prevent
 * directory traversal attacks (../, absolute paths, null bytes).
 */
export function sanitizeProjectFilePath(inputPath: string): string {
  const noNull = inputPath.replace(/\0/g, '').replace(/\\/g, '/').trim();
  if (!noNull) {
    throw new Error('File path cannot be empty.');
  }
  const strippedLeading = noNull.replace(/^\/+/, '');
  const normalized = path.posix.normalize(strippedLeading);

  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`Invalid file path "${inputPath}": path traversal is prohibited.`);
  }

  return normalized;
}

export const ALLOWED_MEDIA_MIMES: Record<string, 'image' | 'audio' | 'video'> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/svg+xml': 'image',
  'image/bmp': 'image',
  'audio/mpeg': 'audio',
  'audio/mp3': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/ogg': 'audio',
  'audio/flac': 'audio',
  'audio/mp4': 'audio',
  'audio/webm': 'audio',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/ogg': 'video',
  'video/quicktime': 'video',
  'video/x-matroska': 'video',
};

export function classifyMediaMime(mimeType: string): 'image' | 'audio' | 'video' | null {
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  return ALLOWED_MEDIA_MIMES[normalized] ?? null;
}
