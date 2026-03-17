# AI Interview Ready

## 1. Okay, walk us through your solution at a high level. What was your overall approach?

My overall approach was to avoid guessing and build a clear model of the system first. I started by understanding the repo shape: Express API, React frontend, shared TypeScript contracts, a unified document model, and Yjs-based collaboration. From there, I measured the key categories with reproducible checks, prioritized the highest-leverage fixes, and then shipped targeted improvements with before-and-after proof. That let me improve performance, type safety, runtime resilience, and accessibility without destabilizing the core product.

## 2. What is the most challenging part of this problem and how did you overcome it?

The hardest part was that this was not one isolated bug. It was an unfamiliar monorepo with a few very large hotspot files and a lot of cross-cutting behavior. The main challenge was figuring out where a change was safe, especially around shared document behavior, search, and user-facing runtime states. I handled that by reading the architecture and data model first, tracing flows end to end, and leaning on regression tests and explicit verification before treating a fix as real.

## 3. Okay, what edge cases did you consider and how did you handle them?

I focused on edge cases that could quietly break trust for users: expired sessions, failed initial loads that looked like empty data, permission-sensitive search results, and malformed or missing input. For example, if a weekly review, project retrospective, or standup feed failed to load, I made sure the UI stayed in a blocking retry state instead of rendering a misleading blank editor or fake empty state. I also paid attention to visibility rules so private and workspace documents stayed separated correctly.

## 4. If you had more time, what would you improve or do differently?

With more time, I would refactor the biggest hotspot files first, especially the large route files and the main app layout, because that is where long-term maintenance risk still lives. I would also keep improving search correctness and reliability, reduce the remaining flaky E2E cases, and continue chipping away at the remaining type-safety escape hatches. The core system is in much better shape, but the next step would be making it easier to evolve safely.
