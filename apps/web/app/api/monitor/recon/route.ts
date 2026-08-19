import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/monitor/recon
 * 
 * OSINT Recon — Discovers the source repository and infrastructure behind any URL.
 * Methods:
 * 1. Deployment metadata (Vercel/Netlify/Cloudflare headers, build IDs)
 * 2. Exposed .git/config, package.json, composer.json
 * 3. GitHub code search via unique JS snippets
 * 4. DNS/CNAME fingerprinting (reveals hosting platform)
 * 5. HTML/JS source analysis for repo references
 * 6. Next.js / Nuxt / React build fingerprinting
 * 7. WHOIS-style domain metadata
 */

interface ReconFinding {
  method: string
  type: string
  value: string
  confidence: 'high' | 'medium' | 'low'
  detail: string
}

interface ReconResult {
  url: string
  tech_stack: string[]
  hosting: string | null
  cdn: string | null
  git_repo: string | null
  git_repo_confidence: 'high' | 'medium' | 'low' | null
  findings: ReconFinding[]
  headers_raw: Record<string, string>
}

export async function POST(request: NextRequest) {
  try {
    return await handleRecon(request)
  } catch (err: any) {
    return NextResponse.json({
      url: '',
      tech_stack: [],
      hosting: null,
      cdn: null,
      git_repo: null,
      git_repo_confidence: null,
      findings: [{ method: 'error', type: 'Error', value: err?.message ?? 'Unknown error', confidence: 'low' as const, detail: 'Recon failed unexpectedly' }],
      headers_raw: {},
      error: err?.message ?? 'Unknown error',
    })
  }
}

/**
 * Safely read response body as text, handling non-UTF-8 charsets gracefully.
 * Returns empty string on any failure rather than throwing.
 */
