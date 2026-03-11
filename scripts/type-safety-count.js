#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const DEFAULT_TARGETS = ['api', 'web', 'shared'];
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'dev-dist', '.git', 'coverage']);

function parseArgs(argv) {
  const options = {
    json: false,
    targets: [],
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    options.targets.push(arg);
  }

  return options;
}

function createEmptyCounts() {
  return {
    any: 0,
    as: 0,
    nonnull: 0,
    tsDirectives: 0,
    files: 0,
  };
}

function shouldAnalyzeFile(fileName) {
  return fileName.endsWith('.ts') || fileName.endsWith('.tsx');
}

function analyzeFile(filePath, counts) {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const directives = sourceText.match(/@ts-ignore|@ts-expect-error/g);

  if (directives) {
    counts.tsDirectives += directives.length;
  }

  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      counts.any += 1;
    }
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      counts.as += 1;
    }
    if (ts.isNonNullExpression(node)) {
      counts.nonnull += 1;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  counts.files += 1;
}

function walkTarget(targetPath, counts) {
  const stat = fs.statSync(targetPath);

  if (stat.isFile()) {
    if (shouldAnalyzeFile(targetPath)) {
      analyzeFile(targetPath, counts);
    }
    return;
  }

  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      walkTarget(entryPath, counts);
      continue;
    }

    if (entry.isFile() && shouldAnalyzeFile(entryPath)) {
      analyzeFile(entryPath, counts);
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const counts = createEmptyCounts();
  const cwd = process.cwd();
  const targets = options.targets.length > 0 ? options.targets : DEFAULT_TARGETS;

  for (const target of targets) {
    const targetPath = path.resolve(cwd, target);
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Target not found: ${target}`);
    }
    walkTarget(targetPath, counts);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(counts)}\n`);
    return;
  }

  process.stdout.write(
    `any=${counts.any} as=${counts.as} nonnull=${counts.nonnull} ts=${counts.tsDirectives} files=${counts.files}\n`
  );
}

main();
