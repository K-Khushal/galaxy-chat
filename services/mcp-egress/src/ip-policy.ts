import { BlockList, isIP } from "node:net";
import { fail } from "./errors.js";

// Conservative special-purpose policy. Includes IANA special-purpose blocks,
// documentation, transition, anycast service blocks and Azure's platform VIP.
// IPv6 is allowed only in current global-unicast space, with exceptions below.
export const DENIED_V4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.31.196.0", 24],
  ["192.52.193.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["192.175.48.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["168.63.129.16", 32],
] as const;
export const DENIED_V6 = [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["2620:4f:8000::", 48],
  ["3fff::", 20],
] as const;
const v4 = new BlockList();
const v6 = new BlockList();
const globalV6 = new BlockList();
for (const [address, prefix] of DENIED_V4)
  v4.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of DENIED_V6)
  v6.addSubnet(address, prefix, "ipv6");
globalV6.addSubnet("2000::", 3, "ipv6");
export type Address = Readonly<{ address: string; family: 4 | 6 }>;
export function normalizeAddress(address: string): string {
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6 || address.includes("%")) fail("destination");
  // URL's IPv6 serializer compresses consistently without accepting zones.
  return new URL(`http://[${address}]/`).hostname.slice(1, -1);
}
export function publicAddress(value: {
  address: string;
  family: number;
}): Address {
  const address = normalizeAddress(value.address);
  const family = isIP(address);
  if (family !== value.family || (family !== 4 && family !== 6))
    fail("destination");
  if (
    family === 4
      ? v4.check(address, "ipv4")
      : !globalV6.check(address, "ipv6") || v6.check(address, "ipv6")
  )
    fail("destination");
  return Object.freeze({ address, family });
}
export function selectPin(
  answers: readonly { address: string; family: number }[],
): Address {
  if (answers.length === 0 || answers.length > 64) fail("destination");
  const checked = answers.map(publicAddress);
  checked.sort(
    (a, b) => a.family - b.family || a.address.localeCompare(b.address),
  );
  return checked[0];
}
