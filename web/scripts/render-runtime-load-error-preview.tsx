import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlockingLoadError } from '../src/components/ui/BlockingLoadError';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const distDir = path.join(webRoot, 'dist');
const assetsDir = path.join(distDir, 'assets');

const cssFile = readdirSync(assetsDir).find((entry) => entry.startsWith('index-') && entry.endsWith('.css'));

if (!cssFile) {
  throw new Error('Could not find built web CSS in web/dist/assets. Run pnpm build:web first.');
}

const preview = renderToStaticMarkup(
  <main className="min-h-screen bg-background px-6 py-10 text-foreground">
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Ship Runtime Fix Preview</p>
        <h1 className="mt-2 text-3xl font-semibold">Blocking retry states for failed critical loads</h1>
        <p className="mt-3 max-w-3xl text-sm text-muted">
          These are the three new runtime fallbacks added for Category 6 so failed initial loads no longer
          masquerade as editable empty states.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-border bg-background/80 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">Week review</p>
          <BlockingLoadError
            title="Unable to load weekly review"
            message="Unable to load the existing weekly review. Retry before editing so you do not work from a misleading blank state."
            onRetry={() => {}}
          />
        </section>

        <section className="rounded-2xl border border-border bg-background/80 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">Project retrospective</p>
          <BlockingLoadError
            title="Unable to load project retrospective"
            message="Unable to load the existing project retrospective. Retry before editing so you do not replace it with a misleading blank draft."
            onRetry={() => {}}
          />
        </section>

        <section className="rounded-2xl border border-border bg-background/80 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">Standup feed</p>
          <BlockingLoadError
            title="Unable to load standups"
            message="Unable to load standup updates right now. Retry before assuming the feed is empty."
            onRetry={() => {}}
          />
        </section>
      </div>
    </div>
  </main>
);

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Runtime Load Error Preview</title>
    <link rel="stylesheet" href="./assets/${cssFile}" />
    <style>
      body {
        margin: 0;
        background:
          radial-gradient(circle at top left, rgba(54, 108, 177, 0.18), transparent 32rem),
          linear-gradient(180deg, #f6f8fb 0%, #eef2f8 100%);
      }
    </style>
  </head>
  <body>
    ${preview}
  </body>
</html>`;

writeFileSync(path.join(distDir, 'runtime-load-error-preview.html'), html);

console.log(path.join(distDir, 'runtime-load-error-preview.html'));
