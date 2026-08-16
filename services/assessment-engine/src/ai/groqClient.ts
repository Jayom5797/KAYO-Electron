import * as https from 'node:https';

// Groq API — OpenAI-compatible, much higher rate limits on free tier
const MODEL = 'llama-3.3-70b-versatile';
const BASE_URL = 'api.groq.com';
const API_PATH = '/openai/v1/chat/completions';

// Message format — OpenAI-compatible (role: user/assistant)
export interface GroqChatMessage {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GroqMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamChunk {
  text: string;
  done: boolean;
}

// Convert internal message shape to OpenAI/Groq wire format
function toGroqMessages(messages: GroqChatMessage[]): GroqMessage[] {
  return messages.map(m => ({
    role: m.role === 'model' ? 'assistant' : 'user',
    content: m.parts.map(p => p.text).join(''),
  }));
}

function buildScanSummaryPrompt(scanData: unknown): string {
  const d = scanData as Record<string, unknown>;

  // Redact the actual secret value while keeping its type/location so the model
  // can still reason about the finding. Prevents forwarding live credentials to
  // the third-party AI API.
  const redactLeaks = (leaks: unknown): unknown => {
    if (!Array.isArray(leaks)) return leaks;
    return leaks.map((l) => {
      const leak = l as Record<string, unknown>;
      return { ...leak, value: '[REDACTED]' };
    });
  };

  const summary = {
    url: d.url,
    capturedAt: d.captureTimestamp,
    totalRequests: (d.aggregate as Record<string, unknown>)?.totalRequests,
    totalBytes: (d.aggregate as Record<string, unknown>)?.totalBytes,
    pageLoadMs: d.totalDurationMs,
    requestTypes: d.byType,
    errorCount: (d.errors as unknown[])?.length ?? 0,
    tls: d.tls,
    csp: d.csp ? {
      grade: (d.csp as Record<string, unknown>).grade,
      score: (d.csp as Record<string, unknown>).score,
      issues: (d.csp as Record<string, unknown>).issues,
    } : null,
    cors: d.cors ? {
      summary: (d.cors as Record<string, unknown>).summary,
      findings: (d.cors as Record<string, unknown>).findings,
    } : null,
    fingerprint: d.fingerprint ? {
      technologies: (d.fingerprint as Record<string, unknown>).technologies,
      serverSoftware: (d.fingerprint as Record<string, unknown>).serverSoftware,
      poweredBy: (d.fingerprint as Record<string, unknown>).poweredBy,
      thirdPartyDomains: (d.fingerprint as Record<string, unknown>).thirdPartyDomains,
    } : null,
    apiEndpoints: (d.api as unknown[])?.slice(0, 20).map((e: unknown) => {
      const ep = e as Record<string, unknown>;
      return {
        url: ep.url, method: ep.method, path: ep.path,
        hasAuth: ep.hasAuth, authType: ep.authType,
        statusCode: ep.statusCode,
        jwtCount: (ep.jwts as unknown[])?.length ?? 0,
        leakCount: (ep.sensitiveLeaks as unknown[])?.length ?? 0,
        sensitiveLeaks: redactLeaks(ep.sensitiveLeaks),
      };
    }),
    vulnFindings: d.vuln ? {
      scannedEndpoints: (d.vuln as Record<string, unknown>).scannedEndpoints,
      findings: (d.vuln as Record<string, unknown>).findings,
    } : null,
    securityHeaders: (() => {
      const requests = d.requests as Array<Record<string, unknown>>;
      const doc = requests?.find(r => r.resourceType === 'document') ?? requests?.[0];
      if (!doc) return null;
      const h = Object.fromEntries(
        Object.entries(doc.responseHeaders as Record<string, string>)
          .map(([k, v]) => [k.toLowerCase(), v])
      );
      return {
        hsts: h['strict-transport-security'] ?? null,
        csp: h['content-security-policy'] ?? null,
        xfo: h['x-frame-options'] ?? null,
        xcto: h['x-content-type-options'] ?? null,
        rp: h['referrer-policy'] ?? null,
        pp: h['permissions-policy'] ?? null,
      };
    })(),
  };

  return `You are a senior application security engineer. Analyze this network security scan and provide a comprehensive security assessment.

SCAN DATA:
${JSON.stringify(summary, null, 2)}

Provide your analysis in this exact structure using markdown:

## 🔍 Executive Summary
2-3 sentences on the overall security posture. Be direct about the risk level (Critical/High/Medium/Low).

## 🚨 Critical Findings
List only genuinely critical issues with:
- What the issue is
- Why it's dangerous in this specific context
- Exact remediation step

## ⚠️ Notable Risks
Medium/high severity issues worth addressing.

## 🛡️ What's Done Well
Security controls that are properly implemented.

## 🔧 Prioritized Remediation Plan
Numbered list, most critical first. Be specific — include actual header values, config snippets, or commands where relevant.

## 🌐 Third-Party Risk Assessment
Analyze the third-party domains and technologies detected. Flag any that are unusual, high-risk, or unnecessary.

## 💡 Interesting Observations
Anything unusual, surprising, or worth investigating further that doesn't fit the above categories.

Be specific, technical, and actionable. Avoid generic advice. Reference the actual findings from the scan data.`;
}

export async function* streamGroqAnalysis(
  apiKey: string,
  scanData: unknown,
  conversationHistory: GroqChatMessage[] = []
): AsyncGenerator<StreamChunk> {
  const prompt = buildScanSummaryPrompt(scanData);

  const messages: GroqChatMessage[] = conversationHistory.length > 0
    ? conversationHistory
    : [{ role: 'user', parts: [{ text: prompt }] }];

  yield* streamGroqChat(apiKey, messages);
}

export async function* streamGroqChat(
  apiKey: string,
  messages: GroqChatMessage[]
): AsyncGenerator<StreamChunk> {
  const groqMessages = toGroqMessages(messages);

  const body = JSON.stringify({
    model: MODEL,
    messages: groqMessages,
    temperature: 0.3,
    max_tokens: 8192,
    stream: true,
  });

  yield* makeStreamRequest(BASE_URL, API_PATH, apiKey, body);
}

async function* makeStreamRequest(
  host: string,
  path: string,
  apiKey: string,
  body: string
): AsyncGenerator<StreamChunk> {
  const options = {
    hostname: host,
    path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(body),
    },
  };

