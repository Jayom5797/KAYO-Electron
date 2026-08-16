import * as dns from 'node:dns/promises';

export interface DnsRecord {
  type: string;
  value: string;
}

export interface DomainDnsInfo {
  domain: string;
  records: DnsRecord[];
  error?: string;
}

export interface DnsReport {
  domains: DomainDnsInfo[];
  subdomains: string[];
}

async function lookupDomain(domain: string): Promise<DomainDnsInfo> {
  const records: DnsRecord[] = [];

  await Promise.allSettled([
    dns.resolve4(domain).then(addrs => addrs.forEach(a => records.push({ type: 'A', value: a }))).catch(() => {}),
    dns.resolve6(domain).then(addrs => addrs.forEach(a => records.push({ type: 'AAAA', value: a }))).catch(() => {}),
    dns.resolveMx(domain).then(mx => mx.forEach(m => records.push({ type: 'MX', value: `${m.priority} ${m.exchange}` }))).catch(() => {}),
    dns.resolveTxt(domain).then(txts => txts.forEach(t => records.push({ type: 'TXT', value: t.join(' ').slice(0, 120) }))).catch(() => {}),
    dns.resolveNs(domain).then(ns => ns.forEach(n => records.push({ type: 'NS', value: n }))).catch(() => {}),
    dns.resolveCname(domain).then(cnames => cnames.forEach(c => records.push({ type: 'CNAME', value: c }))).catch(() => {}),
  ]);

  return { domain, records };
}

export async function runDnsRecon(requests: { url: string }[], targetUrl: string): Promise<DnsReport> {
  const targetHost = new URL(targetUrl).hostname;

  // Collect all unique domains from captured requests
  const allDomains = new Set<string>();
  allDomains.add(targetHost);

  for (const req of requests) {
    try {
      const host = new URL(req.url).hostname;
      allDomains.add(host);
    } catch { /* skip */ }
  }

  // Identify subdomains of the target
  const subdomains = Array.from(allDomains).filter(
    d => d !== targetHost && d.endsWith('.' + targetHost)
  );

  // Limit DNS lookups to avoid hanging — max 20 domains
  const domainsToLookup = Array.from(allDomains).slice(0, 20);

  const results = await Promise.all(domainsToLookup.map(lookupDomain));

  return { domains: results, subdomains };
}
