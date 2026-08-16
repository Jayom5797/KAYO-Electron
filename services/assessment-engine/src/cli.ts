#!/usr/bin/env node
import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { config as loadEnv } from 'dotenv';
import { runScan } from './analyze.js';
import { analyzeRepo } from './repo/index.js';
import { renderReport, renderSecuritySection, renderRepoReport } from './report.js';
import { streamGroqAnalysis } from './ai/groqClient.js';
import { generateHar } from './har.js';
import { writeOutput } from './output.js';

// quiet: keep stdout clean so the report stays pipeable (dotenv v17 logs a tip otherwise).
loadEnv({ quiet: true });

const program = new Command();

program
  .name('astra')
  .description('ASTRA — Automated Security Testing & Risk Analysis');

// ── Website scan (default command) ────────────────────────────────────────────
program
  .command('scan <url>', { isDefault: true })
  .description('Capture a URL and run a full security + performance analysis')
  .option('-o, --output <path>', 'Write Markdown report to file instead of stdout')
  .option('--har <path>', 'Export HAR 1.2 file to the specified path')
  .option(
    '--active-scan',
    'Run the INTRUSIVE active vulnerability scan (SQLi/XSS/etc.). Only use against targets you own or are explicitly authorized to test.'
  )
  .option('--ai', 'Prepend an AI-generated executive summary (requires GROQ_API_KEY)')
  .action(async (rawUrl: string, opts: { output?: string; har?: string; activeScan?: boolean; ai?: boolean }) => {
    if (opts.activeScan) {
      process.stderr.write(
        '⚠  Active vulnerability scanning sends intrusive requests to the target.\n' +
          '   Only run this against systems you own or are authorized to test.\n'
      );
    }

    process.stderr.write('Loading page and running analysis...\n');
    let result;
    try {
      result = await runScan(rawUrl, { activeScan: opts.activeScan === true, timeoutMs: 30000 });
    } catch (err) {
      fail(err);
    }

    // Optional AI-generated executive summary (streamed, accumulated).
    let aiSummary = '';
    if (opts.ai) {
      const key = process.env.GROQ_API_KEY;
      if (!key) {
        process.stderr.write('⚠  --ai requested but GROQ_API_KEY is not set — skipping AI summary.\n');
      } else {
        process.stderr.write('Generating AI executive summary...\n');
        try {
          for await (const chunk of streamGroqAnalysis(key, result)) aiSummary += chunk.text;
        } catch (err) {
          process.stderr.write(`⚠  AI summary failed: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      }
    }

    process.stderr.write('Generating report...\n');
    const performance = renderReport({
      url: result.url,
      captureTimestamp: result.captureTimestamp,
      totalDurationMs: result.totalDurationMs,
      data: {
        requests: result.requests,
        aggregate: result.aggregate,
        byType: result.byType,
        slowest: result.slowest,
        errors: result.errors,
      },
    });
    const report = [
      aiSummary.trim() ? `# Executive Summary (AI-generated)\n\n${aiSummary.trim()}` : '',
      performance,
      renderSecuritySection(result),
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      await writeOutput(report, opts.output);
    } catch (err) {
      fail(err);
    }

    if (opts.har) {
      const har = generateHar(result.requests, result.captureTimestamp);
      try {
        await writeFile(opts.har, JSON.stringify(har, null, 2), 'utf8');
      } catch (err) {
        fail(err, `writing HAR to "${opts.har}"`);
      }
    }
  });

// ── GitHub repository scan ────────────────────────────────────────────────────
program
  .command('repo <url>')
  .description('Scan a GitHub repository for secrets, vulnerable deps, workflow risks, hygiene, and code issues')
  .option('-o, --output <path>', 'Write Markdown report to file instead of stdout')
  .option('--advanced', 'Full git clone + git-history secret scanning (requires git on PATH)')
  .option('--token <token>', 'GitHub token (or set GITHUB_TOKEN) for private repos / higher rate limits')
  .action(async (rawUrl: string, opts: { output?: string; advanced?: boolean; token?: string }) => {
    process.stderr.write(
      opts.advanced
        ? 'Cloning repository and scanning (including git history)...\n'
        : 'Fetching repository via GitHub API and scanning...\n'
    );

    let result;
    try {
      result = await analyzeRepo(rawUrl, {
        advanced: opts.advanced === true,
        token: opts.token ?? process.env.GITHUB_TOKEN,
      });
    } catch (err) {
      fail(err);
    }

    process.stderr.write('Generating report...\n');
    try {
      await writeOutput(renderRepoReport(result), opts.output);
    } catch (err) {
      fail(err);
    }
  });

function fail(err: unknown, context?: string): never {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error${context ? ` ${context}` : ''}: ${msg}\n`);
  process.exit(1);
}

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
