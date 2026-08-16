import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FixtureServer {
  /** Base origin, e.g. http://127.0.0.1:54321 */
  url: string;
  close: () => Promise<void>;
}

/**
 * A deliberately-insecure local test target.
 *
 * It serves a small page with a bad security posture on purpose so the capture
 * pipeline and the security analyzers can be exercised end-to-end against real
 * HTTP traffic (not hand-built fixtures):
 *   - no security headers (CSP, X-Frame-Options, X-Content-Type-Options, ...)
 *   - an insecure session cookie (missing HttpOnly / Secure / SameSite)
 *   - a JSON API endpoint with a wildcard CORS policy
 *   - a handful of sub-resources so the capture records multiple request types
 *
 * Bound to 127.0.0.1 on an ephemeral port so it never conflicts or leaks.
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const html = `<!doctype html>
<html>
  <head><link rel="stylesheet" href="/style.css"></head>
  <body>
    <h1>fixture</h1>
    <img src="/pic.png" alt="">
    <script src="/app.js"></script>
    <script>fetch('/api/data').catch(() => {});</script>
  </body>
</html>`;

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];

    switch (path) {
      case '/':
        // Intentionally omit every security header + set an insecure session cookie.
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'set-cookie': 'sessionid=insecure-value; Path=/',
        });
        res.end(html);
        return;

      case '/style.css':
        res.writeHead(200, { 'content-type': 'text/css' });
        res.end('body{font-family:sans-serif}');
        return;

      case '/app.js':
        res.writeHead(200, { 'content-type': 'application/javascript' });
        res.end('console.log("fixture");');
        return;

      case '/pic.png':
        // 1x1 transparent PNG.
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            'base64'
          )
        );
        return;

      case '/api/data':
        // Wildcard CORS on a JSON API — readable by any origin.
        res.writeHead(200, {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        });
        res.end(JSON.stringify({ ok: true }));
        return;

      default:
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}
