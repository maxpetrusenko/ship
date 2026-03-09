const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PROVIDERS = ['codex', 'claude'];
const COMMAND_TIMEOUT_MS = 45000;

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function appendSnapshotRecord(filePath, snapshot) {
  ensureParentDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(snapshot)}\n`, 'utf8');
}

function formatNumber(value, fractionDigits = 6) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  return value.toFixed(fractionDigits).replace(/\.?0+$/, '');
}

function formatInteger(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  return String(Math.trunc(value));
}

function renderUsageSummary(providerName, usagePayload) {
  if (!usagePayload || typeof usagePayload !== 'object') {
    return [];
  }

  const usage = usagePayload.usage;
  if (!usage || typeof usage !== 'object') {
    return [];
  }

  const lines = [];
  if (usagePayload.source) {
    lines.push(`Source: \`${usagePayload.source}\``);
  }
  if (usage.accountEmail) {
    lines.push(`Account: \`${usage.accountEmail}\``);
  }
  if (usage.loginMethod) {
    lines.push(`Login method: \`${usage.loginMethod}\``);
  }
  if (usage.primary) {
    lines.push(
      `Primary window: \`${formatInteger(usage.primary.usedPercent)}%\` used, resets \`${usage.primary.resetDescription || 'n/a'}\``
    );
  }
  if (usage.secondary) {
    lines.push(
      `Secondary window: \`${formatInteger(usage.secondary.usedPercent)}%\` used, resets \`${usage.secondary.resetDescription || 'n/a'}\``
    );
  }
  if (usage.updatedAt) {
    lines.push(`Usage updated: \`${usage.updatedAt}\``);
  }

  if (providerName === 'claude' && usage.currentSession) {
    const currentSession = usage.currentSession;
    if (currentSession.totalTokens != null) {
      lines.push(`Current session tokens: \`${formatInteger(currentSession.totalTokens)}\``);
    }
  }

  return lines;
}

function renderCostSummary(costPayload) {
  if (!costPayload || typeof costPayload !== 'object') {
    return [];
  }

  const lines = [];
  if (costPayload.source) {
    lines.push(`Cost source: \`${costPayload.source}\``);
  }
  if (costPayload.last30DaysCostUSD != null) {
    lines.push(`Last 30d cost: \`${formatNumber(costPayload.last30DaysCostUSD)}\` USD`);
  }
  if (costPayload.sessionCostUSD != null) {
    lines.push(`Session cost: \`${formatNumber(costPayload.sessionCostUSD)}\` USD`);
  }
  if (costPayload.sessionTokens != null) {
    lines.push(`Session tokens: \`${formatInteger(costPayload.sessionTokens)}\``);
  }
  if (costPayload.last30DaysTokens != null) {
    lines.push(`Last 30d tokens: \`${formatInteger(costPayload.last30DaysTokens)}\``);
  }
  if (costPayload.totals && costPayload.totals.totalTokens != null) {
    lines.push(`Total tokens: \`${formatInteger(costPayload.totals.totalTokens)}\``);
  }
  if (costPayload.updatedAt) {
    lines.push(`Cost updated: \`${costPayload.updatedAt}\``);
  }

  return lines;
}

function normalizeJsonOutput(stdout) {
  const parsed = JSON.parse(stdout);
  if (Array.isArray(parsed)) {
    return parsed[0] || null;
  }
  return parsed;
}

function runCodexBar(kind, provider) {
  const args = [kind, '--provider', provider, '--format', 'json', '--pretty'];
  if (kind === 'usage') {
    args.push('--web-timeout', '15');
  }

  const result = spawnSync('codexbar', args, {
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `codexbar ${kind} failed`).trim());
  }

  return normalizeJsonOutput(result.stdout);
}

function serializeError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

function getGitValue(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    cwd: process.cwd(),
  }).trim();
}

function getGitMetadata() {
  return {
    branch: getGitValue(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: getGitValue(['rev-parse', '--short', 'HEAD']),
  };
}

function buildSnapshot() {
  const snapshot = {
    capturedAt: new Date().toISOString(),
    repoRoot: process.cwd(),
    git: getGitMetadata(),
    providers: {},
  };

  for (const provider of PROVIDERS) {
    const providerSnapshot = {};

    try {
      providerSnapshot.usage = runCodexBar('usage', provider);
    } catch (error) {
      providerSnapshot.usageError = serializeError(error);
    }

    try {
      providerSnapshot.cost = runCodexBar('cost', provider);
    } catch (error) {
      providerSnapshot.costError = serializeError(error);
    }

    snapshot.providers[provider] = providerSnapshot;
  }

  return snapshot;
}

function renderJsonBlock(value) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function renderProviderSection(providerName, providerSnapshot) {
  const title = providerName.charAt(0).toUpperCase() + providerName.slice(1);
  const lines = [`## ${title}`, ''];

  if (providerSnapshot.usageError) {
    lines.push(`Usage error: \`${providerSnapshot.usageError.message}\``);
  } else if (providerSnapshot.usage) {
    lines.push(...renderUsageSummary(providerName, providerSnapshot.usage));
  } else {
    lines.push('Usage: `n/a`');
  }

  const costLines = renderCostSummary(providerSnapshot.cost);
  if (providerSnapshot.costError) {
    lines.push(`Cost error: \`${providerSnapshot.costError.message}\``);
  } else if (costLines.length > 0) {
    lines.push(...costLines);
  }

  if (providerSnapshot.usage) {
    lines.push('', '### Raw usage JSON', '', renderJsonBlock(providerSnapshot.usage));
  }

  lines.push('');
  return lines.join('\n');
}

function renderMarkdown(snapshot) {
  const lines = [
    '# Agent Usage Snapshot',
    '',
    `capturedAt: \`${snapshot.capturedAt}\``,
    `repoRoot: \`${snapshot.repoRoot}\``,
    `branch: \`${snapshot.git.branch}\``,
    `commit: \`${snapshot.git.commit}\``,
    '',
    'This file is generated by `node scripts/track-agent-usage.js`.',
    'Full snapshot history is stored in `docs/metrics/agent-usage.snapshots.jsonl`.',
    '',
  ];

  for (const provider of PROVIDERS) {
    lines.push(renderProviderSection(provider, snapshot.providers[provider] || {}));
  }

  return lines.join('\n').trimEnd() + '\n';
}

function writeMarkdownFile(filePath, snapshot) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, renderMarkdown(snapshot), 'utf8');
}

function main() {
  const repoRoot = process.cwd();
  const snapshotPath = path.join(repoRoot, 'docs/metrics/agent-usage.snapshots.jsonl');
  const markdownPath = path.join(repoRoot, 'docs/agent-usage.md');
  const snapshot = buildSnapshot();

  appendSnapshotRecord(snapshotPath, snapshot);
  writeMarkdownFile(markdownPath, snapshot);

  process.stdout.write(`Updated ${path.relative(repoRoot, markdownPath)} and ${path.relative(repoRoot, snapshotPath)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

module.exports = {
  appendSnapshotRecord,
  buildSnapshot,
  renderMarkdown,
};
