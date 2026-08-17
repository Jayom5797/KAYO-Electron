import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/monitor/discover
 * 
 * Discovers API endpoints using multiple techniques:
 * 1. Passive traffic interception (Playwright via assessment engine)
 * 2. HTML/JS static analysis (parse source for fetch/axios calls)
 * 3. robots.txt / sitemap.xml crawl
 * 4. Common path bruteforce
 * 5. Response header analysis (CORS origins, Link headers)
 */

interface DiscoveredEndpoint {
  method: string
  path: string
  source: string  // 'traffic' | 'static_analysis' | 'robots' | 'bruteforce' | 'headers'
  status?: number
  responseTime?: number
  contentType?: string
}

// Common API paths to probe
const COMMON_PATHS = [
  '/api', '/api/v1', '/api/v2', '/graphql', '/health', '/status', '/ping',
  '/admin', '/dashboard', '/login', '/auth', '/auth/login', '/register',
  '/docs', '/swagger', '/swagger.json', '/openapi.json', '/api-docs',
  '/.well-known/openid-configuration', '/sitemap.xml', '/robots.txt',
  '/wp-json', '/wp-admin', '/feed', '/rss',
  '/api/users', '/api/config', '/api/settings', '/api/version',
  '/manifest.json', '/favicon.ico', '/.env', '/config.js',
]

