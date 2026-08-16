/**
 * Client-side project analyzer — runs entirely in the browser.
 * Accepts a ZIP file, extracts it with JSZip, and analyzes the code.
 */
import JSZip from 'jszip'

export interface Framework { name: string; version?: string; type: 'frontend' | 'backend' | 'infra' | 'other' }
export interface Endpoint { method: string; path: string; file?: string }
export interface ServiceDep { name: string; found: boolean; sources: string[] }
export interface QualityIssue { severity: 'error' | 'warning' | 'info'; message: string; file?: string }
export interface DuplicateEndpoint { method: string; path: string; count: number }

export interface AnalysisResult {
  frameworks: Framework[]
  stats: { totalFiles: number; totalLines: number; languages: Record<string, number> }
  openEndpoints: Endpoint[]
  protectedEndpoints: Endpoint[]
  services: ServiceDep[]
  codeQuality: { score: number; issues: QualityIssue[]; positives: string[] }
  security: { issues: QualityIssue[] }
  envFiles: string[]
  duplicateEndpoints: DuplicateEndpoint[]
}

const LANG_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
  py: 'Python', go: 'Go', java: 'Java', rb: 'Ruby', rs: 'Rust',
  css: 'CSS', scss: 'SCSS', html: 'HTML', json: 'JSON', yaml: 'YAML', yml: 'YAML',
  md: 'Markdown', sh: 'Shell', tf: 'Terraform', sql: 'SQL',
}

const FRAMEWORK_SIGNALS: Array<{ file: string; name: string; type: Framework['type']; versionKey?: string }> = [
  { file: 'package.json', name: 'Next.js',    type: 'frontend',  versionKey: 'next' },
  { file: 'package.json', name: 'React',      type: 'frontend',  versionKey: 'react' },
  { file: 'package.json', name: 'Vue',        type: 'frontend',  versionKey: 'vue' },
  { file: 'package.json', name: 'Angular',    type: 'frontend',  versionKey: '@angular/core' },
  { file: 'package.json', name: 'Express',    type: 'backend',   versionKey: 'express' },
  { file: 'requirements.txt', name: 'FastAPI', type: 'backend' },
  { file: 'requirements.txt', name: 'Django',  type: 'backend' },
  { file: 'requirements.txt', name: 'Flask',   type: 'backend' },
  { file: 'go.mod',       name: 'Go',         type: 'backend' },
  { file: 'Cargo.toml',   name: 'Rust',       type: 'backend' },
  { file: 'docker-compose.yml', name: 'Docker Compose', type: 'infra' },
  { file: 'Dockerfile',   name: 'Docker',     type: 'infra' },
  { file: 'main.tf',      name: 'Terraform',  type: 'infra' },
]

const SERVICE_SIGNALS: Array<{ name: string; patterns: string[] }> = [
  { name: 'PostgreSQL',  patterns: ['postgres', 'postgresql', 'psycopg2', 'pg'] },
  { name: 'Redis',       patterns: ['redis'] },
  { name: 'Kafka',       patterns: ['kafka', 'confluent'] },
  { name: 'Neo4j',       patterns: ['neo4j', 'bolt://'] },
  { name: 'ClickHouse',  patterns: ['clickhouse'] },
  { name: 'MongoDB',     patterns: ['mongodb', 'mongoose'] },
  { name: 'MySQL',       patterns: ['mysql', 'mariadb'] },
  { name: 'Elasticsearch', patterns: ['elasticsearch', 'opensearch'] },
  { name: 'RabbitMQ',   patterns: ['rabbitmq', 'amqp'] },
  { name: 'S3',          patterns: ['s3', 'boto3', 'aws-sdk'] },
]

