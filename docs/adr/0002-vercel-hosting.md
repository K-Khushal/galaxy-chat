# Host on Vercel with managed Postgres

The inherited code targeted Cloudflare Workers via OpenNext, which fits awkwardly with long streaming replies and a database client shared across requests. We host on Vercel, where Next.js 16 and AI SDK streaming work without an adapter, and use managed Postgres. wrangler and OpenNext are removed.
