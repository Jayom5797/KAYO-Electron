import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ ok: false, error: 'Missing url' }, { status: 400 })

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const start = Date.now()
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    clearTimeout(timeout)
    const responseTime = Date.now() - start
    // 2xx, 3xx, 401, 403 = server is UP and responding correctly
    // 401/403 means protected endpoint — server is healthy, just requires auth
    // Only 5xx or network errors = truly DOWN
    const isUp = res.status < 500
    return NextResponse.json({ ok: isUp, status_code: res.status, response_time_ms: responseTime })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      status_code: null,
      error: e.name === 'AbortError' ? 'Timeout' : e.message,
    })
  }
}