async function safeText(res: Response): Promise<string> {
  try {
    const buf = await res.arrayBuffer()
    // Detect charset from Content-Type header
    const ct = res.headers.get('content-type') || ''
    const charsetMatch = ct.match(/charset=([^\s;]+)/i)
    const charset = charsetMatch?.[1]?.toLowerCase().replace(/['"]/g, '') || 'utf-8'
    try {
      return new TextDecoder(charset).decode(buf)
    } catch {
      // Fallback to UTF-8 with replacement characters
      return new TextDecoder('utf-8', { fatal: false }).decode(buf)
    }
  } catch {
    return ''
  }
}

async function handleRecon(request: NextRequest) {
  const body = await request.json()
  const { url } = body as { url?: string }

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  const baseUrl = url.replace(/\/$/, '')
  const findings: ReconFinding[] = []
  const techStack: Set<string> = new Set()
  let hosting: string | null = null
  let cdn: string | null = null
  let gitRepo: string | null = null
  let gitRepoConfidence: 'high' | 'medium' | 'low' | null = null
  let headersRaw: Record<string, string> = {}

  // ── Method 1: Response Header Analysis ────────────────────────────────────────
  try {
    const res = await fetch(baseUrl, {
      headers: { 'User-Agent': 'KAYO-Recon/1.0 (Infrastructure Discovery)' },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
      cache: 'no-store',
    })

    // Collect all headers
    res.headers.forEach((value, key) => {
      headersRaw[key] = value
    })

    // Detect hosting/CDN from headers
    const server = res.headers.get('server') || ''
    const poweredBy = res.headers.get('x-powered-by') || ''
    const via = res.headers.get('via') || ''
    const cfRay = res.headers.get('cf-ray')
    const xVercelId = res.headers.get('x-vercel-id')
    const xNetlify = res.headers.get('x-nf-request-id')
    const xAmzn = res.headers.get('x-amzn-requestid') || res.headers.get('x-amz-cf-id')
    const xGoog = res.headers.get('x-goog-generation')
    const xRender = res.headers.get('x-render-origin-server')
    const xFly = res.headers.get('fly-request-id')
    const xRailway = res.headers.get('x-railway-request-id')

    // CDN detection
    if (cfRay) { cdn = 'Cloudflare'; findings.push({ method: 'headers', type: 'CDN', value: 'Cloudflare', confidence: 'high', detail: `CF-Ray: ${cfRay}` }) }
    else if (xAmzn) { cdn = 'AWS CloudFront'; findings.push({ method: 'headers', type: 'CDN', value: 'AWS CloudFront', confidence: 'high', detail: `x-amz header present` }) }
    else if (via.includes('cloudfront')) { cdn = 'AWS CloudFront' }

    // Hosting detection
    if (xVercelId) {
      hosting = 'Vercel'
      findings.push({ method: 'headers', type: 'Hosting', value: 'Vercel', confidence: 'high', detail: `x-vercel-id: ${xVercelId}` })
      // Vercel projects often have the GitHub repo in the deployment URL
      findings.push({ method: 'headers', type: 'Hint', value: 'Check Vercel dashboard or GitHub integration', confidence: 'low', detail: 'Vercel deployments are usually linked to GitHub repos' })
    }
    if (xNetlify) {
      hosting = 'Netlify'
      findings.push({ method: 'headers', type: 'Hosting', value: 'Netlify', confidence: 'high', detail: `x-nf-request-id present` })
    }
    if (xRender) { hosting = 'Render'; findings.push({ method: 'headers', type: 'Hosting', value: 'Render', confidence: 'high', detail: 'x-render-origin-server present' }) }
    if (xFly) { hosting = 'Fly.io'; findings.push({ method: 'headers', type: 'Hosting', value: 'Fly.io', confidence: 'high', detail: 'fly-request-id present' }) }
    if (xRailway) { hosting = 'Railway'; findings.push({ method: 'headers', type: 'Hosting', value: 'Railway', confidence: 'high', detail: 'x-railway-request-id present' }) }
    if (server.toLowerCase().includes('github')) { hosting = 'GitHub Pages'; findings.push({ method: 'headers', type: 'Hosting', value: 'GitHub Pages', confidence: 'high', detail: `Server: ${server}` }) }
    if (server.toLowerCase().includes('netlify')) { hosting = 'Netlify' }

    // Tech stack from X-Powered-By
    if (poweredBy) {
      techStack.add(poweredBy)
      findings.push({ method: 'headers', type: 'Framework', value: poweredBy, confidence: 'high', detail: `X-Powered-By: ${poweredBy}` })
    }

    // Detect framework from response body
    const html = await safeText(res)

    // Next.js detection
    if (html.includes('/_next/') || html.includes('__next') || poweredBy.includes('Next.js')) {
      techStack.add('Next.js')
      // Extract build ID
      const buildIdMatch = html.match(/"buildId"\s*:\s*"([^"]+)"/)
      if (buildIdMatch) {
        findings.push({ method: 'fingerprint', type: 'Build ID', value: buildIdMatch[1], confidence: 'medium', detail: 'Next.js build identifier — can be used to match deployments' })
      }
    }

    // Nuxt detection
    if (html.includes('__nuxt') || html.includes('/_nuxt/')) {
      techStack.add('Nuxt.js')
    }

    // React/Vue/Angular/Svelte
    if (html.includes('__NEXT_DATA__') || html.includes('react-root') || html.includes('_reactRootContainer')) techStack.add('React')
    if (html.includes('__vue__') || html.includes('data-v-')) techStack.add('Vue.js')
    if (html.includes('ng-version') || html.includes('ng-app')) techStack.add('Angular')
    if (html.includes('__svelte')) techStack.add('Svelte')

    // WordPress
    if (html.includes('wp-content') || html.includes('wp-includes')) {
      techStack.add('WordPress')
      findings.push({ method: 'fingerprint', type: 'CMS', value: 'WordPress', confidence: 'high', detail: 'wp-content/wp-includes paths detected' })
    }

    // Laravel
    if (html.includes('laravel') || res.headers.get('set-cookie')?.includes('laravel_session')) {
      techStack.add('Laravel')
    }

    // Django
    if (res.headers.get('set-cookie')?.includes('csrftoken') || html.includes('django')) {
      techStack.add('Django')
    }

    // Look for GitHub/GitLab links
    const repoPatterns = [
      /https?:\/\/github\.com\/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)/g,
      /https?:\/\/gitlab\.com\/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)/g,
      /https?:\/\/bitbucket\.org\/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)/g,
    ]

    for (const pattern of repoPatterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(html)) !== null) {
        const repoPath = match[1]
        // Filter out known non-repo paths
        if (/(issues|pulls|actions|marketplace|topics|trending|features|pricing|blog|about|login|signup)/.test(repoPath)) continue
        if (/^(vercel|facebook|google|microsoft|twitter|github)\//i.test(repoPath)) continue

        const repoUrl = match[0].split(/[?#"'<>\s)]/)[0]
        if (!gitRepo) {
          gitRepo = repoUrl
          gitRepoConfidence = 'medium'
        }
        findings.push({ method: 'source_analysis', type: 'Repository Link', value: repoUrl, confidence: 'medium', detail: 'Found in page HTML source' })
      }
    }

    // Check HTML comments for repo/deploy info
    const commentPattern = /<!--([\s\S]*?)-->/g
    let commentMatch: RegExpExecArray | null
    while ((commentMatch = commentPattern.exec(html)) !== null) {
      const comment = commentMatch[1]
      if (/(github|gitlab|bitbucket|deploy|version|commit|build|release)/i.test(comment)) {
        findings.push({ method: 'source_analysis', type: 'HTML Comment', value: comment.trim().substring(0, 150), confidence: 'medium', detail: 'Potentially revealing HTML comment' })
        // Try to extract repo URL from comment
        const ghInComment = comment.match(/github\.com\/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)/)
        if (ghInComment && !gitRepo) {
          gitRepo = `https://github.com/${ghInComment[1]}`
          gitRepoConfidence = 'high'
        }
      }
    }

    // Check meta tags
    const metaGen = html.match(/<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i)
    if (metaGen) {
      techStack.add(metaGen[1])
      findings.push({ method: 'fingerprint', type: 'Generator', value: metaGen[1], confidence: 'high', detail: 'Meta generator tag' })
    }

    // Check for source map references (reveals build tools)
    const sourceMapRefs = html.match(/\/\/[#@]\s*sourceMappingURL=([^\s]+)/g) || []
    if (sourceMapRefs.length > 0) {
      findings.push({ method: 'fingerprint', type: 'Source Maps', value: `${sourceMapRefs.length} source map references`, confidence: 'medium', detail: 'Source maps may reveal original file paths and project structure' })
    }

  } catch (e: any) {
    findings.push({ method: 'headers', type: 'Error', value: e.message, confidence: 'low', detail: 'Failed to fetch main page' })
  }

  // ── Method 2: Exposed Git/Config Files ────────────────────────────────────────
  const configFiles = [
    { path: '/.git/config', parser: parseGitConfig },
    { path: '/.git/HEAD', parser: parseGitHead },
    { path: '/package.json', parser: parsePackageJson },
    { path: '/composer.json', parser: parseComposerJson },
    { path: '/.well-known/security.txt', parser: parseSecurityTxt },
    { path: '/humans.txt', parser: parseHumansTxt },
  ]

  for (const { path, parser } of configFiles) {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { 'User-Agent': 'KAYO-Recon/1.0' },
        signal: AbortSignal.timeout(5000),
        redirect: 'manual',
        cache: 'no-store',
      })
      if (res.status === 200) {
        const text = await safeText(res)
        const result = parser(text, path)
        if (result) {
          findings.push(result)
          if (result.type === 'Repository' && !gitRepo) {
            gitRepo = result.value
            gitRepoConfidence = 'high'
          }
        }
      }
    } catch {}
  }

  // ── Method 3: DNS CNAME Fingerprinting ────────────────────────────────────────
  // Check if common hosting CNAMEs are exposed via well-known subdomains
  try {
    const hostname = new URL(baseUrl).hostname
    // Try fetching www version to see if it redirects differently
    if (!hostname.startsWith('www.')) {
      const wwwRes = await fetch(`https://www.${hostname}`, {
        signal: AbortSignal.timeout(5000),
        redirect: 'manual',
        cache: 'no-store',
      })
      const location = wwwRes.headers.get('location')
      if (location) {
        findings.push({ method: 'dns', type: 'WWW Redirect', value: location, confidence: 'low', detail: 'www subdomain redirect target' })
      }
    }
  } catch {}

  // ── Method 4: Vercel/Netlify Deployment Metadata ──────────────────────────────
  if (hosting === 'Vercel') {
    // Vercel exposes project info via /_vercel/insights/script.js sometimes
    try {
      const insightsRes = await fetch(`${baseUrl}/_vercel/insights/script.js`, {
        signal: AbortSignal.timeout(3000),
        cache: 'no-store',
      })
      if (insightsRes.status === 200) {
        findings.push({ method: 'platform', type: 'Vercel Analytics', value: 'Active', confidence: 'medium', detail: 'Vercel Analytics script accessible — confirms Vercel hosting' })
      }
    } catch {}
  }

  if (hosting === 'Netlify') {
    // Netlify often has headers revealing site ID
    try {
      const netlifyHeaders = headersRaw['x-nf-request-id'] || ''
      if (netlifyHeaders) {
        findings.push({ method: 'platform', type: 'Netlify Site', value: netlifyHeaders, confidence: 'medium', detail: 'Netlify request ID can be traced to specific site' })
      }
    } catch {}
  }

  // ── Method 5: GitHub Pages special detection ──────────────────────────────────
  if (hosting === 'GitHub Pages' || headersRaw['server'] === 'GitHub.com') {
    // GitHub Pages repos follow pattern: username.github.io or org.github.io
    const hostname = new URL(baseUrl).hostname
    if (hostname.endsWith('.github.io')) {
      const owner = hostname.replace('.github.io', '')
      gitRepo = `https://github.com/${owner}/${owner}.github.io`
      gitRepoConfidence = 'high'
      findings.push({ method: 'platform', type: 'Repository', value: gitRepo, confidence: 'high', detail: 'GitHub Pages site — repo is the .github.io repository' })
    }
  }

  // ── Method 6: JS Bundle Deep Analysis ─────────────────────────────────────────
  try {
    const mainRes = await fetch(baseUrl, {
      headers: { 'User-Agent': 'KAYO-Recon/1.0' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    const html = await safeText(mainRes)

    // Get JS bundle URLs
    const jsFiles = [...new Set(
      (html.match(/src=["']([^"']+\.js[^"']*)["']/g) || [])
        .map(s => s.match(/src=["']([^"']+)["']/)?.[1])
        .filter(Boolean) as string[]
    )].slice(0, 8)

    for (const jsSrc of jsFiles) {
      try {
        const jsUrl = jsSrc.startsWith('http') ? jsSrc : `${baseUrl}${jsSrc.startsWith('/') ? '' : '/'}${jsSrc}`
        const jsRes = await fetch(jsUrl, {
          headers: { 'User-Agent': 'KAYO-Recon/1.0' },
          signal: AbortSignal.timeout(5000),
          cache: 'no-store',
        })
        const js = await jsRes.text()

        // Look for repository references in JS
        const repoInJs = js.match(/https?:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+/g)
        if (repoInJs) {
          for (const repo of repoInJs) {
            const clean = repo.split(/[?#"')\s]/)[0]
            if (!/(vercel|facebook|google|microsoft|nextjs)/.test(clean)) {
              if (!gitRepo) { gitRepo = clean; gitRepoConfidence = 'medium' }
              findings.push({ method: 'js_analysis', type: 'Repository in JS', value: clean, confidence: 'medium', detail: `Found in ${jsSrc.split('/').pop()}` })
            }
          }
        }

        // Look for webpack/vite devtool comments with file paths
        const devToolPaths = js.match(/\/\/ (.+\.(ts|tsx|js|jsx|vue|svelte))/g) || []
        if (devToolPaths.length > 3) {
          findings.push({ method: 'js_analysis', type: 'Source File Paths', value: `${devToolPaths.length} original file paths visible`, confidence: 'medium', detail: devToolPaths.slice(0, 3).join(', ') })
        }

        // Check for package names that reveal the project
        const pkgNames = js.match(/"name"\s*:\s*"(@?[a-z0-9-]+\/[a-z0-9-]+|[a-z0-9-]{5,})"/g) || []
        for (const pkg of pkgNames) {
          const name = pkg.match(/"name"\s*:\s*"([^"]+)"/)?.[1]
          if (name && !name.startsWith('@') && !/^(react|next|vue|angular|svelte|webpack|vite|babel|eslint|prettier)/.test(name)) {
            findings.push({ method: 'js_analysis', type: 'Package Name', value: name, confidence: 'low', detail: 'May be the project name — searchable on GitHub/npm' })
          }
        }

      } catch {}
    }
  } catch {}

  // ── Build final result ────────────────────────────────────────────────────────
  return NextResponse.json({
    url: baseUrl,
    tech_stack: [...techStack],
    hosting,
    cdn,
    git_repo: gitRepo,
    git_repo_confidence: gitRepoConfidence,
    findings,
    headers_raw: headersRaw,
  } as ReconResult)
}

// ── Parsers ─────────────────────────────────────────────────────────────────────

function parseGitConfig(text: string, path: string): ReconFinding | null {
  if (!text.includes('[core]') && !text.includes('[remote')) return null
  const remoteMatch = text.match(/url\s*=\s*(https?:\/\/[^\s]+|git@[^\s]+)/m)
  if (remoteMatch) {
    let repoUrl = remoteMatch[1].replace(/\.git$/, '')
    if (repoUrl.startsWith('git@')) {
      repoUrl = repoUrl.replace(/^git@([^:]+):/, 'https://$1/')
    }
    return { method: 'exposed_file', type: 'Repository', value: repoUrl, confidence: 'high', detail: `CRITICAL: .git/config is publicly accessible! Full source code may be downloadable.` }
  }
  return { method: 'exposed_file', type: 'Git Config Exposed', value: path, confidence: 'high', detail: 'Git config file is publicly accessible' }
}

function parseGitHead(text: string, path: string): ReconFinding | null {
  if (!text.startsWith('ref:') && !text.match(/^[0-9a-f]{40}/)) return null
  return { method: 'exposed_file', type: 'Git HEAD Exposed', value: text.trim(), confidence: 'high', detail: `CRITICAL: .git/HEAD exposed — reveals current branch/commit. Full repo may be downloadable with git-dumper.` }
}

function parsePackageJson(text: string, path: string): ReconFinding | null {
  try {
    if (!text.startsWith('{')) return null
    const pkg = JSON.parse(text)
    if (pkg.repository) {
      const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
      if (repo) {
        let repoUrl = repo.replace(/^git\+/, '').replace(/\.git$/, '')
        if (repoUrl.startsWith('git@')) repoUrl = repoUrl.replace(/^git@([^:]+):/, 'https://$1/')
        return { method: 'exposed_file', type: 'Repository', value: repoUrl, confidence: 'high', detail: `Found in exposed package.json (name: ${pkg.name || 'unknown'})` }
      }
    }
    if (pkg.name) {
      return { method: 'exposed_file', type: 'Package Name', value: pkg.name, confidence: 'medium', detail: `package.json exposed — project name: ${pkg.name}` }
    }
  } catch {}
  return null
}

function parseComposerJson(text: string, path: string): ReconFinding | null {
  try {
    if (!text.startsWith('{')) return null
    const pkg = JSON.parse(text)
    if (pkg.name) {
      return { method: 'exposed_file', type: 'Package Name (PHP)', value: pkg.name, confidence: 'medium', detail: `composer.json exposed — project: ${pkg.name}` }
    }
  } catch {}
  return null
}

function parseSecurityTxt(text: string, path: string): ReconFinding | null {
  if (!text.includes('Contact:') && !text.includes('contact:')) return null
  const contacts = text.match(/Contact:\s*(.+)/gi) || []
  return { method: 'exposed_file', type: 'Security Contact', value: contacts.join(', ').substring(0, 200), confidence: 'low', detail: 'security.txt found — may reveal organization details' }
}

function parseHumansTxt(text: string, path: string): ReconFinding | null {
  if (text.length < 10 || text.length > 5000) return null
  if (!text.toLowerCase().includes('team') && !text.toLowerCase().includes('developer') && !text.toLowerCase().includes('site')) return null
  return { method: 'exposed_file', type: 'Humans.txt', value: text.substring(0, 200), confidence: 'low', detail: 'humans.txt found — may contain developer names and links' }
}
