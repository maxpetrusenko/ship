/**
 * Custom Playwright Reporter for Progress Tracking
 *
 * Writes minimal progress updates to JSONL file for live monitoring.
 * Errors are written to separate files to avoid output explosion.
 *
 * Progress file: test-results/progress.jsonl
 * Timing aggregate file: test-results/spec-timings.json
 * Error logs: test-results/errors/{test-file}.log
 */

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';

interface ProgressEntry {
  test: string;
  title: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  ts: number;
  duration?: number;
  error?: string;
}

const RESULTS_DIR = 'test-results';
const PROGRESS_FILE = path.join(RESULTS_DIR, 'progress.jsonl');
const ERRORS_DIR = path.join(RESULTS_DIR, 'errors');
const SPEC_TIMINGS_FILE = path.join(RESULTS_DIR, 'spec-timings.json');

const SUMMARY_FILE = path.join(RESULTS_DIR, 'summary.json');

interface SpecTimingAggregate {
  spec: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  totalDurationMs: number;
  averageDurationMs: number;
  slowestTestDurationMs: number;
}

class ProgressReporter implements Reporter {
  private totalTests = 0;
  private specTimings = new Map<string, SpecTimingAggregate>();

  onBegin(config: FullConfig, suite: Suite): void {
    // Ensure directories exist
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.mkdirSync(ERRORS_DIR, { recursive: true });

    // Clear previous progress file
    fs.writeFileSync(PROGRESS_FILE, '');

    // Count all tests and write initial pending entries
    const allTests = this.collectTests(suite);
    this.totalTests = allTests.length;

    for (const test of allTests) {
      this.writeProgress({
        test: this.getTestFile(test),
        title: test.title,
        status: 'pending',
        ts: Date.now(),
      });
    }

    // Initialize summary with total count (only main process does this)
    if (this.totalTests > 0) {
      fs.writeFileSync(
        SUMMARY_FILE,
        JSON.stringify({
          total: this.totalTests,
          passed: 0,
          failed: 0,
          skipped: 0,
          pending: this.totalTests,
          ts: Date.now(),
        }, null, 2)
      );
    }
  }

  onTestBegin(test: TestCase): void {
    this.writeProgress({
      test: this.getTestFile(test),
      title: test.title,
      status: 'running',
      ts: Date.now(),
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const testFile = this.getTestFile(test);
    const status = this.mapStatus(result.status);
    this.trackSpecTiming(testFile, status, result.duration);

    const entry: ProgressEntry = {
      test: testFile,
      title: test.title,
      status,
      ts: Date.now(),
      duration: result.duration,
    };

    // For failures, write error to separate file
    if (status === 'failed' && result.errors.length > 0) {
      const errorFile = this.writeErrorLog(test, result);
      entry.error = errorFile;
    }

    this.writeProgress(entry);

    // Atomically update summary counters (read-modify-write)
    this.updateSummaryCounter(status);
  }

  onEnd(result: FullResult): void {
    // Write final summary
    this.writeProgress({
      test: '__summary__',
      title: 'Final Results',
      status: result.status === 'passed' ? 'passed' : 'failed',
      ts: Date.now(),
    });

    this.writeSpecTimings();
  }

  private updateSummaryCounter(status: 'passed' | 'failed' | 'skipped'): void {
    try {
      const data = fs.readFileSync(SUMMARY_FILE, 'utf-8');
      const summary = JSON.parse(data);

      if (status === 'passed') summary.passed++;
      else if (status === 'failed') summary.failed++;
      else if (status === 'skipped') summary.skipped++;

      summary.pending = summary.total - summary.passed - summary.failed - summary.skipped;
      summary.ts = Date.now();

      fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
    } catch {
      // Ignore errors - file might not exist yet or race condition
    }
  }

  private collectTests(suite: Suite): TestCase[] {
    const tests: TestCase[] = [];
    for (const test of suite.allTests()) {
      tests.push(test);
    }
    return tests;
  }

  private getTestFile(test: TestCase): string {
    // Get relative path from project root
    const fullPath = test.location.file;
    const match = fullPath.match(/e2e\/(.+)$/);
    return match ? match[1] : path.basename(fullPath);
  }

  private mapStatus(
    status: TestResult['status']
  ): 'passed' | 'failed' | 'skipped' {
    switch (status) {
      case 'passed':
        return 'passed';
      case 'failed':
      case 'timedOut':
      case 'interrupted':
        return 'failed';
      case 'skipped':
        return 'skipped';
      default:
        return 'failed';
    }
  }

  private trackSpecTiming(
    spec: string,
    status: 'passed' | 'failed' | 'skipped',
    duration = 0
  ): void {
    const previous = this.specTimings.get(spec) ?? {
      spec,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      totalDurationMs: 0,
      averageDurationMs: 0,
      slowestTestDurationMs: 0,
    };

    previous.total += 1;
    previous.totalDurationMs += duration;
    previous.slowestTestDurationMs = Math.max(previous.slowestTestDurationMs, duration);

    if (status === 'passed') previous.passed += 1;
    else if (status === 'failed') previous.failed += 1;
    else previous.skipped += 1;

    previous.averageDurationMs = previous.total > 0 ? previous.totalDurationMs / previous.total : 0;
    this.specTimings.set(spec, previous);
  }

  private writeProgress(entry: ProgressEntry): void {
    fs.appendFileSync(PROGRESS_FILE, JSON.stringify(entry) + '\n');
  }

  private writeErrorLog(test: TestCase, result: TestResult): string {
    const testFile = this.getTestFile(test);
    const safeFileName = testFile.replace(/[/\\]/g, '_').replace('.ts', '');
    const safeTitle = test.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
    const errorFileName = `${safeFileName}__${safeTitle}.log`;
    const errorPath = path.join(ERRORS_DIR, errorFileName);

    const errorContent = [
      `Test: ${testFile}`,
      `Title: ${test.title}`,
      `Duration: ${result.duration}ms`,
      ``,
      `--- Errors ---`,
      ...result.errors.map((e) => e.message || String(e)),
      ``,
      `--- Stack ---`,
      ...result.errors.map((e) => e.stack || ''),
    ].join('\n');

    fs.writeFileSync(errorPath, errorContent);
    return errorFileName;
  }

  private writeSpecTimings(): void {
    const entries = Array.from(this.specTimings.values())
      .sort((a, b) => b.totalDurationMs - a.totalDurationMs || b.slowestTestDurationMs - a.slowestTestDurationMs || a.spec.localeCompare(b.spec))
      .map((entry) => ({
        ...entry,
        averageDurationMs: Number(entry.averageDurationMs.toFixed(2)),
      }));

    fs.writeFileSync(SPEC_TIMINGS_FILE, JSON.stringify(entries, null, 2));
  }
}

export default ProgressReporter;
