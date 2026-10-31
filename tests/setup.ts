import { mock } from "bun:test";

// `server-only` throws outside a React Server environment; tests are server code.
mock.module("server-only", () => ({}));