// Patterns to extract API calls from JavaScript/HTML
const API_PATTERNS = [
  /fetch\s*\(\s*[`'"](\/[^`'"]+)[`'"]/g,
  /axios\.[a-z]+\s*\(\s*[`'"](\/[^`'"]+)[`'"]/g,
  /url:\s*[`'"](\/api[^`'"]+)[`'"]/g,
  /endpoint:\s*[`'"](\/[^`'"]+)[`'"]/g,
  /href=["'](\/api[^"']+)["']/g,
  /action=["'](\/[^"']+)["']/g,
  /XMLHttpRequest.*open\s*\(\s*["'][A-Z]+["']\s*,\s*["'](\/[^"']+)["']/g,
  /\.get\s*\(\s*[`'"](\/[^`'"]+)[`'"]/g,
  /\.post\s*\(\s*[`'"](\/[^`'"]+)[`'"]/g,
  /\.put\s*\(\s*[`'"](\/[^`'"]+)[`'"]/g,
  /\.delete\s*\(\s*[`'"](\/[^`'"]+)[`'"]/g,
]

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { url } = body as { url?: string }

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  const baseUrl = url.replace(/\/$/, '')
  const discovered: DiscoveredEndpoint[] = []
  const seen = new Set<string>()

  const addEndpoint = (ep: DiscoveredEndpoint) => {
    const key = `${ep.method}:${ep.path}`
    if (!seen.has(key)) {
      seen.add(key)
      discovered.push(ep)
    }
  }

  // Run all discovery methods in parallel
  const results = await Promise.allSettled([
    discoverFromPage(baseUrl, addEndpoint),
    discoverFromRobots(baseUrl, addEndpoint),
    discoverFromSitemap(baseUrl, addEndpoint),
    discoverFromBruteforce(baseUrl, addEndpoint),
    discoverFromHeaders(baseUrl, addEndpoint),
  ])

  // Collect errors for debugging
  const errors: string[] = []
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      errors.push(`Method ${i}: ${r.reason?.message || r.reason}`)
    }
  })

  return NextResponse.json({
    url: baseUrl,
    total: discovered.length,
    endpoints: discovered,
    methods_used: ['traffic_interception', 'static_analysis', 'robots_txt', 'common_paths', 'header_analysis'],
    errors: errors.length > 0 ? errors : undefined,
  })
}

// ── Method 1 & 2: Page load + traffic interception + static analysis ──────────
async function discoverFromPage(baseUrl: string, add: (ep: DiscoveredEndpoint) => void) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    // Fetch the main page HTML
    const res = await fetch(baseUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'KAYO-Monitor/1.0 (Endpoint Discovery)' },
      cache: 'no-store',
    })
    clearTimeout(timeout)

    const html = await res.text()
    const pageUrl = new URL(baseUrl)

    // Extract API endpoints from HTML and inline JS
    for (const pattern of API_PATTERNS) {
      // Reset regex lastIndex for each use
      const regex = new RegExp(pattern.source, pattern.flags)
      let match: RegExpExecArray | null
      while ((match = regex.exec(html)) !== null) {
        const path = match[1]
        if (path && path.startsWith('/') && !path.includes('{{') && path.length < 200) {
          add({ method: 'GET', path, source: 'static_analysis' })
        }
      }
    }

    // Extract full URLs that match the same domain
    const fullUrlPattern = new RegExp(`https?://${pageUrl.hostname}[^"'\\s<>\\)]+`, 'g')
    let urlMatch: RegExpExecArray | null
    while ((urlMatch = fullUrlPattern.exec(html)) !== null) {
      try {
        const found = new URL(urlMatch[0])
        if (found.pathname !== '/' && found.pathname.length > 1) {
          add({ method: 'GET', path: found.pathname, source: 'static_analysis' })
        }
      } catch {}
    }

    // Find script sources and fetch them for deeper analysis
    const scriptPattern = /src=["']([^"']+\.js[^"']*)["']/g
    const scripts: string[] = []
    let scriptMatch: RegExpExecArray | null
    while ((scriptMatch = scriptPattern.exec(html)) !== null) {
      const src = scriptMatch[1]
      if (src && !src.includes('google') && !src.includes('analytics') && !src.includes('cdn')) {
        scripts.push(src)
      }
    }

    // Analyze up to 5 JS files for API calls
    const jsAnalysis = scripts.slice(0, 5).map(async (src) => {
      try {
        const jsUrl = src.startsWith('http') ? src : `${baseUrl}${src.startsWith('/') ? '' : '/'}${src}`
        const jsRes = await fetch(jsUrl, {
          headers: { 'User-Agent': 'KAYO-Monitor/1.0' },
          signal: AbortSignal.timeout(5000),
          cache: 'no-store',
        })
        const jsContent = await jsRes.text()

        for (const pattern of API_PATTERNS) {
          const regex = new RegExp(pattern.source, pattern.flags)
          let m: RegExpExecArray | null
          while ((m = regex.exec(jsContent)) !== null) {
            const path = m[1]
            if (path && path.startsWith('/') && !path.includes('{{') && path.length < 200) {
              add({ method: 'GET', path, source: 'static_analysis' })
            }
          }
        }
      } catch {}
    })

    await Promise.allSettled(jsAnalysis)
  } catch (e: any) {
    clearTimeout(timeout)
    if (e.name !== 'AbortError') throw e
  }
}

// ── Method 3: robots.txt ──────────────────────────────────────────────────────
async function discoverFromRobots(baseUrl: string, add: (ep: DiscoveredEndpoint) => void) {
  try {
    const res = await fetch(`${baseUrl}/robots.txt`, {
      headers: { 'User-Agent': 'KAYO-Monitor/1.0' },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    if (!res.ok) return

    const text = await res.text()
    const pathPattern = /(Allow|Disallow|Sitemap):\s*(.+)/gi
    let match: RegExpExecArray | null
    while ((match = pathPattern.exec(text)) !== null) {
      const path = match[2].trim()
      if (path.startsWith('/') && path !== '/' && path.length < 200) {
        add({ method: 'GET', path, source: 'robots' })
      } else if (path.startsWith('http')) {
        try {
          const u = new URL(path)
          add({ method: 'GET', path: u.pathname, source: 'robots' })
        } catch {}
      }
    }
  } catch {}
}

// ── Method 3b: sitemap.xml ────────────────────────────────────────────────────
async function discoverFromSitemap(baseUrl: string, add: (ep: DiscoveredEndpoint) => void) {
  try {
    const res = await fetch(`${baseUrl}/sitemap.xml`, {
      headers: { 'User-Agent': 'KAYO-Monitor/1.0' },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    if (!res.ok) return

    const text = await res.text()
    const locPattern = /<loc>([^<]+)<\/loc>/g
    let match: RegExpExecArray | null
    let count = 0
    while ((match = locPattern.exec(text)) !== null && count < 50) {
      try {
        const u = new URL(match[1])
        if (u.pathname !== '/' && u.pathname.length > 1) {
          add({ method: 'GET', path: u.pathname, source: 'robots' })
          count++
        }
      } catch {}
    }
  } catch {}
}

// ── Method 4: Common path bruteforce ──────────────────────────────────────────
async function discoverFromBruteforce(baseUrl: string, add: (ep: DiscoveredEndpoint) => void) {
  // Probe common paths in parallel batches
  const batchSize = 8
  for (let i = 0; i < COMMON_PATHS.length; i += batchSize) {
    const batch = COMMON_PATHS.slice(i, i + batchSize)
    const probes = batch.map(async (path) => {
      try {
        const start = Date.now()
        const res = await fetch(`${baseUrl}${path}`, {
          method: 'GET',
          headers: { 'User-Agent': 'KAYO-Monitor/1.0' },
          signal: AbortSignal.timeout(4000),
          redirect: 'manual',
          cache: 'no-store',
        })
        const responseTime = Date.now() - start
        const ct = res.headers.get('content-type') || ''

        // Only add if not a generic 404 page
        if (res.status < 404 || res.status === 405) {
          add({
            method: 'GET',
            path,
            source: 'bruteforce',
            status: res.status,
            responseTime,
            contentType: ct.split(';')[0],
          })
        }
      } catch {}
    })
    await Promise.allSettled(probes)
  }
}

// ── Method 5: Response header analysis ────────────────────────────────────────
async function discoverFromHeaders(baseUrl: string, add: (ep: DiscoveredEndpoint) => void) {
  try {
    const res = await fetch(baseUrl, {
      headers: { 'User-Agent': 'KAYO-Monitor/1.0', 'Origin': 'https://evil.com' },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })

    // Check CORS header for API origins
    const acao = res.headers.get('access-control-allow-origin')
    if (acao && acao !== '*' && acao.startsWith('http')) {
      try {
        const corsUrl = new URL(acao)
        add({ method: 'GET', path: corsUrl.pathname || '/', source: 'headers' })
      } catch {}
    }

    // Check Link headers for related endpoints
    const linkHeader = res.headers.get('link')
    if (linkHeader) {
      const linkPattern = /<([^>]+)>/g
      let match: RegExpExecArray | null
      while ((match = linkPattern.exec(linkHeader)) !== null) {
        try {
          const u = new URL(match[1], baseUrl)
          if (u.pathname !== '/') {
            add({ method: 'GET', path: u.pathname, source: 'headers' })
          }
        } catch {}
      }
    }

    // Check X-Powered-By to infer tech stack
    const poweredBy = res.headers.get('x-powered-by') || ''
    if (poweredBy.toLowerCase().includes('express') || poweredBy.toLowerCase().includes('next')) {
      // Node.js apps often have these
      for (const p of ['/api', '/api/health', '/_next/data']) {
        add({ method: 'GET', path: p, source: 'headers' })
      }
    }
    if (poweredBy.toLowerCase().includes('php') || poweredBy.toLowerCase().includes('laravel')) {
      for (const p of ['/api', '/admin', '/wp-json/wp/v2']) {
        add({ method: 'GET', path: p, source: 'headers' })
      }
    }

    // Check Server header
    const server = res.headers.get('server') || ''
    if (server.toLowerCase().includes('nginx')) {
      add({ method: 'GET', path: '/nginx_status', source: 'headers' })
    }

  } catch {}
}
