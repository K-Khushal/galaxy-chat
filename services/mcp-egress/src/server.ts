import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Socket } from "node:net";
import { createBroker } from "./broker.js";
import { type BrokerConfig, validateConfig } from "./config.js";
import { BrokerError, errorCode, fail } from "./errors.js";
import type { TransportDependencies } from "./pinned-https.js";
import { MAX_ENVELOPE_BYTES } from "./protocol.js";
import type { ReplayStore } from "./replay-store.js";

export async function createBrokerServer(
  config: BrokerConfig,
  store: ReplayStore,
  dependencies: TransportDependencies = {},
) {
  validateConfig(config);
  if (config.production && !store.durable) fail("configuration");
  await store.ready();
  const execute = createBroker(config, store, dependencies);
  let active = 0;
  const sockets = new Set<Socket>();
  const send = (res: ServerResponse, status: number, result: unknown) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Connection: "close",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(result));
  };
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    req.socket.setTimeout(21_000);
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once("aborted", () => controller.abort());
    res.once("close", onClose);
    const ingressTimer = setTimeout(() => {
      controller.abort();
      req.destroy();
    }, 5000);
    let acquired = false;
    try {
      if (
        req.method !== "POST" ||
        req.url !== "/v1/egress" ||
        req.headers["content-type"] !== "application/json" ||
        req.headers["content-encoding"] ||
        req.headers.expect ||
        req.headers.upgrade
      )
        fail("invalid_request");
      // Reject duplicates rather than Node's header coalescing semantics.
      const seen = new Set<string>();
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i].toLowerCase();
        if (seen.has(name)) fail("invalid_request");
        seen.add(name);
      }
      if (active >= config.concurrency) fail("busy");
      active++;
      acquired = true;
      const length = req.headers["content-length"];
      if (
        length &&
        (!/^\d+$/.test(length) || Number(length) > MAX_ENVELOPE_BYTES)
      )
        fail("limit");
      let total = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        total += chunk.length;
        if (total > MAX_ENVELOPE_BYTES) fail("limit");
        chunks.push(chunk);
      }
      clearTimeout(ingressTimer);
      if (controller.signal.aborted) fail("cancelled");
      let input: unknown;
      try {
        input = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks, total),
          ),
        );
      } catch {
        fail("invalid_request");
      }
      const result = await execute(
        input,
        req.headers["x-mcp-signature"],
        controller.signal,
      );
      send(res, 200, result);
    } catch (error) {
      const code = errorCode(error);
      send(
        res,
        code === "busy"
          ? 503
          : code === "authentication"
            ? 401
            : code === "limit"
              ? 413
              : error instanceof BrokerError &&
                  ["invalid_request", "replay"].includes(code)
                ? 400
                : 502,
        { error: code },
      );
    } finally {
      clearTimeout(ingressTimer);
      res.removeListener("close", onClose);
      if (acquired) active--;
    }
  };
  const server = config.tls
    ? createHttpsServer(
        {
          ...config.tls,
          requestCert: true,
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
          maxHeaderSize: 8192,
          connectionsCheckingInterval: 1000,
          handshakeTimeout: 3000,
        },
        handler,
      )
    : createHttpServer(
        { maxHeaderSize: 8192, connectionsCheckingInterval: 1000 },
        handler,
      );
  server.headersTimeout = 3000;
  server.requestTimeout = 5000;
  server.keepAliveTimeout = 1;
  server.maxRequestsPerSocket = 1;
  server.maxConnections = config.maxConnections;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    // Include incomplete TLS/header handshakes in the socket resource ceiling.
    socket.setTimeout(3000, () => socket.destroy());
  });
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });
  // Never let expect/upgrade paths bypass the sole endpoint or header checks.
  server.on("checkContinue", (_req, res) => {
    send(res, 400, { error: "invalid_request" });
  });
  server.on("checkExpectation", (_req, res) => {
    send(res, 400, { error: "invalid_request" });
  });
  server.on("upgrade", (_req, socket) => socket.destroy());
  return {
    server,
    close: async () => {
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}
