import type { BrokerConfig } from "./config.js";
import { BrokerError, fail } from "./errors.js";
import {
  type EgressResult,
  pinnedHttps,
  type TransportDependencies,
} from "./pinned-https.js";
import type { Profile } from "./profile.js";
import {
  authenticate,
  decode64,
  openCredential,
  parseAnyEnvelope,
  signTransportEvidence,
} from "./protocol.js";
import type { ReplayStore } from "./replay-store.js";

function prepareBody(
  p: Profile,
  bytes: Buffer,
  token: string | undefined,
  secrets: BrokerConfig["secrets"],
): Buffer {
  if (bytes.length > p.maxRequestBytes) fail("limit");
  if (p.method === "GET") {
    if (bytes.length) fail("invalid_request");
    return bytes;
  }
  if (p.purpose.startsWith("mcp.")) {
    // The MCP client owns JSON-RPC semantics. No URLs or headers are interpreted.
    try {
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      fail("invalid_request");
    }
    return bytes;
  }
  // Token-bearing OAuth fields may ONLY come from the separate encrypted
  // envelope. Client authentication is broker-side, never body/profile secrets.
  const input = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const form = new URLSearchParams(input);
  const allowed = p.purpose === "oauth.token" ? ["code", "code_verifier"] : [];
  const names = new Set<string>();
  for (const [name, value] of form) {
    if (!allowed.includes(name) || names.has(name) || value.length > 2048)
      fail("invalid_request");
    names.add(name);
  }
  if (
    p.purpose === "oauth.token" &&
    (!form.get("code") ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(form.get("code_verifier") ?? ""))
  )
    fail("invalid_request");
  if (p.purpose === "oauth.token") form.set("grant_type", "authorization_code");
  if (p.purpose === "oauth.refresh") {
    form.set("grant_type", "refresh_token");
    form.set("refresh_token", token ?? "");
  }
  if (p.purpose === "oauth.revoke") form.set("token", token ?? "");
  for (const [name, value] of Object.entries(p.formFields))
    form.set(name, value);
  form.set("resource", p.resource);
  if (p.clientSecretRef) form.set("client_secret", secrets[p.clientSecretRef]);
  const result = Buffer.from(form.toString());
  if (result.length > p.maxRequestBytes) fail("limit");
  return result;
}
export function createBroker(
  config: BrokerConfig,
  store: ReplayStore,
  dependencies: TransportDependencies = {},
) {
  let replayActive = 0;
  return async (
    input: unknown,
    signature: unknown,
    signal: AbortSignal,
  ): Promise<EgressResult> => {
    if (signal.aborted) fail("cancelled");
    const now = Date.now();
    const e = parseAnyEnvelope(input, now);
    authenticate(e, signature, config.hmacKey);
    const profile = config.profiles.find(
      (p) =>
        p.profileId === e.profileId &&
        p.revision === e.revision &&
        p.purpose === e.purpose,
    );
    if (!profile) fail("invalid_request");
    if (profile.runtime && e.version !== 2) fail("authentication");
    if (signal.aborted) fail("cancelled");
    if (Date.now() >= e.deadline) fail("timeout");
    if (replayActive >= config.concurrency) fail("busy");
    replayActive++;
    let released = false;
    const releasePermit = () => {
      if (!released) {
        released = true;
        replayActive--;
      }
    };
    let consumePromise: Promise<boolean>;
    try {
      consumePromise = Promise.resolve(
        store.consume(e.requestId, e.issuedAt + 60_000, now),
      );
    } catch (error) {
      releasePermit();
      throw error;
    }
    consumePromise.then(
      () => releasePermit(),
      () => releasePermit(),
    );
    const consumed = await new Promise<boolean>((resolve, reject) => {
      const abort = () => {
        cleanup();
        reject(new BrokerError("cancelled"));
      };
      const remaining = e.deadline - Date.now();
      if (remaining <= 0) {
        reject(new BrokerError("timeout"));
        return;
      }
      const timer = setTimeout(() => {
        cleanup();
        reject(new BrokerError("timeout"));
      }, remaining);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      consumePromise.then(
        (result) => {
          cleanup();
          resolve(result);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
    if (!consumed) fail("replay");
    if (signal.aborted) fail("cancelled");
    if (Date.now() >= e.deadline) fail("timeout");
    let notification = false;
    if (e.version === 2) {
      const r = profile.runtime;
      if (
        !r ||
        !config.evidence ||
        r.manifestDigest !== e.manifestDigest ||
        r.profileDigest !== e.profileDigest ||
        config.evidence.keyVersion !== e.keyVersion ||
        profile.credential !== "none"
      )
        fail("authentication");
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            decode64(e.body, 65536),
          ),
        );
      } catch {
        fail("invalid_request");
      }
      if (!body || Array.isArray(body) || body.jsonrpc !== "2.0")
        fail("invalid_request");
      if (profile.purpose === "mcp.call") {
        if (
          body.method !== "tools/call" ||
          !body.params ||
          typeof body.params !== "object" ||
          Reflect.get(body.params, "name") !== r.toolName ||
          typeof body.id !== "string"
        )
          fail("invalid_request");
      } else if (body.method === "notifications/initialized") {
        notification = true;
        if (Object.keys(body).sort().join(",") !== "jsonrpc,method")
          fail("invalid_request");
      } else if (
        body.method !== "initialize" ||
        typeof body.id !== "string" ||
        !body.params ||
        typeof body.params !== "object" ||
        Reflect.get(body.params, "protocolVersion") !== r.protocolVersion
      )
        fail("invalid_request");
    }
    const token = openCredential(e, profile, config.envelopeKey);
    if ((profile.credential === "none") !== (token === undefined))
      fail("authentication");
    const body = prepareBody(
      profile,
      decode64(e.body, 65_536),
      token,
      config.secrets,
    );
    const result = await pinnedHttps(
      profile,
      body,
      profile.credential === "bearer" ? `Bearer ${token}` : undefined,
      e.deadline,
      signal,
      dependencies,
      notification,
    );
    if (e.version === 2 && config.evidence)
      return {
        ...result,
        attestation: signTransportEvidence(
          e,
          result,
          config.evidence.keyVersion,
          config.evidence.privateKey,
        ),
      };
    return result;
  };
}
