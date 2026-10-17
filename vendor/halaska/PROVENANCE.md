# Halaska UI provenance

Vendored 2026-10-17 from the official distribution. The kit files below are unmodified bytes. This note, `SHA256SUMS`, and the application prototype are project files.

| File | Source | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `halaska-kit.jsx` | https://ui.halaska.com/halaska-kit.jsx | 739157 | `54e24582de20e96c3228e2abc5eba225219183c03b82eeefc2bad0a57ef5c24a` |
| `halaska-kit.d.ts` | https://ui.halaska.com/halaska-kit.d.ts | 9403 | `fc8760c4c3ada52d642f76b2da5c346afd853a7c47f28047762d5dcde01ab27b` |
| `LICENSE` | https://raw.githubusercontent.com/Halaska-Studio/ui/main/LICENSE | 1071 | `3e8303becd6efb3a15b58158af96a35da65234196df1733ae1b792a9166b404a` |

Kit response headers: `etag: "46e78c0d7a342cae4522ea8d97071632"` (matches the file MD5), `last-modified: Sat, 17 Oct 2026 09:02:15 GMT`, `content-type: text/jsx`. The type shim was served as `content-type: video/mp2t` with `etag: "e8b4c1489c8d0f6bcaeb8bd1338d99ec"`; the body is the TypeScript shim, and that etag matches its MD5.

GitHub source: [Halaska-Studio/ui](https://github.com/Halaska-Studio/ui) `halaska-kit/halaska-kit-v1.0.jsx`. Git blob SHA-1 `a7e55b0c39ab7b290e9c851bed81fc73038dd225` matches the vendored kit. The commit that last changed that path is `260b4981306ac5506c86b6b1823e4ae8df2c8f7c` (2026-10-01T07:49:08Z, "Patterns adapt to narrow widths"). The site `last-modified` is newer than that commit, and the bytes still match the blob.

License: MIT, SPDX MIT, Copyright (c) 2026 Halaska Studio. The kit header says `Halaska UI v1.0` and MIT. Install guide: https://ui.halaska.com/docs/install and https://ui.halaska.com/install.md. Official install adds no package dependency. Runtime dependency stated by the vendor is `react` and `react-dom` only. The file begins with `"use client"`.

The kit contains one NUL byte at offset 368483 inside a template literal (`\x00` used as a segment separator). The checksum covers that byte. Do not reformat or "clean" the file.

Biome ignores `vendor/` so the kit stays byte-identical.
