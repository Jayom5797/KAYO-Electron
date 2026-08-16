import type { NetworkRequest } from '../types.js';

export type MixedContentSeverity = 'high' | 'medium' | 'low';

export interface MixedContentFinding {
  url: string;
  resourceType: string;
  severity: MixedContentSeverity;
  /** 'active' = script/iframe/xhr (can run code); 'passive' = image/media/font */
  category: 'active' | 'passive';
  detail: string;
}

export interface MixedContentReport {
  present: boolean;
  pageIsHttps: boolean;
  findings: MixedContentFinding[];
}

// Active mixed content can execute or fully compromise the page → high severity.
const ACTIVE_TYPES = new Set(['script', 'stylesheet', 'xhr', 'fetch', 'document']);

/**
 * Detects HTTP sub-resources loaded by an HTTPS page (mixed content).
 * Modern browsers block active mixed content, but its presence indicates a
 * misconfiguration and passive mixed content (images/media) still leaks/strips.
 */
export function findMixedContent(requests: NetworkRequest[], targetUrl: string): MixedContentReport {
  let pageIsHttps = false;
  try {
    pageIsHttps = new URL(targetUrl).protocol === 'https:';
  } catch {
    pageIsHttps = false;
  }

  if (!pageIsHttps) {
    return { present: false, pageIsHttps: false, findings: [] };
  }

  const findings: MixedContentFinding[] = [];
  const seen = new Set<string>();

  for (const req of requests) {
    if (!req.url.startsWith('http://')) continue; // only insecure sub-resources
    if (seen.has(req.url)) continue;
    seen.add(req.url);

    const isActive = ACTIVE_TYPES.has(req.resourceType);
    findings.push({
      url: req.url,
      resourceType: req.resourceType,
      category: isActive ? 'active' : 'passive',
      severity: isActive ? 'high' : 'medium',
      detail: isActive
        ? `Active mixed content (${req.resourceType}) loaded over HTTP on an HTTPS page — browsers block this and it can break the page or expose it to tampering.`
        : `Passive mixed content (${req.resourceType}) loaded over HTTP — can be stripped or modified in transit and downgrades the page's security indicator.`,
    });
  }

  return { present: findings.length > 0, pageIsHttps: true, findings };
}
