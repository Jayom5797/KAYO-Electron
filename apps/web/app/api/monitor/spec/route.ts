import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 })

  // Try common OpenAPI spec paths
  const candidates = [
    '/api/openapi.json',
    '/openapi.json',
    '/swagger.json',
    '/api/swagger.json',
    '/docs/openapi.json',
  ]

  const base = url.replace(/\/$/, '')

  for (const path of candidates) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(base + path, { signal: controller.signal, cache: 'no-store' })
      clearTimeout(timeout)
      if (res.ok) {
        const spec = await res.json()
        return NextResponse.json({ found: true, path, spec })
      }
    } catch {}
  }

  return NextResponse.json({ found: false, error: 'No OpenAPI spec found' })
}
