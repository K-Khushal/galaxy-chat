<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for K-Khushal/galaxy-chat.
See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: root `GLOSSARY.md` and `docs/adr/`.
See `docs/agents/domain.md`.

## Rebuild in progress (read first)

Galaxy Chat is being rebuilt as milestones M0–M8, one GitHub issue each (see the open `v1` roadmap issue). Before writing code, read:

- `GLOSSARY.md`: use these terms in code, copy, tests and PRs (Chat, Message, Reply, Version, Generation, Credits, BYOK key…). Don't use the synonyms it lists under _Avoid_.
- `docs/adr/`: binding decisions. If your change contradicts an ADR, stop and say so in the PR instead of working around it.
- The issue you are implementing: its scope and acceptance criteria are the spec. Don't expand scope. Note follow-ups in the PR body.

Do not reintroduce removed subsystems (MCP, sandbox, browser, durable jobs, platform budget/funding ledger, guest mode, Cloudflare/OpenNext). See ADR 0001.

## Working rules

- Package manager is **Bun**. Never use npm/yarn/pnpm for installs.
- Before every push, run and pass, in this order: `bun run lint`, `bun run typecheck`, `bun test`, `bun run build`. Paste the pass/fail summary in the PR body. A PR without this evidence will not be merged.
- One milestone (or one sub-task) per branch and PR, named `m<N>/<slug>`, targeting `main`. Keep PRs reviewable; prefer several focused commits.
- Prefer deleting code to adding flags. No feature flags for v1 features; fail loudly with a clear error when required config is missing.
- Validate all env vars in one place (zod) and keep `.env.example` in sync with it.
- Server-only modules import `server-only`. Never send secrets or BYOK keys to the client or to logs.
- UI work: shadcn/ui on Base UI, Lucide icons, tokens from `app/globals.css` only (no hard-coded colours). Respect `prefers-reduced-motion`.
- Tests: `bun test` for units and PGlite-backed DB integration. Mock models with the AI SDK's mock providers; never call real providers in tests.
