import { lookup } from "node:dns/promises";
import { Agent, request } from "node:https";
import type { LookupFunction } from "node:net";
import {
  type ConnectionOptions,
  checkServerIdentity,
  type TLSSocket,
} from "node:tls";
import { BrokerError, fail } from "./errors.js";
import { type Address, normalizeAddress, selectPin } from "./ip-policy.js";
import type { Profile } from "./profile.js";

export type TransportDependencies = Readonly<{
  resolve?: (
    hostname: string,
  ) => Promise<readonly { address: string; family: number }[]>;
  // Offline tests route the exact production TLS transport to a local test CA.
  // The entrypoint NEVER loads dial/CA/resolver overrides from configuration.
  connect?: (options: ConnectionOptions) => TLSSocket;
}>;
export type EgressResult = Readonly<{
  attestation?: unknown;
  status: number;
  body: string;
  headers: Readonly<Record<string, string>>;
  destination: Readonly<{
    profileId: string;
    revision: string;
    purpose: string;
    address: string;
  }>;
}>;
export function pinnedLookup(hostname: string, pin: Address): LookupFunction {
  return (name, options, callback) => {
    if (
      name !== hostname ||
      (options.family && options.family !== pin.family)
    ) {
      callback(new BrokerError("destination"), "", 0);
      return;
    }
    if (options.all) {
      // Node uses this overload for autoSelectFamily. There is still one pin.
      (callback as unknown as (error: null, answers: Address[]) => void)(null, [
        pin,
      ]);
    } else callback(null, pin.address, pin.family);
  };
}
export async function pinnedHttps(
  profile: Profile,
  body: Buffer,
  authorization: string | undefined,
  deadline: number,
  signal: AbortSignal,
  dependencies: TransportDependencies = {},
  notification = false,
): Promise<EgressResult> {
  if (signal.aborted) fail("cancelled");
  if (
    body.length > profile.maxRequestBytes ||
    (profile.method === "GET" && body.length !== 0)
  )
    fail("limit");
  const endAt = Math.min(deadline, Date.now() + profile.timeoutMs);
  if (endAt <= Date.now()) fail("timeout");
  return new Promise((resolve, reject) => {
    let finished = false;
    let req: ReturnType<typeof request> | undefined;
    let agent: Agent | undefined;
    let firstByteTimer: NodeJS.Timeout | undefined;
    let connectTimer: NodeJS.Timeout | undefined;
    const finish = (error?: BrokerError, result?: EgressResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(operationTimer);
      clearTimeout(connectTimer);
      clearTimeout(firstByteTimer);
      signal.removeEventListener("abort", abort);
      req?.destroy();
      agent?.destroy();
      if (error) reject(error);
      else resolve(result as EgressResult);
    };
    const abort = () => finish(new BrokerError("cancelled"));
    const operationTimer = setTimeout(
      () => finish(new BrokerError("timeout")),
      endAt - Date.now(),
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    // Resolution is inside the same deadline. A late DNS answer cannot dial.
    Promise.resolve()
      .then(() =>
        (
          dependencies.resolve ??
          ((host) => lookup(host, { all: true, order: "verbatim" }))
        )(profile.hostname),
      )
      .then((answers) => {
        if (finished) return;
        const pin = selectPin(answers);
        if (signal.aborted || Date.now() >= endAt) {
          finish(new BrokerError(signal.aborted ? "cancelled" : "timeout"));
          return;
        }
        agent = new Agent({
          keepAlive: false,
          maxSockets: 1,
          maxCachedSessions: 0,
        });
        if (dependencies.connect) {
          agent.createConnection = (options) =>
            dependencies.connect?.(options as ConnectionOptions) as TLSSocket;
        }
        req = request({
          protocol: "https:",
          hostname: profile.hostname,
          port: profile.port,
          path: profile.path,
          method: profile.method,
          agent,
          lookup: pinnedLookup(profile.hostname, pin),
          family: pin.family,
          servername: profile.hostname,
          rejectUnauthorized: true,
          checkServerIdentity,
          minVersion: "TLSv1.2",
          maxHeaderSize: 8192,
          // Constructed from reviewed policy only; no ambient proxy or caller headers.
          headers: {
            Host:
              profile.port === 443
                ? profile.hostname
                : `${profile.hostname}:${profile.port}`,
            Accept: profile.responseTypes.join(", "),
            "Accept-Encoding": "identity",
            "Content-Type": profile.contentType,
            "Content-Length": String(body.length),
            Connection: "close",
            ...(profile.runtime
              ? { "MCP-Protocol-Version": profile.runtime.protocolVersion }
              : {}),
            ...(authorization ? { Authorization: authorization } : {}),
          },
        });
        connectTimer = setTimeout(
          () => finish(new BrokerError("timeout")),
          profile.connectMs,
        );
        req.on("error", () => finish(new BrokerError("tls")));
        req.on("socket", (raw) => {
          const socket = raw as TLSSocket;
          socket.once("secureConnect", () => {
            if (finished) return;
            try {
              // Node's normal CA+hostname verification must complete AND the
              // connected peer must match the pin before even headers dispatch.
              if (
                !socket.authorized ||
                !socket.remoteAddress ||
                normalizeAddress(socket.remoteAddress) !== pin.address
              )
                fail("tls");
              clearTimeout(connectTimer);
              if (signal.aborted || Date.now() >= endAt) {
                finish(
                  new BrokerError(signal.aborted ? "cancelled" : "timeout"),
                );
                return;
              }
              firstByteTimer = setTimeout(
                () => finish(new BrokerError("timeout")),
                profile.firstByteMs,
              );
              req?.end(body);
            } catch {
              finish(new BrokerError("tls"));
            }
          });
        });
        req.on("response", (response) => {
          clearTimeout(firstByteTimer);
          const status = response.statusCode ?? 0;
          if (
            status < 200 ||
            status >= 300 ||
            (response.headers["content-encoding"] &&
              response.headers["content-encoding"] !== "identity")
          ) {
            finish(new BrokerError("response"));
            response.destroy();
            return;
          }
          if (notification && ![202, 204].includes(status)) {
            finish(new BrokerError("response"));
            response.destroy();
            return;
          }
          const contentType =
            response.headers["content-type"]
              ?.split(";")[0]
              ?.trim()
              .toLowerCase() ?? (notification ? "application/json" : undefined);
          if (!contentType || !profile.responseTypes.includes(contentType)) {
            finish(new BrokerError("response"));
            response.destroy();
            return;
          }
          const length = response.headers["content-length"];
          if (
            length !== undefined &&
            (!/^\d+$/.test(length) || Number(length) > profile.maxResponseBytes)
          ) {
            finish(new BrokerError("limit"));
            response.destroy();
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > profile.maxResponseBytes) {
              finish(new BrokerError("limit"));
              response.destroy();
            } else chunks.push(chunk);
          });
          response.on("error", () => finish(new BrokerError("response")));
          response.on("aborted", () => finish(new BrokerError("response")));
          response.on("end", () => {
            if (!response.complete || (notification && total !== 0)) {
              finish(new BrokerError("response"));
              return;
            }
            // Only these protocol headers may return, never cookie/location/auth.
            const headers: Record<string, string> = {
              "content-type": contentType,
            };
            for (const name of ["mcp-session-id", "mcp-protocol-version"]) {
              const value = response.headers[name];
              if (value !== undefined) {
                if (
                  typeof value !== "string" ||
                  !/^[\x21-\x7e]{1,128}$/.test(value)
                ) {
                  finish(new BrokerError("response"));
                  return;
                }
                headers[name] = value;
              }
            }
            finish(undefined, {
              status,
              body: Buffer.concat(chunks, total).toString("base64"),
              headers,
              destination: {
                profileId: profile.profileId,
                revision: profile.revision,
                purpose: profile.purpose,
                address: pin.address,
              },
            });
          });
        });
      })
      .catch(() => finish(new BrokerError("destination")));
  });
}
