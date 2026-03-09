const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  appendSnapshotRecord,
  renderMarkdown,
} = require('./track-agent-usage.js');

test('appendSnapshotRecord appends JSONL and renderMarkdown summarizes providers', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-'));
  const jsonlPath = path.join(tempDir, 'agent-usage.snapshots.jsonl');

  const snapshot = {
    capturedAt: '2026-03-09T17:45:00Z',
    repoRoot: '/tmp/ship',
    git: {
      branch: 'master',
      commit: '076a183',
    },
    providers: {
      codex: {
        usage: {
          provider: 'codex',
          source: 'codex-cli',
          usage: {
            primary: {
              usedPercent: 6,
              resetDescription: '3:47 PM',
            },
            secondary: {
              usedPercent: 7,
              resetDescription: 'Mar 14, 2026 at 8:14 PM',
            },
          },
        },
        cost: {
          provider: 'codex',
          last30DaysCostUSD: 95.6608442,
          sessionTokens: 25481445,
          totals: {
            totalTokens: 3934330827,
          },
        },
      },
      claude: {
        usageError: {
          message: 'Could not parse Claude usage: Missing Current session',
        },
        cost: {
          provider: 'claude',
          last30DaysCostUSD: 0.2598213,
          sessionTokens: 40437163,
          totals: {
            totalTokens: 1309241064,
          },
        },
      },
    },
  };

  appendSnapshotRecord(jsonlPath, snapshot);

  const jsonl = fs.readFileSync(jsonlPath, 'utf8');
  const lines = jsonl.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), snapshot);

  const markdown = renderMarkdown(snapshot);
  assert.match(markdown, /# Agent Usage Snapshot/);
  assert.match(markdown, /capturedAt: `2026-03-09T17:45:00Z`/);
  assert.match(markdown, /branch: `master`/);
  assert.match(markdown, /commit: `076a183`/);
  assert.match(markdown, /## Codex/);
  assert.match(markdown, /Primary window: `6%` used, resets `3:47 PM`/);
  assert.match(markdown, /Last 30d cost: `95\.660844` USD/);
  assert.match(markdown, /## Claude/);
  assert.match(markdown, /Usage error: `Could not parse Claude usage: Missing Current session`/);
  assert.match(markdown, /Session tokens: `40437163`/);
});
