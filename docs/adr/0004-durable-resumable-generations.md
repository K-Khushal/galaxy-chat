# Durable, resumable Generations backed by Upstash Redis

A Reply must survive the User losing connection, refreshing or switching devices without restarting the model request or losing output. So a Generation runs on the server independently of the HTTP connection (Next.js `after()` plus `consumeStream`). Its output chunks go to Upstash Redis through `resumable-stream`, and the Chat records which Generation is active so clients can replay and follow it. The partial Reply is also saved to Postgres every few seconds, so output outlives both the Redis buffer and the function. Closing a tab therefore never stops a Generation; Stop is an explicit server-side signal sent through Redis. The per-Chat Generation lock lives in Redis with an expiry, never as a row in Postgres, because the inherited `chat_run` rows stuck in `pending` locked Chats permanently. Temporary chats are deliberately not resumable. Redis also holds OTP and verification state, rate limits and cached model metadata.

## Consequences

- A Generation's length is capped by the Vercel function time limit (about 300s on Hobby, up to 800s on Pro). A Generation that hits the cap ends as an Interrupted Reply that can be continued.
