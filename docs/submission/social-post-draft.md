# Social Post Draft

Date: 2026-03-09

## X Draft

Audited and improved Ship, a Treasury TypeScript monorepo. Cut entry bundle 53%, improved search P95 from 72ms to 28ms, and fixed runtime plus accessibility issues with proof. Demo: <LOOM_URL> Repo: <GITHUB_FORK_URL> @GauntletAI

## LinkedIn Draft

I spent this project auditing and improving `Ship`, an open-source project and sprint management system built by the U.S. Department of the Treasury.

The assignment was not to add a feature. It was to inherit an unfamiliar production-style TypeScript monorepo, build a real mental model of the system, measure seven quality categories with proof, improve them with before and after evidence, and document the reasoning like a senior engineer.

A few concrete outcomes:

- Reduced the initial frontend entry bundle from `2073.74 kB` to `968.95 kB` by lazy-loading the editor and emoji picker
- Improved search endpoint performance from `72 ms` P95 to `28 ms` P95 using trigram indexes and query normalization
- Repaired stale critical-path web tests and got the suite to `164/164` passing
- Added tighter type-safety, runtime error-handling, and accessibility improvements with fresh verification evidence

The biggest lesson was that good engineering work starts with orientation and diagnosis. The measurable fixes were much better once I understood the document model, middleware chain, collaboration layer, and test harness deeply enough to explain the root cause.

@GauntletAI