// Regex patterns for endpoint detection
const ENDPOINT_PATTERNS = [
  // FastAPI / Flask
  { re: /@(?:app|router)\.(?:get|post|put|patch|delete|options)\s*\(\s*["']([^"']+)["']/gi, method: (m: RegExpMatchArray) => m[0].match(/\.(get|post|put|patch|delete|options)/i)?.[1]?.toUpperCase() ?? 'GET' },
  // Express
  { re: /(?:app|router)\.(?:get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/gi, method: (m: RegExpMatchArray) => m[0].match(/\.(get|post|put|patch|delete)/i)?.[1]?.toUpperCase() ?? 'GET' },
  // Next.js API routes (infer from file path)
]

const AUTH_PATTERNS = [/Depends\(get_current_user\)/, /requireAuth/, /authenticate/, /Authorization/, /Bearer/, /jwt\.verify/, /passport\.authenticate/]

export async function analyzeZip(file: File): Promise<AnalysisResult> {
  const zip = await JSZip.loadAsync(file)

  const files: Array<{ path: string; content: string }> = []
  const promises: Promise<void>[] = []

  zip.forEach((path, entry) => {
    if (entry.dir) return
    if (path.includes('node_modules/') || path.includes('.git/') || path.includes('.next/')) return
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    if (!LANG_EXT[ext] && !['json', 'yaml', 'yml', 'toml', 'txt', 'env'].includes(ext)) return
    promises.push(
      entry.async('string').then(content => { files.push({ path, content }) }).catch(() => {})
    )
  })
  await Promise.all(promises)

  // Stats
  const langLines: Record<string, number> = {}
  let totalLines = 0
  for (const { path, content } of files) {
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    const lang = LANG_EXT[ext]
    if (lang) {
      const lines = content.split('\n').length
      langLines[lang] = (langLines[lang] ?? 0) + lines
      totalLines += lines
    }
  }

  // Frameworks
  const frameworks: Framework[] = []
  const pkgFile = files.find(f => f.path.endsWith('package.json') && !f.path.includes('/node_modules/'))
  let pkg: any = {}
  if (pkgFile) { try { pkg = JSON.parse(pkgFile.content) } catch {} }
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

  for (const sig of FRAMEWORK_SIGNALS) {
    const match = files.find(f => f.path.endsWith(sig.file))
    if (!match) continue
    if (sig.versionKey) {
      if (!allDeps[sig.versionKey]) continue
      const ver = (allDeps[sig.versionKey] as string).replace(/[\^~>=<]/, '')
      if (!frameworks.find(f => f.name === sig.name)) frameworks.push({ name: sig.name, version: ver, type: sig.type })
    } else {
      const content = match.content.toLowerCase()
      if (sig.name === 'FastAPI' && !content.includes('fastapi')) continue
      if (sig.name === 'Django' && !content.includes('django')) continue
      if (sig.name === 'Flask' && !content.includes('flask')) continue
      if (!frameworks.find(f => f.name === sig.name)) frameworks.push({ name: sig.name, type: sig.type })
    }
  }

  // Services
  const allContent = files.map(f => f.content).join('\n').toLowerCase()
  const services: ServiceDep[] = SERVICE_SIGNALS.map(svc => {
    const sources: string[] = []
    for (const { path, content } of files) {
      if (svc.patterns.some(p => content.toLowerCase().includes(p))) sources.push(path)
    }
    return { name: svc.name, found: sources.length > 0, sources: [...new Set(sources)].slice(0, 3) }
  })

  // Endpoints
  const openEndpoints: Endpoint[] = []
  const protectedEndpoints: Endpoint[] = []

  for (const { path, content } of files) {
    // Next.js API routes
    const nextApiMatch = path.match(/app\/api\/(.+)\/route\.(ts|js)$/)
    if (nextApiMatch) {
      const routePath = '/api/' + nextApiMatch[1]
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter(m => new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`).test(content))
      const isProtected = AUTH_PATTERNS.some(p => p.test(content))
      for (const method of methods) {
        const ep = { method, path: routePath, file: path }
        isProtected ? protectedEndpoints.push(ep) : openEndpoints.push(ep)
      }
      continue
    }

    // Python routes
    for (const { re, method } of ENDPOINT_PATTERNS) {
      let m: RegExpMatchArray | null
      re.lastIndex = 0
      while ((m = re.exec(content)) !== null) {
        const routePath = m[1]
        const idx = m.index ?? 0
        const lineStart = content.lastIndexOf('\n', idx)
        const lineEnd = content.indexOf('\n', idx)
        const line = content.slice(lineStart, lineEnd)
        const isProtected = AUTH_PATTERNS.some(p => p.test(line)) ||
          AUTH_PATTERNS.some(p => p.test(content.slice(idx, idx + 500)))
        const ep = { method: method(m), path: routePath, file: path }
        isProtected ? protectedEndpoints.push(ep) : openEndpoints.push(ep)
      }
    }
  }

  // Deduplicate
  const dedup = (eps: Endpoint[]) => eps.filter((ep, i, arr) => arr.findIndex(e => e.method === ep.method && e.path === ep.path) === i)
  const dedupedOpen = dedup(openEndpoints)
  const dedupedProtected = dedup(protectedEndpoints)

  // Duplicate endpoint detection
  const allEps = [...dedupedOpen, ...dedupedProtected]
  const epCounts: Record<string, number> = {}
  for (const ep of allEps) { const k = `${ep.method}:${ep.path}`; epCounts[k] = (epCounts[k] ?? 0) + 1 }
  const duplicateEndpoints: DuplicateEndpoint[] = Object.entries(epCounts)
    .filter(([, c]) => c > 1)
    .map(([k, count]) => { const [method, path] = k.split(':'); return { method, path, count } })

  // Code quality
  const qualityIssues: QualityIssue[] = []
  const positives: string[] = []
  let score = 100

  const hasTests = files.some(f => f.path.includes('test') || f.path.includes('spec'))
  if (hasTests) positives.push('Test files detected')
  else { qualityIssues.push({ severity: 'warning', message: 'No test files found' }); score -= 10 }

  const hasReadme = files.some(f => f.path.toLowerCase().endsWith('readme.md'))
  if (hasReadme) positives.push('README.md present')
  else { qualityIssues.push({ severity: 'info', message: 'No README.md found' }); score -= 5 }

  const hasDockerfile = files.some(f => f.path.endsWith('Dockerfile'))
  if (hasDockerfile) positives.push('Dockerfile present')

  const hasCi = files.some(f => f.path.includes('.github/workflows') || f.path.includes('.gitlab-ci'))
  if (hasCi) positives.push('CI/CD pipeline configured')
  else { qualityIssues.push({ severity: 'warning', message: 'No CI/CD pipeline found' }); score -= 10 }

  if (duplicateEndpoints.length > 0) score -= duplicateEndpoints.length * 5

  // Security
  const securityIssues: QualityIssue[] = []
  const envFiles = files.filter(f => f.path.endsWith('.env') || f.path.endsWith('.env.example')).map(f => f.path)

  const hardcodedSecrets = files.filter(f => {
    const c = f.content
    return /(?:password|secret|api_key|apikey)\s*=\s*["'][^"']{8,}["']/i.test(c) &&
      !f.path.endsWith('.env.example') && !f.path.endsWith('.env.sample')
  })
  if (hardcodedSecrets.length > 0) {
    securityIssues.push({ severity: 'error', message: `Possible hardcoded secrets in ${hardcodedSecrets.length} file(s)`, file: hardcodedSecrets[0].path })
    score -= 20
  } else {
    securityIssues.push({ severity: 'info', message: 'No obvious hardcoded secrets detected' })
  }

  const hasCors = allContent.includes('cors')
  if (hasCors) securityIssues.push({ severity: 'info', message: 'CORS configuration detected' })

  const hasRateLimit = allContent.includes('rate') && allContent.includes('limit')
  if (hasRateLimit) securityIssues.push({ severity: 'info', message: 'Rate limiting detected' })
  else securityIssues.push({ severity: 'warning', message: 'No rate limiting detected' })

  score = Math.max(0, Math.min(100, score))

  return {
    frameworks,
    stats: { totalFiles: files.length, totalLines, languages: langLines },
    openEndpoints: dedupedOpen.slice(0, 50),
    protectedEndpoints: dedupedProtected.slice(0, 50),
    services,
    codeQuality: { score, issues: qualityIssues, positives },
    security: { issues: securityIssues },
    envFiles,
    duplicateEndpoints,
  }
}
