const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const SCRIPT_PATH = path.join(__dirname, 'type-safety-count.js');

test('counts syntax-level type-safety escapes in fixture files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-type-safety-'));
  const fixtureDir = path.join(tempDir, 'fixture');
  fs.mkdirSync(fixtureDir);

  fs.writeFileSync(
    path.join(fixtureDir, 'sample.ts'),
    [
      'const a: any = null;',
      'const b = foo as Bar;',
      'const c = maybe!.value;',
      '// @ts-expect-error fixture',
      'const d = <Baz>value;',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(fixtureDir, 'sample.d.ts'),
    [
      'export type Example = any;',
      '',
    ].join('\n')
  );

  const output = execFileSync(process.execPath, [SCRIPT_PATH, '--json', fixtureDir], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });

  const counts = JSON.parse(output);
  assert.equal(counts.any, 2);
  assert.equal(counts.as, 2);
  assert.equal(counts.nonnull, 1);
  assert.equal(counts.tsDirectives, 1);
  assert.equal(counts.files, 2);
});
