# Private image generation (F12-C)

Image generation is **disabled by default**. The repository seeds no live model,
endpoint, or price. This implementation supports generation only. Editing and masks
are denied before key decryption or provider entry because the installed adapter
has no verified file/mask capability.

## Configuration and review

Enable only after the pending live gates below are resolved. Set `IMAGES_ENABLED=1`
and `IMAGE_MODELS_JSON` to an array containing exactly one reviewed snapshot. The
strict schema in `lib/images/config.ts` rejects unknown fields, duplicates, expired
reviews, unsafe integer prices, estimates below the provider maximum, edit/mask
support, and any output except one 1024×1024 PNG. Required fields are:

- `id`, `adapter:"openrouter"`, exact `model`, exact endpoint `provider`;
- `verified:true`, ISO UTC `reviewedAt` and future `expiresAt`;
- `width:1024`, `height:1024`, `mediaType:"image/png"`;
- `generate:true`, `edit:false`, `mask:false`, `parameters:["size","n"]`;
- positive safe-integer `providerMaxMicrodollarsPerImage`,
  `worstCaseEstimateMicrodollars`, and `providerBudgetVerified:true`.

The invited owner supplies their encrypted OpenRouter key and explicitly accepts
the payer, displayed estimate, application ceiling, and provider budget caveat.
The app ceiling gates entry; it cannot guarantee provider charges or fees. Configure
provider-side spending limits. The request pins the complete snapshot, credential
revision, and expected artifact head; these are checked again after awaited locks.
There is no platform-funded fallback or hidden rewrite, retry, or upscale.

`ATTACHMENTS_ENABLED=1` and the existing verified-private storage configuration and
byte/transfer budgets are also required. Images and F10 attachments share private
capacity, object limits, processing limits, transfer budget, and durable delete
queue. Apply migrations through `bun run db:migrate`; migrations 0011 and 0012
are inherited from reviewed main, and 0013 adds image artifacts to them while
preserving absent-intermediate number upgrade support. Do not create placeholder migration files.

## Execution and lifecycle

AI SDK `generateImage` uses the installed exact OpenRouter adapter, one image,
`maxRetries:0`, and a 60-second combined abort. Provider options pin `only`/`order`,
disable fallbacks, require parameters, and send reviewed `max_price.image` using
exact decimal conversion. The fixed HTTPS image endpoint rejects redirects and
bounds both declared and streamed bodies before JSON/base64 parsing.

Provider images must fit 4 MiB, have valid PNG magic/CRC/chunk structure, be
non-animated 8-bit RGB/RGBA at exactly 1024×1024, and pass bounded inflation before
decoding. Ancillary metadata is discarded before decoding; fast-png 8.0.0 re-encodes
pixels and the resulting PNG is revalidated and SHA-256 hashed. Never persist
original provider bytes as a fallback. No image revision exists until upload and
the final owned head/CAS transaction succeed.

Reserved failures release BYOK capacity. Once entered, unknown provider outcomes,
cancellation, timeouts, revocation, deletion, and ambiguous uploads remain held;
a local timeout is not terminal provider evidence. The private-object tombstone
retains full byte liability and repeats deletion after an entered upload becomes
terminal. Run the existing serialized `attachments:cleanup` operator job; it also
recovers expired image leases. Use the existing reconciliation command only with
real terminal-write evidence. There is no automatic remote-hold release interface.

Image objects and artifact revisions are immutable. Restore creates a new metadata
revision pointing to the same owned object. Downloads require invited ownership
and an explicit artifact revision, reserve transfer budget, check length/digest,
and return private/no-store PNG attachment headers. No storage URL reaches clients.
Exports include private generation/provenance/object metadata, never key material,
binary image bodies, or signed URLs. Account/chat/message/artifact deletion cascades
metadata and queues objects; anonymous BYOK holds remain until resolved.

## Offline verification versus live gates

Offline tests inject SDK/network/storage and use local PGlite only. The development
fixture `/preview/images` needs `NODE_ENV=development` and `F04_UI_HARNESS=1`; its
images are placeholders, its prices are fictitious, and downloads are disabled.
It proves UI behavior only, never provider compatibility, billing, or hosted storage.

The following remain pending and are required before activation: actual exact-model
and endpoint compatibility; all-in pricing and fees; provider spending/max-price
behavior; abort and terminal receipt semantics; hosted private storage, cleanup,
egress, and authenticated browser downloads; supported-device checks. No live
model/price is recommended or invented by these source changes.

Installed contract references: AI SDK `node_modules/ai/docs/03-ai-sdk-core/35-image-generation.mdx`,
`node_modules/ai/src/generate-image/generate-image.ts`, and OpenRouter's installed
image model implementation. Exact `fast-png@8.0.0` is MIT; Bun, Next Webpack,
OpenNext packaging, and a local offline workerd digest spike were checked before
integration. These are compatibility observations, not a deployment proof.
