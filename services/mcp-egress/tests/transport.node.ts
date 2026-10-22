import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { checkServerIdentity, connect } from "node:tls";
import { pinnedHttps } from "../src/pinned-https.js";
import {
  certificates,
  offlineDial,
  PUBLIC,
  profile,
  upstream,
} from "./helpers.js";

let cert: ReturnType<typeof certificates>;
before(() => {
  cert = certificates();
});
after(() => cert.close());
const signal = () => new AbortController().signal;

test("real TLS requests preserve Host/SNI/normal verification; no pooling or retry", async () => {
  let requests = 0;
  let connections = 0;
  const bodies: string[] = [];
  const fixture = await upstream(cert, (req, res) => {
    requests++;
    assert.equal(req.headers.host, "broker.example");
    assert.equal(req.headers.authorization, "Bearer encrypted-token");
    assert.equal(req.headers["accept-encoding"], "identity");
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      bodies.push(body);
      res.writeHead(200, {
        "content-type": "application/json",
        "mcp-session-id": "reviewed-session",
        "set-cookie": "secret",
        location: "https://secret.example/?token=secret",
      });
      res.end('{"ok":true}');
    });
  });
  fixture.server.on("secureConnection", (socket) => {
    connections++;
    assert.equal(socket.servername, "broker.example");
  });
  const dial = offlineDial(fixture.port, cert.ca, {
    inspect: (options) =>
      assert.equal(options.checkServerIdentity, checkServerIdentity),
  });
  try {
    for (let i = 0; i < 2; i++) {
      const result = await pinnedHttps(
        profile(),
        Buffer.from("{}"),
        "Bearer encrypted-token",
        Date.now() + 1000,
        signal(),
        dial.dependencies,
      );
      assert.equal(
        Buffer.from(result.body, "base64").toString(),
        '{"ok":true}',
      );
      assert.deepEqual(result.headers, {
        "content-type": "application/json",
        "mcp-session-id": "reviewed-session",
      });
      assert.equal(result.destination.address, PUBLIC);
    }
    assert.equal(requests, 2);
    assert.equal(connections, 2);
    assert.deepEqual(bodies, ["{}", "{}"]);
  } finally {
    await fixture.close();
  }
});

test("bad CA, wrong hostname and mismatching remoteAddress dispatch zero HTTP bytes", async () => {
  let requests = 0;
  let httpBytes = 0;
  const fixture = await upstream(cert, (_req, res) => {
    requests++;
    res.end("{}");
  });
  fixture.server.on("secureConnection", (socket) =>
    socket.on("data", (chunk) => {
      httpBytes += chunk.length;
    }),
  );
  try {
    for (const options of [{ trust: false }, { remoteAddress: "127.0.0.1" }]) {
      const dial = offlineDial(fixture.port, cert.ca, options);
      await assert.rejects(
        pinnedHttps(
          profile(),
          Buffer.from("{}"),
          undefined,
          Date.now() + 1000,
          signal(),
          dial.dependencies,
        ),
        /tls/,
      );
    }
    const dial = offlineDial(fixture.port, cert.ca);
    const wrongName = { ...profile(), hostname: "wrong.example" };
    // Same actual production TLS connect and CA verification, wrong SNI identity.
    await assert.rejects(
      pinnedHttps(
        wrongName,
        Buffer.from("{}"),
        undefined,
        Date.now() + 1000,
        signal(),
        {
          resolve: dial.dependencies.resolve,
          connect: (options) => {
            return connect({
              ...options,
              host: "127.0.0.1",
              port: fixture.port,
              lookup: undefined,
              ca: cert.ca,
            });
          },
        },
      ),
      /tls/,
    );
    assert.equal(requests, 0);
    assert.equal(httpBytes, 0);
  } finally {
    await fixture.close();
  }
});