  let buffer = '';

  const stream = new ReadableStream<StreamChunk>({
    start(controller) {
      // The stream can be finished from several places: a `[DONE]` marker in the
      // SSE body, the response `end` event, or an error. Guard every controller
      // operation so we never enqueue/close/error after it's already closed
      // (that throws ERR_INVALID_STATE: "Controller is already closed").
      let closed = false;
      const safeEnqueue = (chunk: StreamChunk) => {
        if (!closed) controller.enqueue(chunk);
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      const safeError = (err: Error) => {
        if (closed) return;
        closed = true;
        controller.error(err);
      };

      const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
          let errBody = '';
          res.on('data', (c: Buffer) => { errBody += c.toString(); });
          res.on('end', () => {
            safeError(new Error(`Groq API error ${res.statusCode}: ${errBody}`));
          });
          return;
        }

        res.on('data', (chunk: Buffer) => {
          if (closed) return;
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              safeEnqueue({ text: '', done: true });
              safeClose();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const text = parsed?.choices?.[0]?.delta?.content ?? '';
              if (text) safeEnqueue({ text, done: false });
            } catch { /* skip malformed chunks */ }
          }
        });

        res.on('end', () => {
          safeEnqueue({ text: '', done: true });
          safeClose();
        });

        res.on('error', (err: Error) => safeError(err));
      });

      req.on('error', (err: Error) => safeError(err));
      req.write(body);
      req.end();
    },
  });

  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) yield value;
  }
}

export async function validateApiKey(apiKey: string): Promise<boolean> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 5,
    });
    const req = https.request(
      {
        hostname: BASE_URL,
        path: API_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}
