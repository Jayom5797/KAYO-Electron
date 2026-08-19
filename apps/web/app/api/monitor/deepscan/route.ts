import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/monitor/deepscan
 * 
 * Deep crawl + secret detection scan.
 * Crawls all internal pages, JS files, and checks for:
 * - Hardcoded credentials / API keys
 * - Exposed config files (.env, .git, etc)
 * - Source maps leaking code
 * - Form default values / pre-filled credentials
 * - Database connection strings
 */

interface SecretFinding {
  type: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  value: string      // redacted match
  location: string   // URL where found
  context: string    // surrounding text
  line?: number
}

interface CrawledPage {
  url: string
  status: number
  title?: string
  forms?: number
  scripts?: number
}

// Secret detection patterns
const SECRET_PATTERNS: { name: string; pattern: RegExp; severity: 'critical' | 'high' | 'medium' | 'low' }[] = [
  // API Keys & Tokens
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/g, severity: 'critical' },
  { name: 'AWS Secret Key', pattern: /(?:aws_secret|secret_key|secretkey)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi, severity: 'critical' },
  { name: 'GitHub Token', pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g, severity: 'critical' },
  { name: 'GitLab Token', pattern: /glpat-[A-Za-z0-9\-_]{20,}/g, severity: 'critical' },
  { name: 'Stripe Key', pattern: /sk_live_[0-9a-zA-Z]{24,}/g, severity: 'critical' },
  { name: 'Stripe Publishable', pattern: /pk_live_[0-9a-zA-Z]{24,}/g, severity: 'medium' },
  { name: 'Google API Key', pattern: /AIza[0-9A-Za-z\-_]{35}/g, severity: 'high' },
  { name: 'Firebase Key', pattern: /AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}/g, severity: 'high' },
  { name: 'Slack Token', pattern: /xox[baprs]-[0-9]{10,}-[0-9a-zA-Z]{10,}/g, severity: 'critical' },
  { name: 'Discord Token', pattern: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27}/g, severity: 'critical' },
  { name: 'Twilio Key', pattern: /SK[0-9a-fA-F]{32}/g, severity: 'high' },
  { name: 'SendGrid Key', pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/g, severity: 'critical' },
  { name: 'JWT Token', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, severity: 'high' },
  { name: 'Bearer Token', pattern: /[Bb]earer\s+[A-Za-z0-9\-._~+/]+=*/g, severity: 'high' },

  // Passwords & Credentials
  { name: 'Hardcoded Password', pattern: /(?:password|passwd|pwd|pass)\s*[:=]\s*["']([^"']{4,50})["']/gi, severity: 'critical' },
  { name: 'Hardcoded Secret', pattern: /(?:secret|token|api_key|apikey|auth)\s*[:=]\s*["']([^"']{8,100})["']/gi, severity: 'high' },
  { name: 'Basic Auth Header', pattern: /[Bb]asic\s+[A-Za-z0-9+/]{10,}={0,2}/g, severity: 'critical' },
  { name: 'Credentials in URL', pattern: /https?:\/\/[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+@(?!fonts\.|cdn\.|ajax\.|apis\.)[a-zA-Z0-9.-]+\.[a-z]{2,}/g, severity: 'critical' },

  // Database Connection Strings
  { name: 'PostgreSQL Connection', pattern: /postgres(?:ql)?:\/\/[^\s"'<>]{10,}/gi, severity: 'critical' },
  { name: 'MongoDB Connection', pattern: /mongodb(?:\+srv)?:\/\/[^\s"'<>]{10,}/gi, severity: 'critical' },
  { name: 'MySQL Connection', pattern: /mysql:\/\/[^\s"'<>]{10,}/gi, severity: 'critical' },
  { name: 'Redis Connection', pattern: /redis:\/\/[^\s"'<>]{10,}/gi, severity: 'high' },

  // Private Keys
  { name: 'RSA Private Key', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, severity: 'critical' },
  { name: 'SSH Private Key', pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/g, severity: 'critical' },

  // Cloud & Infrastructure
  { name: 'Azure Connection String', pattern: /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+/gi, severity: 'critical' },
  { name: 'GCP Service Account', pattern: /"type"\s*:\s*"service_account"/g, severity: 'high' },

  // Email patterns that might indicate test/admin accounts
  { name: 'Admin Email in Source', pattern: /(?:admin|root|test|dev)@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, severity: 'low' },
  { name: 'Internal IP Address', pattern: /(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}/g, severity: 'medium' },
]

// Sensitive file paths to check
const SENSITIVE_PATHS = [
  '/.env', '/.env.local', '/.env.production', '/.env.development',
  '/.git/config', '/.git/HEAD', '/.gitignore',
  '/wp-config.php', '/wp-config.php.bak', '/wp-config.php.old',
  '/config.json', '/config.yml', '/config.yaml',
  '/package.json', '/composer.json',
  '/.htaccess', '/.htpasswd',
  '/server-status', '/server-info',
  '/phpinfo.php', '/info.php',
  '/debug', '/trace', '/actuator', '/actuator/env',
  '/.DS_Store', '/Thumbs.db',
  '/backup.sql', '/dump.sql', '/database.sql',
  '/id_rsa', '/id_rsa.pub',
  '/.ssh/authorized_keys',
  '/crossdomain.xml',
  '/.well-known/security.txt',
]

export async function POST(request: NextRequest) {
  try {
    return await handleDeepScan(request)
  } catch (err: any) {
    return NextResponse.json({
      url: '',
      pages_crawled: 0,
      total_findings: 0,
      findings: [],
      crawled_pages: [],
      sensitive_files: [],
      source_maps: [],
      git_repo: null,
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      error: err?.message ?? 'Unknown error',
    })
  }
}

/**
 * Safely read response body handling non-UTF-8 charsets.
 */
async function safeText(res: Response): Promise<string> {
  try {
    const buf = await res.arrayBuffer()
    const ct = res.headers.get('content-type') || ''
    const charsetMatch = ct.match(/charset=([^\s;]+)/i)
    const charset = charsetMatch?.[1]?.toLowerCase().replace(/['"]/g, '') || 'utf-8'
    try {
      return new TextDecoder(charset).decode(buf)
    } catch {
      return new TextDecoder('utf-8', { fatal: false }).decode(buf)
    }
  } catch {
    return ''
  }
}

async function handleDeepScan(request: NextRequest) {
  const body = await request.json()
  const { url, maxPages = 20, maxDepth = 3 } = body as { url?: string; maxPages?: number; maxDepth?: number }

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  const baseUrl = url.replace(/\/$/, '')
  const baseHost = new URL(baseUrl).hostname
  const findings: SecretFinding[] = []
  const crawled: CrawledPage[] = []
  const visited = new Set<string>()
  const queue: { url: string; depth: number }[] = [{ url: baseUrl, depth: 0 }]

  // ── Phase 1: Crawl pages and scan for secrets ───────────────────────────────
  while (queue.length > 0 && crawled.length < maxPages) {
    const { url: pageUrl, depth } = queue.shift()!
    if (visited.has(pageUrl) || depth > maxDepth) continue
    visited.add(pageUrl)

    try {
      const res = await fetch(pageUrl, {
        headers: { 'User-Agent': 'KAYO-DeepScan/1.0 (Security Audit)' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
        cache: 'no-store',
      })

      if (!res.ok && res.status !== 403) continue

      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('text/html') && !contentType.includes('javascript') && !contentType.includes('json')) {
        crawled.push({ url: pageUrl, status: res.status })
        continue
      }

      const text = await safeText(res)
      const title = text.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim()

      crawled.push({
        url: pageUrl,
        status: res.status,
        title,
        forms: (text.match(/<form/gi) || []).length,
        scripts: (text.match(/<script/gi) || []).length,
      })

      // Scan for secrets
      scanForSecrets(text, pageUrl, findings)

      // Check for pre-filled form credentials
      scanForms(text, pageUrl, findings)

      // Extract internal links to crawl
      if (depth < maxDepth) {
        const linkPattern = /href=["']([^"'#]+)["']/gi
        let match: RegExpExecArray | null
        while ((match = linkPattern.exec(text)) !== null) {
          const href = match[1]
          try {
            const resolved = new URL(href, pageUrl)
            if (resolved.hostname === baseHost && !visited.has(resolved.href) && resolved.href.length < 300) {
              // Skip assets
              if (!/\.(png|jpg|jpeg|gif|svg|ico|css|woff|woff2|ttf|eot|mp4|webm|pdf)$/i.test(resolved.pathname)) {
                queue.push({ url: resolved.href, depth: depth + 1 })
              }
            }
          } catch {}
        }

        // Find and scan linked JS files
        const scriptPattern = /src=["']([^"']+\.js[^"']*)["']/gi
        while ((match = scriptPattern.exec(text)) !== null) {
          try {
            const jsUrl = new URL(match[1], pageUrl).href
            if (!visited.has(jsUrl) && new URL(jsUrl).hostname === baseHost) {
              queue.push({ url: jsUrl, depth: depth + 1 })
            }
          } catch {}
        }
      }
    } catch {}
  }

  // ── Phase 2: Check sensitive file paths ─────────────────────────────────────
  const sensitiveFileResults: { path: string; status: number; leaked: boolean; contentPreview?: string }[] = []

  const batchSize = 6
  for (let i = 0; i < SENSITIVE_PATHS.length; i += batchSize) {
    const batch = SENSITIVE_PATHS.slice(i, i + batchSize)
    const checks = batch.map(async (path) => {
      try {
        const res = await fetch(`${baseUrl}${path}`, {
          headers: { 'User-Agent': 'KAYO-DeepScan/1.0' },
          signal: AbortSignal.timeout(4000),
          redirect: 'manual',
          cache: 'no-store',
        })

        if (res.status === 200) {
          const ct = res.headers.get('content-type') || ''
          // Check if it's actually a real file (not a custom 404 page)
          const text = await safeText(res)
          const isReal = text.length < 500000 && (
            path.includes('.env') ? text.includes('=') :
            path.includes('.git') ? (text.includes('[core]') || text.includes('ref:')) :
            path.includes('.json') ? text.startsWith('{') || text.startsWith('[') :
            path.includes('.sql') ? text.toLowerCase().includes('create') || text.toLowerCase().includes('insert') :
            text.length > 0 && text.length < 100000
          )

          if (isReal) {
            sensitiveFileResults.push({ path, status: 200, leaked: true, contentPreview: text.substring(0, 200) })

            // Also scan the content for secrets
            scanForSecrets(text, `${baseUrl}${path}`, findings)

            findings.push({
              type: 'Exposed Sensitive File',
              severity: path.includes('.env') || path.includes('private') || path.includes('.sql') ? 'critical' :
                       path.includes('.git') || path.includes('config') ? 'high' : 'medium',
              value: path,
              location: `${baseUrl}${path}`,
              context: `File accessible at ${path} (${text.length} bytes)`,
            })
          }
        }
      } catch {}
    })
    await Promise.allSettled(checks)
  }

  // ── Phase 3: Check for exposed source maps ──────────────────────────────────
  const sourceMaps: string[] = []
  for (const page of crawled) {
    if (page.url.endsWith('.js')) {
      try {
        const mapUrl = page.url + '.map'
        const res = await fetch(mapUrl, {
          headers: { 'User-Agent': 'KAYO-DeepScan/1.0' },
          signal: AbortSignal.timeout(3000),
          cache: 'no-store',
        })
        if (res.status === 200) {
          const text = await safeText(res)
          if (text.includes('"sources"') || text.includes('"mappings"')) {
            sourceMaps.push(mapUrl)
            findings.push({
              type: 'Exposed Source Map',
              severity: 'medium',
              value: mapUrl,
              location: mapUrl,
              context: 'Source map file exposes original source code — may reveal business logic and secrets',
            })
          }
        }
      } catch {}
    }
  }

  // Deduplicate findings
  const seen = new Set<string>()
  const uniqueFindings = findings.filter(f => {
    const key = `${f.type}:${f.value}:${f.location}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // ── Phase 4: Discover Git repository URL ────────────────────────────────────
  let gitRepoUrl: string | null = null

  // Method 1: Check exposed .git/config
  try {
    const gitConfigRes = await fetch(`${baseUrl}/.git/config`, {
      headers: { 'User-Agent': 'KAYO-DeepScan/1.0' },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    })
    if (gitConfigRes.status === 200) {
      const gitConfig = await gitConfigRes.text()
      if (gitConfig.includes('[core]') || gitConfig.includes('[remote')) {
        const remoteMatch = gitConfig.match(/url\s*=\s*(https?:\/\/[^\s]+|git@[^\s]+)/m)
        if (remoteMatch) {
          gitRepoUrl = remoteMatch[1].replace(/\.git$/, '')
          if (gitRepoUrl.startsWith('git@')) {
            gitRepoUrl = gitRepoUrl.replace(/^git@([^:]+):/, 'https://$1/')
          }
        }
      }
    }
  } catch {}

  // Method 2: Scan crawled pages for GitHub/GitLab/Bitbucket links
  if (!gitRepoUrl) {
    for (const page of crawled) {
      try {
        const res = await fetch(page.url, {
          headers: { 'User-Agent': 'KAYO-DeepScan/1.0' },
          signal: AbortSignal.timeout(4000),
          cache: 'no-store',
        })
        if (res.ok) {
          const text = await safeText(res)
          const repoPatterns = [
            /https?:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+/g,
            /https?:\/\/gitlab\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+/g,
            /https?:\/\/bitbucket\.org\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+/g,
          ]
          for (const pattern of repoPatterns) {
            const match = text.match(pattern)
            if (match) {
              // Filter out common non-repo GitHub links
              const candidate = match[0].replace(/\.git$/, '')
              if (!/\/(issues|pulls|actions|marketplace|topics|trending|features|pricing|blog)/.test(candidate)) {
                gitRepoUrl = candidate
                break
              }
            }
          }
          if (gitRepoUrl) break
        }
      } catch {}
    }
  }

  // Method 3: Check package.json for repository field
  if (!gitRepoUrl) {
    try {
      const pkgRes = await fetch(`${baseUrl}/package.json`, {
        headers: { 'User-Agent': 'KAYO-DeepScan/1.0' },
        signal: AbortSignal.timeout(3000),
        cache: 'no-store',
      })
      if (pkgRes.status === 200) {
        const text = await pkgRes.text()
        if (text.startsWith('{')) {
          const pkg = JSON.parse(text)
          if (pkg.repository) {
            const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
            if (repo) {
              gitRepoUrl = repo.replace(/^git\+/, '').replace(/\.git$/, '')
              if (gitRepoUrl!.startsWith('git@')) {
                gitRepoUrl = gitRepoUrl!.replace(/^git@([^:]+):/, 'https://$1/')
              }
            }
          }
        }
      }
    } catch {}
  }

  // Method 4: Check HTML meta/data attributes
  if (!gitRepoUrl) {
    try {
      const mainRes = await fetch(baseUrl, {
        headers: { 'User-Agent': 'KAYO-DeepScan/1.0' },
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
      })
      if (mainRes.ok) {
        const html = await safeText(mainRes)
        const ghMatch = html.match(/(?:data-repo|data-source|data-github)\s*=\s*["']([^"']+)["']/i)
        if (ghMatch) gitRepoUrl = ghMatch[1]
      }
    } catch {}
  }

  return NextResponse.json({
    url: baseUrl,
    pages_crawled: crawled.length,
    total_findings: uniqueFindings.length,
    findings: uniqueFindings,
    crawled_pages: crawled,
    sensitive_files: sensitiveFileResults,
    source_maps: sourceMaps,
    git_repo: gitRepoUrl,
    summary: {
      critical: uniqueFindings.filter(f => f.severity === 'critical').length,
      high: uniqueFindings.filter(f => f.severity === 'high').length,
      medium: uniqueFindings.filter(f => f.severity === 'medium').length,
      low: uniqueFindings.filter(f => f.severity === 'low').length,
    },
  })
}

// ── Secret scanner ────────────────────────────────────────────────────────────

// Domains that are never credentials (CDNs, fonts, APIs)
const SAFE_DOMAINS = [
  'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com', 'unpkg.com', 'ajax.googleapis.com',
  'apis.google.com', 'www.google.com', 'www.gstatic.com',
  'cdn.tailwindcss.com', 'kit.fontawesome.com', 'use.typekit.net',
  'cloudflare.com', 'bootstrapcdn.com', 'jquery.com',
]

function scanForSecrets(content: string, location: string, findings: SecretFinding[]) {
  for (const { name, pattern, severity } of SECRET_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) {
      const value = match[0]
      // Skip obvious false positives
      if (value.length > 500) continue
      if (/^(example|test|placeholder|your[_-]|changeme|xxx)/i.test(match[1] || value)) continue

      // Skip safe CDN/font domains for URL-based patterns
      if (name === 'Credentials in URL') {
        if (SAFE_DOMAINS.some(d => value.includes(d))) continue
        // Also skip if it's a font family query string (contains "family=" or "wght")
        if (/family=|wght|opsz|ital|display=swap/i.test(value)) continue
      }

      // Skip common false positives for hardcoded secrets
      if (name === 'Hardcoded Secret' || name === 'Hardcoded Password') {
        const secretValue = match[1] || ''
        // Skip CSS values, font names, common config keys
        if (/^(inherit|none|auto|normal|bold|italic|block|flex|grid|sans-serif|serif|monospace)/i.test(secretValue)) continue
        if (/^(true|false|null|undefined|localhost|0\.0\.0\.0|127\.0\.0\.1)$/i.test(secretValue)) continue
        if (/^(application\/json|text\/html|utf-8|get|post|put|delete)$/i.test(secretValue)) continue
        // Must look like an actual secret (has mixed chars, not just a word)
        if (secretValue.length < 6) continue
        if (/^[a-z-]+$/.test(secretValue)) continue  // just lowercase words/slugs
      }

      // Get surrounding context (redacted)
      const start = Math.max(0, match.index - 40)
      const end = Math.min(content.length, match.index + value.length + 40)
      const context = content.substring(start, end).replace(/\n/g, ' ').trim()

      // Redact the actual secret value
      const redactedValue = value.length > 12
        ? value.substring(0, 6) + '***' + value.substring(value.length - 4)
        : value.substring(0, 3) + '***'

      findings.push({
        type: name,
        severity,
        value: redactedValue,
        location,
        context: context.length > 120 ? context.substring(0, 120) + '...' : context,
      })
    }
  }
}

// ── Form credential scanner ───────────────────────────────────────────────────
function scanForms(html: string, location: string, findings: SecretFinding[]) {
  // Check for pre-filled password fields
  const passwordFields = html.match(/<input[^>]*type=["']password["'][^>]*value=["']([^"']+)["'][^>]*>/gi) || []
  for (const field of passwordFields) {
    const valueMatch = field.match(/value=["']([^"']+)["']/i)
    if (valueMatch && valueMatch[1].length > 0) {
      findings.push({
        type: 'Pre-filled Password Field',
        severity: 'critical',
        value: valueMatch[1].substring(0, 3) + '***',
        location,
        context: `Password input field has a pre-filled value`,
      })
    }
  }

  // Check for default credentials in comments
  const commentPattern = /<!--[\s\S]*?-->/g
  let match: RegExpExecArray | null
  while ((match = commentPattern.exec(html)) !== null) {
    const comment = match[0].toLowerCase()
    if (/(password|credentials|login|admin|user.*pass|default.*auth)/i.test(comment)) {
      findings.push({
        type: 'Credentials in HTML Comment',
        severity: 'high',
        value: match[0].substring(0, 50).replace(/\n/g, ' '),
        location,
        context: `HTML comment may contain credentials: ${match[0].substring(4, 80)}`,
      })
    }
  }

  // Check for hidden inputs with suspicious names
  const hiddenInputs = html.match(/<input[^>]*type=["']hidden["'][^>]*>/gi) || []
  for (const input of hiddenInputs) {
    const nameMatch = input.match(/name=["']([^"']+)["']/i)
    const valueMatch = input.match(/value=["']([^"']+)["']/i)
    if (nameMatch && valueMatch) {
      const name = nameMatch[1].toLowerCase()
      if (/(token|key|secret|api|auth|session|csrf)/i.test(name) && valueMatch[1].length > 10) {
        findings.push({
          type: 'Sensitive Hidden Input',
          severity: 'medium',
          value: `${nameMatch[1]}=${valueMatch[1].substring(0, 8)}...`,
          location,
          context: `Hidden form field "${nameMatch[1]}" contains a potentially sensitive value`,
        })
      }
    }
  }
}