test("mixed DNS, rebinding and aborted/late resolution never enter dial", async () => {
  let dials = 0;
  const connect = () => {
    dials++;
    throw new Error("must not dial");
  };
  await assert.rejects(
    pinnedHttps(
      profile(),
      Buffer.from("{}"),
      undefined,
      Date.now() + 1000,
      signal(),
      {
        resolve: async () => [
          { address: PUBLIC, family: 4 },
          { address: "10.0.0.1", family: 4 },
        ],
        connect,
      },
    ),
    /destination/,
  );
  const abort = new AbortController();
  const result = pinnedHttps(
    profile(),
    Buffer.from("{}"),
    undefined,
    Date.now() + 1000,
    abort.signal,
    {
      resolve: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve([{ address: PUBLIC, family: 4 }]), 50),
        ),
      connect,
    },
  );
  abort.abort();
  await assert.rejects(result, /cancelled/);
  await assert.rejects(
    pinnedHttps(
      profile({ timeoutMs: 10, connectMs: 10, firstByteMs: 10 }),
      Buffer.from("{}"),
      undefined,
      Date.now() + 1000,
      signal(),
      {
        resolve: () =>
          new Promise((resolve) =>
            setTimeout(() => resolve([{ address: PUBLIC, family: 4 }]), 40),
          ),
        connect,
      },
    ),
    /timeout/,
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(dials, 0);
});

test("redirect/status/encoding/type/oversize/slow/cancel fail once and destroy sockets", async () => {
  for (const mode of [
    "redirect",
    "status",
    "encoding",
    "type",
    "declared",
    "stream",
    "firstbyte",
    "slowbody",
    "abort",
  ] as const) {
    let requests = 0;
    const fixture = await upstream(cert, (_req, res) => {
      requests++;
      if (mode === "firstbyte") return;
      res.writeHead(mode === "redirect" ? 302 : mode === "status" ? 500 : 200, {
        "content-type": mode === "type" ? "text/html" : "application/json",
        ...(mode === "redirect"
          ? { location: "https://127.0.0.1/?token=secret" }
          : {}),
        ...(mode === "encoding" ? { "content-encoding": "gzip" } : {}),
        ...(mode === "declared" ? { "content-length": "65537" } : {}),
      });
      if (mode === "stream") {
        res.write(Buffer.alloc(40000));
        res.end(Buffer.alloc(30000));
      } else if (mode === "slowbody" || mode === "abort") {
        res.write("{");
      } else res.end("{}");
    });
    const dial = offlineDial(fixture.port, cert.ca);
    const controller = new AbortController();
    const p = profile({ timeoutMs: 150, connectMs: 120, firstByteMs: 70 });
    try {
      const promise = pinnedHttps(
        p,
        Buffer.from("{}"),
        undefined,
        Date.now() + 300,
        controller.signal,
        dial.dependencies,
      );
      if (mode === "abort") setTimeout(() => controller.abort(), 50);
      await assert.rejects(
        promise,
        new RegExp(
          mode === "abort"
            ? "cancelled"
            : ["firstbyte", "slowbody"].includes(mode)
              ? "timeout"
              : ["declared", "stream"].includes(mode)
                ? "limit"
                : "response",
        ),
        mode,
      );
      assert.equal(requests, 1, mode);
      assert.equal(dial.sockets.length, 1, mode);
      assert.equal(dial.sockets[0].destroyed, true, mode);
    } finally {
      await fixture.close();
    }
  }
});

test("fresh full-set DNS validation on every operation rejects a later rebound answer", async () => {
  let requests = 0;
  let resolves = 0;
  const fixture = await upstream(cert, (_req, res) => {
    requests++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  const dial = offlineDial(fixture.port, cert.ca);
  const dependencies = {
    ...dial.dependencies,
    resolve: async () => {
      resolves++;
      return resolves === 1
        ? [
            { address: PUBLIC, family: 4 },
            { address: "2606:4700:4700::1111", family: 6 },
          ]
        : [{ address: "127.0.0.1", family: 4 }];
    },
  };
  try {
    await pinnedHttps(
      profile(),
      Buffer.from("{}"),
      undefined,
      Date.now() + 1000,
      signal(),
      dependencies,
    );
    await assert.rejects(
      pinnedHttps(
        profile(),
        Buffer.from("{}"),
        undefined,
        Date.now() + 1000,
        signal(),
        dependencies,
      ),
      /destination/,
    );
    assert.equal(resolves, 2);
    assert.equal(requests, 1);
    assert.equal(dial.sockets.length, 1);
  } finally {
    await fixture.close();
  }
});
