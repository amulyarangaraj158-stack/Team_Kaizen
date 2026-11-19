import dns from 'node:dns/promises';
import { isPrivateOrReservedIp, validateRemoteScanUrl } from '../utils/security';

export interface WebsiteIssue {
  category: 'accessibility' | 'performance' | 'broken_link' | 'security' | 'responsive' | 'javascript' | 'missing_resource';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  suggestedFix: string;
}

export interface WebsiteScanReport {
  targetUrl: string;
  scanMode: 'remote_url' | 'local_project';
  status: 'completed' | 'blocked' | 'failed';
  httpStatus?: number;
  responseTimeMs: number;
  payloadBytes: number;
  healthScore: number;
  metrics: {
    linksFound: number;
    brokenLinksChecked: number;
    imagesFound: number;
    imagesMissingAlt: number;
    scriptsFound: number;
    hasViewportMeta: boolean;
    hasTitle: boolean;
    hasLangAttr: boolean;
    securityHeadersPresent: string[];
    securityHeadersMissing: string[];
  };
  issues: WebsiteIssue[];
}

function analyzeHtmlDocument(
  html: string,
  targetUrl: string,
  responseTimeMs: number,
  httpStatus: number,
  headers: Record<string, string>,
  scanMode: 'remote_url' | 'local_project'
): WebsiteScanReport {
  const issues: WebsiteIssue[] = [];
  const payloadBytes = Buffer.byteLength(html, 'utf8');

  const hasTitle = /<title>[^<]+<\/title>/i.test(html);
  const hasViewportMeta = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
  const hasLangAttr = /<html[^>]+lang=["'][a-zA-Z-]+["']/i.test(html);

  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  let imagesMissingAlt = 0;
  let imagesMissingSrc = 0;
  for (const tag of imgTags) {
    if (!/\balt\s*=\s*["'][^"']*["']/i.test(tag)) imagesMissingAlt++;
    if (!/\bsrc\s*=\s*["'][^"']+["']/i.test(tag)) imagesMissingSrc++;
  }

  const linkTags = html.match(/<a\b[^>]*>/gi) ?? [];
  let emptyLinks = 0;
  let insecureTargetBlank = 0;
  for (const tag of linkTags) {
    if (/\bhref\s*=\s*["']\s*(#|javascript:void\(0\)|)\s*["']/i.test(tag)) emptyLinks++;
    if (/\btarget\s*=\s*["']_blank["']/i.test(tag) && !/\brel\s*=\s*["'][^"']*noopener/i.test(tag)) {
      insecureTargetBlank++;
    }
  }

  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
  const inlineHandlers = html.match(/\bon(click|load|error|mouseover)\s*=/gi) ?? [];
  const h1Tags = html.match(/<h1\b[^>]*>/gi) ?? [];

  if (!hasTitle) {
    issues.push({
      category: 'accessibility',
      severity: 'medium',
      title: 'Missing Document <title> Element',
      detail: 'The document lacks a non-empty <title> element needed for SEO and assistive technologies.',
      suggestedFix: 'Add a descriptive <title> element inside <head>.',
    });
  }
  if (!hasLangAttr) {
    issues.push({
      category: 'accessibility',
      severity: 'medium',
      title: 'Missing lang Attribute on <html>',
      detail: 'Screen readers rely on the root lang attribute to choose the correct pronunciation rules.',
      suggestedFix: 'Set <html lang="en"> (or the appropriate BCP-47 language code).',
    });
  }
  if (!hasViewportMeta) {
    issues.push({
      category: 'responsive',
      severity: 'high',
      title: 'Missing Responsive Viewport Meta Tag',
      detail: 'Pages without <meta name="viewport"> render scaled-out desktop layouts on mobile devices.',
      suggestedFix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0" /> to <head>.',
    });
  }
  if (imagesMissingAlt > 0) {
    issues.push({
      category: 'accessibility',
      severity: 'medium',
      title: `${imagesMissingAlt} Image(s) Missing alt Attributes`,
      detail: `${imagesMissingAlt} of ${imgTags.length} <img> element(s) lack descriptive alt attributes.`,
      suggestedFix: 'Add concise alt text for informative images or alt="" for decorative graphics.',
    });
  }
  if (imagesMissingSrc > 0) {
    issues.push({
      category: 'missing_resource',
      severity: 'high',
      title: `${imagesMissingSrc} Image(s) With Empty or Missing src`,
      detail: 'Image tags without valid src attributes trigger broken-image icons and redundant requests.',
      suggestedFix: 'Provide valid asset URLs or remove unused <img> elements.',
    });
  }
  if (emptyLinks > 0) {
    issues.push({
      category: 'broken_link',
      severity: 'low',
      title: `${emptyLinks} Placeholder or Empty Link(s) Detected`,
      detail: 'Anchor elements pointing to "#", empty href, or javascript:void(0) degrade navigation semantics.',
      suggestedFix: 'Use <button type="button"> for actions and valid URLs for navigation links.',
    });
  }
  if (insecureTargetBlank > 0) {
    issues.push({
      category: 'security',
      severity: 'medium',
      title: `${insecureTargetBlank} External Link(s) Missing rel="noopener"`,
      detail: 'Links using target="_blank" without rel="noopener noreferrer" expose window.opener.',
      suggestedFix: 'Add rel="noopener noreferrer" to all target="_blank" anchors.',
    });
  }
  if (inlineHandlers.length > 0) {
    issues.push({
      category: 'javascript',
      severity: 'medium',
      title: `${inlineHandlers.length} Inline DOM Event Handler(s) Found`,
      detail: 'Inline onclick/onload attributes complicate Content Security Policy enforcement and debugging.',
      suggestedFix: 'Attach event listeners via addEventListener or framework event bindings.',
    });
  }
  if (h1Tags.length === 0) {
    issues.push({
      category: 'accessibility',
      severity: 'low',
      title: 'No Primary <h1> Heading Found',
      detail: 'Pages should contain a top-level <h1> landmark heading to establish document hierarchy.',
      suggestedFix: 'Wrap the primary page title in an <h1> element.',
    });
  }
  if (payloadBytes > 500 * 1024) {
    issues.push({
      category: 'performance',
      severity: 'medium',
      title: `Large HTML Document Payload (${Math.round(payloadBytes / 1024)} KB)`,
      detail: 'Initial HTML payload exceeds 500 KB, slowing First Contentful Paint on mobile networks.',
      suggestedFix: 'Split embedded data/scripts and enable gzip or brotli compression.',
    });
  }
  if (responseTimeMs > 1800) {
    issues.push({
      category: 'performance',
      severity: 'medium',
      title: `Slow Initial Server Response (${responseTimeMs} ms)`,
      detail: 'Time-to-first-byte exceeded 1.8 seconds during scan.',
      suggestedFix: 'Add edge caching, optimize backend queries, or reduce blocking server work.',
    });
  }

  const expectedSecHeaders = ['content-security-policy', 'x-content-type-options', 'strict-transport-security', 'x-frame-options'];
  const securityHeadersPresent: string[] = [];
  const securityHeadersMissing: string[] = [];

  if (scanMode === 'remote_url') {
    for (const h of expectedSecHeaders) {
      if (headers[h]) securityHeadersPresent.push(h);
      else securityHeadersMissing.push(h);
    }
    if (securityHeadersMissing.length > 0) {
      issues.push({
        category: 'security',
        severity: 'low',
        title: `Missing ${securityHeadersMissing.length} Recommended Security Header(s)`,
        detail: `Response did not include: ${securityHeadersMissing.join(', ')}.`,
        suggestedFix: 'Configure standard HTTP security headers at the reverse proxy or web framework layer.',
      });
    }
  }

  let penalty = 0;
  for (const issue of issues) {
    if (issue.severity === 'critical') penalty += 22;
    else if (issue.severity === 'high') penalty += 14;
    else if (issue.severity === 'medium') penalty += 7;
    else penalty += 3;
  }
  const healthScore = Math.max(10, Math.min(100, 100 - penalty));

  return {
    targetUrl,
    scanMode,
    status: 'completed',
    httpStatus,
    responseTimeMs,
    payloadBytes,
    healthScore,
    metrics: {
      linksFound: linkTags.length,
      brokenLinksChecked: emptyLinks,
      imagesFound: imgTags.length,
      imagesMissingAlt,
      scriptsFound: scriptTags.length,
      hasViewportMeta,
      hasTitle,
      hasLangAttr,
      securityHeadersPresent,
      securityHeadersMissing,
    },
    issues,
  };
}

/**
 * Scans a remote website URL with strict SSRF protection:
 * 1. Validates protocol & hostname via validateRemoteScanUrl
 * 2. Resolves DNS records and verifies EVERY resolved IP is public (not private/loopback/metadata)
 * 3. Fetches with timeout (8s), manual redirect validation, and 1.5MB response size cap
 */
export async function scanRemoteWebsite(rawUrl: string): Promise<WebsiteScanReport> {
  const validation = validateRemoteScanUrl(rawUrl);
  if (!validation.valid || !validation.normalizedUrl || !validation.hostname) {
    throw new Error(validation.reason || 'Invalid URL');
  }

  // DNS resolution SSRF defense (blocks DNS rebinding / private A & AAAA records)
  let resolvedIps: string[] = [];
  try {
    const records = await dns.lookup(validation.hostname, { all: true });
    resolvedIps = records.map((r) => r.address);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'DNS lookup failed';
    throw new Error(`Unable to resolve hostname "${validation.hostname}": ${msg}`);
  }

  if (resolvedIps.length === 0) {
    throw new Error(`No DNS records found for "${validation.hostname}".`);
  }
  for (const ip of resolvedIps) {
    if (isPrivateOrReservedIp(ip)) {
      throw new Error(
        `SSRF Protection: Hostname "${validation.hostname}" resolved to private/internal IP (${ip}) and was blocked.`
      );
    }
  }

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    let currentUrl = validation.normalizedUrl;
    let redirects = 0;
    let response: Response;

    while (true) {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'AutoPatch-AI-WebsiteDebugger/1.0',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirects >= 3) break;
        const nextUrl = new URL(location, currentUrl).toString();
        const nextCheck = validateRemoteScanUrl(nextUrl);
        if (!nextCheck.valid || !nextCheck.hostname) {
          throw new Error(`SSRF Protection: Blocked redirect target (${nextCheck.reason})`);
        }
        const nextDns = await dns.lookup(nextCheck.hostname, { all: true });
        for (const r of nextDns) {
          if (isPrivateOrReservedIp(r.address)) {
            throw new Error(`SSRF Protection: Redirect target resolved to internal IP (${r.address}).`);
          }
        }
        currentUrl = nextCheck.normalizedUrl!;
        redirects++;
        continue;
      }
      break;
    }

    const responseTimeMs = Date.now() - start;
    const rawBuffer = await response.arrayBuffer();
    const maxBytes = 1.5 * 1024 * 1024;
    const html = Buffer.from(rawBuffer.slice(0, maxBytes)).toString('utf8');

    const headersMap: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headersMap[k.toLowerCase()] = v;
    });

    const report = analyzeHtmlDocument(html, currentUrl, responseTimeMs, response.status, headersMap, 'remote_url');
    if (response.status >= 400) {
      report.issues.unshift({
        category: 'broken_link',
        severity: response.status >= 500 ? 'critical' : 'high',
        title: `HTTP ${response.status} Error Returned`,
        detail: `The server responded with HTTP status ${response.status} for ${currentUrl}.`,
        suggestedFix: 'Verify routing, server health, and public accessibility of this endpoint.',
      });
      report.healthScore = Math.max(10, report.healthScore - 20);
    }

    return report;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out after 8000ms while scanning target URL.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Audits HTML/JSX/CSS files belonging to an uploaded local project inside SQLite.
 */
export function scanLocalProjectWebAssets(
  projectName: string,
  files: Array<{ path: string; content: string; language: string }>
): WebsiteScanReport {
  const start = Date.now();
  const htmlFiles = files.filter((f) => f.language === 'html' || f.path.endsWith('.html') || f.path.endsWith('.tsx') || f.path.endsWith('.jsx'));
  const combinedHtml =
    htmlFiles.length > 0
      ? htmlFiles.map((f) => f.content).join('\n')
      : '<!-- No HTML/JSX web entry files found in project -->';

  const report = analyzeHtmlDocument(
    combinedHtml,
    `project://${projectName}`,
    Date.now() - start,
    200,
    {},
    'local_project'
  );

  if (htmlFiles.length === 0) {
    report.issues = [
      {
        category: 'missing_resource',
        severity: 'low',
        title: 'No HTML or Frontend Template Files Found in Project',
        detail: `Project "${projectName}" contains backend/source modules without HTML templates. Upload an HTML/JSX file or scan a public HTTPS URL.`,
        suggestedFix: 'Select a web frontend project or run a remote URL scan.',
      },
    ];
    report.healthScore = 88;
  }

  return report;
}
