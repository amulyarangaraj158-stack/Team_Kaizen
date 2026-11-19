import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';

export interface WebsiteIssue {
  id: string;
  title: string;
  category: 'Functional' | 'Performance' | 'Responsive Design' | 'Accessibility' | 'SEO & Structure';
  affectedUrl: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  explanation: string;
  potentialImpact: string;
  suggestedCorrection: string;
  technicalEvidence: string;
}

export interface ProbedAsset {
  url: string;
  type: 'link' | 'image' | 'script' | 'stylesheet' | 'video' | 'audio';
  status: number | null;
  ok: boolean;
  contentType: string;
  sizeBytes: number | null;
  durationMs: number;
  error?: string;
}

export interface WebsiteScanOutcome {
  url: string;
  finalUrl: string;
  status: 'completed' | 'failed' | 'auth_required';
  httpStatus: number;
  ttfbMs: number;
  totalMs: number;
  htmlBytes: number;
  embedAllowed: boolean;
  embedBlockReason: string | null;
  metrics: {
    pageTitle: string;
    metaDescription: string;
    hasViewport: boolean;
    hasLang: boolean;
    headingCounts: Record<string, number>;
    totalLinks: number;
    totalImages: number;
    totalScripts: number;
    totalStylesheets: number;
    probedAssetsCount: number;
    brokenResourcesCount: number;
    analysisMethod: string;
  };
  issues: WebsiteIssue[];
  assets: ProbedAsset[];
  errorMessage?: string;
}

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 4 * 1024 * 1024; // 4MB cap
const REQUEST_TIMEOUT_MS = 10000;

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 127) return true; // 127.0.0.0/8 loopback
    if (parts[0] === 0) return true; // 0.0.0.0/8
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local / cloud metadata
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT
    if (parts[0] >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    if (norm === '::1' || norm === '::') return true;
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // ULA
    if (norm.startsWith('fe8') || norm.startsWith('fe9') || norm.startsWith('fea') || norm.startsWith('feb')) return true; // link-local
    if (norm.startsWith('::ffff:')) {
      const mapped = norm.slice(7);
      if (net.isIPv4(mapped)) return isPrivateIp(mapped);
    }
    return false;
  }
  return true;
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Please enter a valid absolute URL starting with https:// or http://');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http:// and https:// URLs are supported.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Scanning localhost, internal, or private network addresses is blocked by SSRF protection.');
  }

  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      throw new Error('Scanning private or loopback IP addresses is blocked by SSRF protection.');
    }
    return parsed;
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve domain "${host}". Check that the URL is publicly accessible.`);
  }

  if (!resolved.length || resolved.some((r) => isPrivateIp(r.address))) {
    throw new Error(`Domain "${host}" resolves to a private or restricted IP address and was blocked by SSRF protection.`);
  }

  return parsed;
}

async function safeFetchWithRedirects(
  startUrl: string,
  method: 'GET' | 'HEAD' = 'GET',
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<{ response: Response; finalUrl: string; ttfbMs: number }> {
  let currentUrl = startUrl;
  const started = Date.now();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafePublicUrl(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(currentUrl, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'AutoPatch-WebsiteDebugger/1.0 (+https://autopatch.dev)',
          Accept: method === 'GET' ? 'text/html,application/xhtml+xml,*/*;q=0.8' : '*/*',
        },
      });
      clearTimeout(timer);

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return { response: res, finalUrl: currentUrl, ttfbMs: Date.now() - started };
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }

      return { response: res, finalUrl: currentUrl, ttfbMs: Date.now() - started };
    } catch (err: unknown) {
      clearTimeout(timer);
      throw err;
    }
  }

  throw new Error(`Too many redirects (exceeded maximum of ${MAX_REDIRECTS}).`);
}

function parseHexColor(val: string): [number, number, number] | null {
  const m = val.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1];
  if (hex.length === 3) {
    return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
  }
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function contrastRatio(c1: [number, number, number], c2: [number, number, number]): number {
  const lum = ([r, g, b]: [number, number, number]) => {
    const [rs, gs, bs] = [r, g, b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  };
  const l1 = lum(c1);
  const l2 = lum(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export async function analyzePublicWebsite(rawUrl: string): Promise<WebsiteScanOutcome> {
  const validated = await assertSafePublicUrl(rawUrl);
  const overallStart = Date.now();
  const { response, finalUrl, ttfbMs } = await safeFetchWithRedirects(validated.toString(), 'GET', REQUEST_TIMEOUT_MS);

  // Detect auth-protected pages honestly without bypassing security
  if (response.status === 401 || response.status === 403) {
    return {
      url: validated.toString(),
      finalUrl,
      status: 'auth_required',
      httpStatus: response.status,
      ttfbMs,
      totalMs: Date.now() - overallStart,
      htmlBytes: 0,
      embedAllowed: false,
      embedBlockReason: `Target server returned HTTP ${response.status} (authentication or access restriction).`,
      metrics: {
        pageTitle: '',
        metaDescription: '',
        hasViewport: false,
        hasLang: false,
        headingCounts: {},
        totalLinks: 0,
        totalImages: 0,
        totalScripts: 0,
        totalStylesheets: 0,
        probedAssetsCount: 0,
        brokenResourcesCount: 0,
        analysisMethod: 'SSRF-Guarded Live HTTP + DOM Inspection',
      },
      issues: [],
      assets: [],
      errorMessage: `Website requires authentication or restricts automated access (HTTP ${response.status}). AutoPatch AI does not bypass authentication or CAPTCHAs; authenticated session integration can be configured in future CI hooks.`,
    };
  }

  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length > MAX_HTML_BYTES) {
    throw new Error('Page HTML exceeds the 4MB safe inspection limit.');
  }

  const totalMs = Date.now() - overallStart;
  const html = buf.toString('utf8');
  const $ = cheerio.load(html);
  const issues: WebsiteIssue[] = [];
  let issueIdx = 1;
  const pushIssue = (i: Omit<WebsiteIssue, 'id'>) => {
    issues.push({ id: `web_${issueIdx++}`, ...i });
  };

  // Embed header inspection for honest live preview status
  const xfo = (response.headers.get('x-frame-options') || '').toLowerCase();
  const csp = (response.headers.get('content-security-policy') || '').toLowerCase();
  let embedAllowed = true;
  let embedBlockReason: string | null = null;
  if (xfo.includes('deny') || xfo.includes('sameorigin')) {
    embedAllowed = false;
    embedBlockReason = `Target sets X-Frame-Options: ${response.headers.get('x-frame-options')}`;
  } else if (csp.includes('frame-ancestors') && !csp.includes('frame-ancestors *')) {
    embedAllowed = false;
    embedBlockReason = 'Target sets restrictive Content-Security-Policy frame-ancestors header';
  }

  // HTTP Status check
  if (response.status >= 400) {
    pushIssue({
      title: `Page Returned HTTP Error ${response.status}`,
      category: 'Functional',
      affectedUrl: finalUrl,
      severity: 'critical',
      explanation: `The target URL responded with HTTP status ${response.status} instead of 200 OK.`,
      potentialImpact: 'Visitors and search crawlers encounter a broken or missing page.',
      suggestedCorrection: 'Verify server routing, deployment status, or canonical URL configuration.',
      technicalEvidence: `HTTP ${response.status} ${response.statusText} at ${finalUrl}`,
    });
  }

  // Performance: TTFB & HTML Size & Render-Blocking Scripts
  if (ttfbMs > 1200) {
    pushIssue({
      title: `Slow Server Time-to-First-Byte (${ttfbMs}ms)`,
      category: 'Performance',
      affectedUrl: finalUrl,
      severity: ttfbMs > 2500 ? 'high' : 'medium',
      explanation: `Initial server response took ${ttfbMs}ms, exceeding the recommended 800ms Core Web Vitals TTFB budget.`,
      potentialImpact: 'Delays Largest Contentful Paint (LCP) and increases bounce rate on mobile networks.',
      suggestedCorrection: 'Enable CDN edge caching, optimize backend queries, or compress responses with Brotli/Gzip.',
      technicalEvidence: `Measured TTFB: ${ttfbMs}ms · Total HTML download: ${totalMs}ms · Payload: ${(buf.length / 1024).toFixed(1)} KB`,
    });
  }

  if (buf.length > 400 * 1024) {
    pushIssue({
      title: `Large HTML Document Payload (${(buf.length / 1024).toFixed(0)} KB)`,
      category: 'Performance',
      affectedUrl: finalUrl,
      severity: 'medium',
      explanation: 'The raw HTML document exceeds 400 KB, slowing DOM parsing and initial render.',
      potentialImpact: 'Increases Time to Interactive and memory overhead on mobile browsers.',
      suggestedCorrection: 'Remove oversized inline base64 assets or unused hydrated state from SSR HTML.',
      technicalEvidence: `HTML size: ${buf.length} bytes (${(buf.length / 1024).toFixed(1)} KB)`,
    });
  }

  const blockingScripts: string[] = [];
  $('head script[src]').each((_, el) => {
    const src = $(el).attr('src') || '';
    const hasAsync = $(el).attr('async') !== undefined;
    const hasDefer = $(el).attr('defer') !== undefined;
    const isModule = $(el).attr('type') === 'module';
    if (!hasAsync && !hasDefer && !isModule) {
      blockingScripts.push(src);
    }
  });
  if (blockingScripts.length > 0) {
    pushIssue({
      title: `${blockingScripts.length} Render-Blocking Script(s) in <head>`,
      category: 'Performance',
      affectedUrl: finalUrl,
      severity: blockingScripts.length >= 3 ? 'high' : 'medium',
      explanation: 'Synchronous <script src> tags inside <head> without defer or async block HTML parsing and first paint.',
      potentialImpact: 'Degrades First Contentful Paint (FCP) and Largest Contentful Paint (LCP).',
      suggestedCorrection: 'Add the defer or async attribute (or type="module") to non-critical scripts.',
      technicalEvidence: `Blocking scripts: ${blockingScripts.slice(0, 4).join(', ')}`,
    });
  }

  // Responsive Design Checks
  const viewportMeta = $('meta[name="viewport"]').attr('content') || '';
  if (!viewportMeta) {
    pushIssue({
      title: 'Missing Responsive Viewport Meta Tag',
      category: 'Responsive Design',
      affectedUrl: finalUrl,
      severity: 'high',
      explanation: 'No <meta name="viewport" content="width=device-width, initial-scale=1"> tag was found in <head>.',
      potentialImpact: 'Mobile browsers render the page zoomed out at desktop width (~980px), forcing pinch-zooming.',
      suggestedCorrection: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0"> inside <head>.',
      technicalEvidence: 'Query selector head > meta[name="viewport"] returned 0 nodes.',
    });
  } else if (/user-scalable\s*=\s*(no|0)/i.test(viewportMeta)) {
    pushIssue({
      title: 'Viewport Disables Pinch-to-Zoom Accessibility',
      category: 'Accessibility',
      affectedUrl: finalUrl,
      severity: 'medium',
      explanation: 'The viewport meta tag sets user-scalable=no, preventing low-vision users from zooming.',
      potentialImpact: 'Fails WCAG 2.1 Success Criterion 1.4.4 (Resize Text).',
      suggestedCorrection: 'Remove user-scalable=no and maximum-scale=1 from the viewport meta tag.',
      technicalEvidence: `<meta name="viewport" content="${viewportMeta}">`,
    });
  }

  const fixedOverflowEls: string[] = [];
  $('[style*="width"]').each((_, el) => {
    const st = $(el).attr('style') || '';
    const m = st.match(/(?:^|;)\s*width\s*:\s*(\d+)px/i);
    if (m && Number(m[1]) > 480) {
      fixedOverflowEls.push(`<${el.tagName} style="${st.slice(0, 60)}">`);
    }
  });
  if (fixedOverflowEls.length > 0) {
    pushIssue({
      title: `${fixedOverflowEls.length} Element(s) With Fixed Pixel Width > 480px`,
      category: 'Responsive Design',
      affectedUrl: finalUrl,
      severity: 'medium',
      explanation: 'Inline fixed pixel widths wider than mobile viewports commonly cause horizontal overflow.',
      potentialImpact: 'Triggers horizontal scrollbars and clipped layouts on mobile screens (375px).',
      suggestedCorrection: 'Replace fixed width with max-width: 100% or responsive CSS units.',
      technicalEvidence: fixedOverflowEls.slice(0, 3).join(' | '),
    });
  }

  const unsizedImages = $('img').filter((_, el) => !$(el).attr('width') && !$(el).attr('height')).length;
  if (unsizedImages > 3) {
    pushIssue({
      title: `${unsizedImages} Images Missing Explicit Width/Height Attributes`,
      category: 'Responsive Design',
      affectedUrl: finalUrl,
      severity: 'low',
      explanation: 'Images without intrinsic width/height or aspect-ratio attributes cause layout jumps while loading.',
      potentialImpact: 'Increases Cumulative Layout Shift (CLS) across desktop and mobile viewports.',
      suggestedCorrection: 'Specify width and height attributes (or CSS aspect-ratio) on <img> elements.',
      technicalEvidence: `${unsizedImages} of ${$('img').length} <img> tags omit both width and height attributes.`,
    });
  }

  // Accessibility Checks
  const htmlLang = $('html').attr('lang');
  if (!htmlLang) {
    pushIssue({
      title: 'Missing Document Language Attribute (<html lang>)',
      category: 'Accessibility',
      affectedUrl: finalUrl,
      severity: 'medium',
      explanation: 'The root <html> element does not declare a primary language via the lang attribute.',
      potentialImpact: 'Screen readers may use the wrong pronunciation rules for page text.',
      suggestedCorrection: 'Set <html lang="en"> (or the appropriate BCP 47 language code).',
      technicalEvidence: 'Root <html> element has no lang attribute.',
    });
  }

  const missingAltImgs: string[] = [];
  $('img').each((_, el) => {
    const alt = $(el).attr('alt');
    if (alt === undefined) {
      missingAltImgs.push($(el).attr('src') || '[inline img]');
    }
  });
  if (missingAltImgs.length > 0) {
    pushIssue({
      title: `${missingAltImgs.length} Image(s) Missing alt Attribute`,
      category: 'Accessibility',
      affectedUrl: finalUrl,
      severity: 'high',
      explanation: 'Images without alt attributes cannot be described to assistive technology users.',
      potentialImpact: 'Violates WCAG 2.1 Level A (1.1.1 Non-text Content) and reduces image search indexing.',
      suggestedCorrection: 'Add descriptive alt="..." text for informative images or alt="" for purely decorative graphics.',
      technicalEvidence: `Examples: ${missingAltImgs.slice(0, 4).join(', ')}`,
    });
  }

  let unlabeledInputs = 0;
  $('input, select, textarea').each((_, el) => {
    const type = ($(el).attr('type') || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return;
    const id = $(el).attr('id');
    const aria = $(el).attr('aria-label') || $(el).attr('aria-labelledby');
    const hasForLabel = id ? $(`label[for="${id}"]`).length > 0 : false;
    const wrappedInLabel = $(el).closest('label').length > 0;
    if (!aria && !hasForLabel && !wrappedInLabel) unlabeledInputs++;
  });
  if (unlabeledInputs > 0) {
    pushIssue({
      title: `${unlabeledInputs} Form Control(s) Missing Associated Labels`,
      category: 'Accessibility',
      affectedUrl: finalUrl,
      severity: 'high',
      explanation: 'Form inputs without <label for>, enclosing <label>, or aria-label are inaccessible to keyboard and screen-reader users.',
      potentialImpact: 'Users relying on assistive technology cannot identify required form fields.',
      suggestedCorrection: 'Pair every form input with a visible <label for="id"> or explicit aria-label.',
      technicalEvidence: `${unlabeledInputs} visible form controls lack accessible label associations.`,
    });
  }

  // Heading hierarchy check
  const headingCounts: Record<string, number> = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
  const headingOrder: number[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    headingCounts[tag] = (headingCounts[tag] || 0) + 1;
    headingOrder.push(Number(tag[1]));
  });

  if (headingCounts.h1 === 0) {
    pushIssue({
      title: 'Missing Primary <h1> Heading',
      category: 'SEO & Structure',
      affectedUrl: finalUrl,
      severity: 'medium',
      explanation: 'No <h1> element was detected on the page.',
      potentialImpact: 'Weakens document outline clarity for both screen readers and search engines.',
      suggestedCorrection: 'Include a single clear <h1> describing the primary page topic.',
      technicalEvidence: `Heading counts: ${JSON.stringify(headingCounts)}`,
    });
  }
  let skippedLevel: string | null = null;
  for (let i = 1; i < headingOrder.length; i++) {
    if (headingOrder[i] - headingOrder[i - 1] > 1) {
      skippedLevel = `h${headingOrder[i - 1]} -> h${headingOrder[i]}`;
      break;
    }
  }
  if (skippedLevel) {
    pushIssue({
      title: `Skipped Heading Hierarchy Level (${skippedLevel})`,
      category: 'Accessibility',
      affectedUrl: finalUrl,
      severity: 'low',
      explanation: `Headings jump from ${skippedLevel} without an intermediate heading level.`,
      potentialImpact: 'Disrupts keyboard heading navigation for assistive technology users.',
      suggestedCorrection: 'Use sequential heading levels (h1 -> h2 -> h3) and style visual size with CSS.',
      technicalEvidence: `Detected jump: ${skippedLevel}`,
    });
  }

  // Inline color contrast check where both color and background-color are hex values
  $('[style*="color"]').each((_, el) => {
    const st = $(el).attr('style') || '';
    const fgMatch = st.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,6})/i);
    const bgMatch = st.match(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})/i);
    if (fgMatch && bgMatch) {
      const fg = parseHexColor(fgMatch[1]);
      const bg = parseHexColor(bgMatch[1]);
      if (fg && bg) {
        const ratio = contrastRatio(fg, bg);
        if (ratio < 4.5) {
          pushIssue({
            title: `Insufficient Inline Color Contrast (${ratio.toFixed(2)}:1)`,
            category: 'Accessibility',
            affectedUrl: finalUrl,
            severity: 'medium',
            explanation: `Inline foreground ${fgMatch[1]} on background ${bgMatch[1]} falls below the WCAG AA 4.5:1 ratio.`,
            potentialImpact: 'Text becomes difficult to read for users with low vision or color deficiency.',
            suggestedCorrection: 'Darken the foreground or lighten the background to achieve at least 4.5:1 contrast.',
            technicalEvidence: `<${el.tagName}> color:${fgMatch[1]} on background:${bgMatch[1]} => ${ratio.toFixed(2)}:1`,
          });
        }
      }
    }
  });

  // Empty/unlabeled interactive controls (evidence-based static DOM observation)
  let emptyButtons = 0;
  $('button').each((_, el) => {
    const txt = $(el).text().trim();
    const aria = $(el).attr('aria-label') || $(el).attr('title');
    if (!txt && !aria) emptyButtons++;
  });
  if (emptyButtons > 0) {
    pushIssue({
      title: `${emptyButtons} Button Element(s) Missing Accessible Name`,
      category: 'Accessibility',
      affectedUrl: finalUrl,
      severity: 'medium',
      explanation: 'Icon-only or empty <button> tags without text or aria-label cannot be announced by screen readers.',
      potentialImpact: 'Keyboard and screen-reader users cannot determine what the button triggers.',
      suggestedCorrection: 'Add aria-label="..." or visually hidden descriptive text to every icon button.',
      technicalEvidence: `${emptyButtons} <button> nodes have empty textContent and no aria-label/title.`,
    });
  }

  // SEO Checks
  const pageTitle = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';
  const canonicalHref = $('link[rel="canonical"]').attr('href')?.trim() || '';

  if (!pageTitle) {
    pushIssue({
      title: 'Missing <title> Tag',
      category: 'SEO & Structure',
      affectedUrl: finalUrl,
      severity: 'high',
      explanation: 'The HTML document does not define a <title> element.',
      potentialImpact: 'Harms search rankings, browser tab usability, and social sharing cards.',
      suggestedCorrection: 'Add a unique, descriptive <title> (30–60 characters) inside <head>.',
      technicalEvidence: 'Selector head > title returned empty.',
    });
  }
  if (!metaDescription) {
    pushIssue({
      title: 'Missing Meta Description',
      category: 'SEO & Structure',
      affectedUrl: finalUrl,
      severity: 'medium',
      explanation: 'No <meta name="description"> tag was found.',
      potentialImpact: 'Search engines auto-generate arbitrary snippets, reducing click-through quality.',
      suggestedCorrection: 'Add a concise 120–160 character <meta name="description" content="..."> in <head>.',
      technicalEvidence: 'Selector meta[name="description"] returned 0 nodes.',
    });
  }
  if (canonicalHref) {
    try {
      new URL(canonicalHref, finalUrl);
    } catch {
      pushIssue({
        title: 'Malformed Canonical URL Reference',
        category: 'SEO & Structure',
        affectedUrl: finalUrl,
        severity: 'medium',
        explanation: 'The <link rel="canonical"> href cannot be resolved as a valid URL.',
        potentialImpact: 'Search crawlers may index duplicate or unintended URLs.',
        suggestedCorrection: 'Provide a valid absolute HTTPS URL in <link rel="canonical">.',
        technicalEvidence: `<link rel="canonical" href="${canonicalHref}">`,
      });
    }
  }

  // Actively probe up to 14 referenced assets & links (real HTTP status + Content-Length checks!)
  const candidates: Array<{ url: string; type: ProbedAsset['type'] }> = [];
  const seenUrls = new Set<string>();
  const addCandidate = (raw: string | undefined, type: ProbedAsset['type']) => {
    if (!raw || raw.startsWith('data:') || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:') || raw.startsWith('#')) {
      return;
    }
    try {
      const abs = new URL(raw, finalUrl).toString();
      if (!seenUrls.has(abs) && candidates.length < 14) {
        seenUrls.add(abs);
        candidates.push({ url: abs, type });
      }
    } catch {
      // skip invalid
    }
  };

  $('img[src]').slice(0, 5).each((_, el) => addCandidate($(el).attr('src'), 'image'));
  $('script[src]').slice(0, 3).each((_, el) => addCandidate($(el).attr('src'), 'script'));
  $('link[rel="stylesheet"][href]').slice(0, 2).each((_, el) => addCandidate($(el).attr('href'), 'stylesheet'));
  $('video source[src], video[src]').slice(0, 2).each((_, el) => addCandidate($(el).attr('src'), 'video'));
  $('audio source[src], audio[src]').slice(0, 2).each((_, el) => addCandidate($(el).attr('src'), 'audio'));
  $('a[href]').slice(0, 6).each((_, el) => addCandidate($(el).attr('href'), 'link'));

  const probedAssets: ProbedAsset[] = await Promise.all(
    candidates.map(async (c) => {
      const t0 = Date.now();
      try {
        const { response: assetRes } = await safeFetchWithRedirects(c.url, 'HEAD', 5000);
        const lenHeader = assetRes.headers.get('content-length');
        const sizeBytes = lenHeader ? Number(lenHeader) : null;
        return {
          url: c.url,
          type: c.type,
          status: assetRes.status,
          ok: assetRes.status >= 200 && assetRes.status < 400,
          contentType: assetRes.headers.get('content-type') || 'unknown',
          sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
          durationMs: Date.now() - t0,
        };
      } catch (err: unknown) {
        return {
          url: c.url,
          type: c.type,
          status: null,
          ok: false,
          contentType: 'unreachable',
          sizeBytes: null,
          durationMs: Date.now() - t0,
          error: err instanceof Error ? err.message : 'Request failed',
        };
      }
    })
  );

  for (const asset of probedAssets) {
    if (!asset.ok) {
      pushIssue({
        title: `Broken ${asset.type.toUpperCase()} Resource (${asset.status ?? 'Network Error'})`,
        category: 'Functional',
        affectedUrl: asset.url,
        severity: asset.type === 'script' || asset.type === 'stylesheet' ? 'high' : 'medium',
        explanation: `Probing ${asset.url} returned ${asset.status ? `HTTP ${asset.status}` : asset.error || 'a connection error'}.`,
        potentialImpact:
          asset.type === 'link'
            ? 'Users clicking this link hit a dead or missing page.'
            : `Missing ${asset.type} causes broken visuals or runtime failures on the page.`,
        suggestedCorrection: 'Verify the asset path, deployment URL, or remove the broken reference.',
        technicalEvidence: `HEAD ${asset.url} -> status=${asset.status ?? 'ERR'} (${asset.durationMs}ms)${asset.error ? ` · ${asset.error}` : ''}`,
      });
    } else if (asset.type === 'image' && asset.sizeBytes && asset.sizeBytes > 600 * 1024) {
      pushIssue({
        title: `Oversized Image Asset (${(asset.sizeBytes / 1024).toFixed(0)} KB)`,
        category: 'Performance',
        affectedUrl: asset.url,
        severity: asset.sizeBytes > 1500 * 1024 ? 'high' : 'medium',
        explanation: `Image ${asset.url} transfers ${(asset.sizeBytes / 1024).toFixed(0)} KB over the network.`,
        potentialImpact: 'Significantly delays page load and consumes mobile bandwidth.',
        suggestedCorrection: 'Compress and convert the image to WebP/AVIF and serve responsive srcset dimensions.',
        technicalEvidence: `Content-Length: ${asset.sizeBytes} bytes · Content-Type: ${asset.contentType}`,
      });
    }
  }

  return {
    url: validated.toString(),
    finalUrl,
    status: 'completed',
    httpStatus: response.status,
    ttfbMs,
    totalMs,
    htmlBytes: buf.length,
    embedAllowed,
    embedBlockReason,
    metrics: {
      pageTitle,
      metaDescription,
      hasViewport: Boolean(viewportMeta),
      hasLang: Boolean(htmlLang),
      headingCounts,
      totalLinks: $('a[href]').length,
      totalImages: $('img').length,
      totalScripts: $('script').length,
      totalStylesheets: $('link[rel="stylesheet"]').length,
      probedAssetsCount: probedAssets.length,
      brokenResourcesCount: probedAssets.filter((a) => !a.ok).length,
      analysisMethod: 'Live SSRF-Guarded HTTP + Cheerio DOM + Active Asset Probe (Headless browser engine not installed on container)',
    },
    issues,
    assets: probedAssets,
  };
}
