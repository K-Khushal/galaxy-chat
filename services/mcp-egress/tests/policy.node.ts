import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, validateConfig } from "../src/config.js";
import { publicAddress, selectPin } from "../src/ip-policy.js";
import { pinnedLookup } from "../src/pinned-https.js";
import { endpoint, PURPOSES, parseProfiles } from "../src/profile.js";
import { config, PUBLIC, profile, rawProfile } from "./helpers.js";

test("full DNS set rejects private/reserved/transition/mapped addresses", () => {
  const denied = [
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.0.9",
    "192.0.2.2",
    "192.31.196.1",
    "192.52.193.1",
    "192.88.99.1",
    "192.168.1.1",
    "192.175.48.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "239.1.1.1",
    "240.0.0.1",
    "255.255.255.255",
    "168.63.129.16",
    "::",
    "::1",
    "::ffff:93.184.216.34",
    "::ffff:7f00:1",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "ff02::1",
    "64:ff9b::7f00:1",
    "100::1",
    "2001::1",
    "2001:2::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "2620:4f:8000::1",
    "3fff::1",
    "4000::1",
    "fe80::1%en0",
  ];
  for (const address of denied) {
    const family = address.includes(":") ? 6 : 4;
    assert.throws(
      () =>
        selectPin([
          { address: PUBLIC, family: 4 },
          { address, family },
        ]),
      /destination/,
      address,
    );
  }
  assert.equal(
    publicAddress({ address: "2606:4700:4700::1111", family: 6 }).address,
    "2606:4700:4700::1111",
  );
  assert.equal(
    publicAddress({ address: "8.8.8.8", family: 4 }).address,
    "8.8.8.8",
  );
  assert.throws(() => selectPin([]));
  assert.throws(() => publicAddress({ address: PUBLIC, family: 6 }));
});

test("every purpose uses strict canonical fixed URLs and no query strings", () => {
  const bad = [
    "http://broker.example/mcp",
    "https://u:p@broker.example/mcp",
    "https://broker.example/mcp#x",
    "https://broker.example/mcp?access_token=secret",
    "https://broker.example./mcp",
    "https://BROKER.example/mcp",
    "https://xn--bcher-kva.example/mcp",
    "https://bücher.example/mcp",
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://0x7f000001/",
    "https://0177.0.0.1/",
    "https://[::1]/",
    "https://broker.example:443/mcp",
    "https://broker.example/a/../mcp",
    "https://broker.example/%2fsecret",
    "https://broker.example//mcp",
    "https://broker.local/mcp",
  ];
  for (const purpose of PURPOSES)
    for (const url of bad) {
      assert.throws(
        () => parseProfiles([rawProfile({ purpose, endpoint: url })]),
        /configuration/,
        `${purpose} ${url}`,
      );
    }
  assert.equal(endpoint("https://broker.example:8443/mcp").port, "8443");
  assert.throws(() => parseProfiles([rawProfile(), rawProfile()]));
  for (const change of [
    { method: "GET" },
    { headers: { Authorization: "secret" } },
    { proxy: "x" },
    { secret: "x" },
    { maxResponseBytes: 65537 },
    { credential: "refresh" },
    { timeoutMs: 20001 },
  ])
    assert.throws(() => parseProfiles([rawProfile(change)]));
});

test("pin lookup cannot select a fresh DNS answer or different hostname/family", () => {
  const lookup = pinnedLookup("broker.example", { address: PUBLIC, family: 4 });
  lookup("broker.example", { family: 4 }, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, PUBLIC);
    assert.equal(family, 4);
  });
  for (const [host, family] of [
    ["rebind.example", 4],
    ["broker.example", 6],
  ] as const)
    lookup(host, { family }, (error) =>
      assert.match(error?.message ?? "", /destination/),
    );
});

test("default off; strict keys, remote-bind gates and separate strong keys", () => {
  assert.equal(loadConfig({}), undefined);
  assert.equal(loadConfig({ MCP_EGRESS_BROKER_ENABLED: "0" }), undefined);
  assert.throws(
    () =>
      loadConfig({ MCP_EGRESS_BROKER_ENABLED: "1", MCP_EGRESS_UNKNOWN: "x" }),
    /configuration/,
  );
  assert.throws(
    () => validateConfig({ ...config(), hmacKey: Buffer.alloc(16) }),
    /configuration/,
  );
  assert.throws(
    () => validateConfig({ ...config(), envelopeKey: config().hmacKey }),
    /configuration/,
  );
  assert.throws(
    () => validateConfig({ ...config(), bind: "0.0.0.0" }),
    /configuration/,
  );
  assert.throws(() =>
    validateConfig({
      ...config(),
      profiles: [profile({ clientSecretRef: "secret" })],
    }),
  );
  assert.throws(() =>
    parseProfiles([
      rawProfile({
        purpose: "oauth.token",
        contentType: "application/x-www-form-urlencoded",
      }),
    ]),
  );
});
