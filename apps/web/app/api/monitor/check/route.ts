import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ ok: false, error: 'Missing url parameter' }, { status: 400 })
  }

  const healthUrl = url.replace(/\/$/, '')

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const start = Date.now()

    const res = await fetch(healthUrl, {
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeout)

    const responseTime = Date.now() - start
    let body: any = null
    try { body = await res.json() } catch {}

    return NextResponse.json({
      ok: res.status < 500,
      status_code: res.status,
      response_time_ms: responseTime,
      body,
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      status_code: null,
      error: e.name === 'AbortError' ? 'Request timed out (10s)' : e.message,
    })
  }
}
