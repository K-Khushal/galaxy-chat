# Auth and UI setup

Verified 2026-10-31 after `bun install`: repository `better-auth@1.7.10`, `@better-auth/drizzle-adapter@1.7.10`, Next 16.4.2, React 19.3.1, Tailwind 4.3.3. Isolated scratch installs (not repository dependencies): `@upstash/redis@1.40.0`, `@upstash/ratelimit@2.2.0`, `resend@6.37.0`, `@aws-sdk/client-s3@3.1161.0`, `@aws-sdk/s3-request-presigner@3.1161.0`, `shadcn@4.23.0`, `@base-ui/react@1.9.0`. Install explicit versions with Bun when implementing. These are signature/source-verified examples, not live-provider integration tests. Read issues #67, #68 and #72 and ADRs before implementation.

## Better Auth: verified linking, OTP, Credits

Configuration fragment; provide the Drizzle adapter, central validated env, baseURL, secret and trusted origins in the real module. All server modules import `server-only`.

```ts
import 'server-only';
import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import { Resend } from 'resend';

const resend = new Resend(env.RESEND_API_KEY);
export const auth = betterAuth({
  socialProviders: {
    github: { clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET },
    google: { clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET },
  },
  account: { accountLinking: {
    enabled: true,
    trustedProviders: [],
    requireLocalEmailVerified: true,
  } },
  secondaryStorage, // adapter below
  session: { storeSessionInDatabase: true },
  rateLimit: { enabled: true, storage: 'secondary-storage' },
  plugins: [emailOTP({
    otpLength: 6,
    expiresIn: 300,
    storeOTP: 'hashed',
    async sendVerificationOTP({ email, otp, type }) {
      const { error } = await resend.emails.send({
        from: env.AUTH_EMAIL_FROM,
        to: email,
        subject: 'Your Galaxy sign-in code',
        text: `Your ${type} code is ${otp}. It expires in 5 minutes.`,
      });
      if (error) throw new Error('Could not send verification code');
    },
  })],
});
```

Do not enable passwords. Register `emailOTPClient()` from `better-auth/client/plugins` with `createAuthClient` from `better-auth/react`. Call `authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })`, then `authClient.signIn.emailOtp({ email, otp })`; social sign-in uses `authClient.signIn.social({ provider: 'github' })` (or `google`). Mount `toNextJsHandler(auth)` from `better-auth/next-js` as GET/POST at `app/api/auth/[...all]/route.ts`. OAuth callbacks are `/api/auth/callback/github` and `/api/auth/callback/google`; configure exact deployed/local URLs at each provider.

Installed linking code rejects an unverified incoming email unless the provider is trusted. `trustedProviders: []` avoids bypassing that check; `requireLocalEmailVerified: true` also protects an existing unverified local account. Do not enable different-email linking. Verify GitHub's returned verified primary email and handle missing email; never mark email verified from an arbitrary profile string.

Use `databaseHooks.user.create.after: async (user, context) => { ... }` for user creation; `databaseHooks.account.create.after` can observe provider identities, and `databaseHooks.user.update.after` handles later verification. Grant Credits only for verified identities. The user-create hook alone is insufficient to guarantee access to all OAuth account IDs: account insertion is separate. Implement one idempotent grant function, transactionally claim unique hashed verified email/provider-ID records, and create the allowance exactly once. Await grant work; do not fire-and-forget. A returning identity receives 0 Credits. Keep identity records across account deletion. Do not award again on linking or verification updates; concurrent hooks must converge. Exact transaction plumbing depends on the eventual M0 schema and is intentionally not invented here.

Sources: installed `better-auth/dist/plugins/email-otp/{index,routes}.mjs`, `better-auth/dist/oauth2/link-account.mjs`, `@better-auth/core/dist/types/init-options.d.mts`; [OTP docs](https://better-auth.com/docs/plugins/email-otp), [account linking](https://better-auth.com/docs/concepts/users-accounts), [database hooks](https://better-auth.com/docs/concepts/database#database-hooks), [GitHub](https://better-auth.com/docs/authentication/github), [Google](https://better-auth.com/docs/authentication/google).

## Upstash secondary storage and rate limiting

Use REST URL/token for this client, distinct from resumable-stream's TCP URL. `get` must return the original serialized string: Upstash's default automatic JSON deserialization can break Better Auth. TTL is seconds. In **1.7.10**, `increment(key, ttl)` is required, atomic, and applies TTL only on creation. An adapter with just get/set/delete is incomplete.

```ts
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
  automaticDeserialization: false,
});
const prefix = (key: string) => `galaxy:auth:${key}`;
const secondaryStorage = {
  get: (key: string) => redis.get<string>(prefix(key)),
  async set(key: string, value: string, ttl?: number) {
    if (ttl !== undefined) await redis.set(prefix(key), value, { ex: ttl });
    else await redis.set(prefix(key), value);
  },
  async delete(key: string) { await redis.del(prefix(key)); },
  async increment(key: string, ttl: number) {
    return Number(await redis.eval(
      `local n = redis.call('INCR', KEYS[1])
       if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return n`,
      [prefix(key)], [ttl],
    ));
  },
};
```

With secondary storage, Better Auth stores sessions there by default; `session.storeSessionInDatabase: true` additionally persists them to Postgres and enables fallback for missing cached entries. This is not a switch to exclusively Postgres sessions. Verification/OTP state uses secondary storage; avoid accidentally forcing verification storage back to the DB. Choose `preserveSessionInDatabase` only after reading its revocation semantics, not as a generic durability flag.

The built-in limiter defaults to memory absent secondary-storage configuration; memory is per function instance. Set storage explicitly as above. It defaults to production-only, 100 requests/10s, with stricter endpoint rules (the installed emailOTP plugin defaults to 3 requests/60s on its protected routes); `enabled: true` also tests it in development. Server `auth.api` calls do not pass through the HTTP limiter. Enforce per-email and per-IP OTP abuse controls before mail send, not merely in a client component. Do not log email codes or raw identities.

Sources: installed `@better-auth/core/dist/db/type.d.mts:SecondaryStorage`, `better-auth/dist/api/rate-limiter/index.mjs`, `better-auth/dist/db/internal-adapter.mjs`; [rate-limit docs](https://better-auth.com/docs/concepts/rate-limit), [Upstash client](https://github.com/upstash/redis-js).

For application endpoints, `@upstash/ratelimit@2.2.0`:

```ts
import { Ratelimit } from '@upstash/ratelimit';
const limiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'),
  prefix: 'galaxy:send',
  analytics: false,
});
const { success, reset, pending } = await limiter.limit(userId);
// Register pending with after(() => pending) inside a Route Handler.
// If !success: return HTTP 429 with Retry-After in seconds.
```

Use separate prefixes/rules for OTP IP, hashed normalized email, Message send and BYOK save. Authenticate before user-ID limits. Ratelimit's timeout behavior can allow requests through: define and test failure behavior for sensitive OTP routes rather than assuming Redis failure blocks mail. Source: installed `@upstash/ratelimit/dist/index.d.ts`; [official README](https://github.com/upstash/ratelimit-js).

## shadcn Base UI, Tailwind 4, Next 16

The verified style is **`base-nova`**, not `new-york` (Radix) and not `base`. For the existing application, set this in `components.json` before generating components:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components", "utils": "@/lib/utils",
    "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks"
  }
}
```

Tailwind 4 uses `@import "tailwindcss"` and `@tailwindcss/postcss`; no v3 config path. Preserve Galaxy tokens in globals.css when regenerating. Then use `bunx shadcn@4.23.0 add button input textarea dialog alert-dialog dropdown-menu popover tooltip command scroll-area sheet separator skeleton sonner avatar badge tabs switch label`. This note verifies the style/registry, not a destructive init inside the inherited app.

The [base-nova registry](https://ui.shadcn.com/r/styles/base-nova/registry.json) includes all primitives requested by #67, plus accordion, checkbox, collapsible, combobox, context-menu, drawer, hover-card, select, radio-group, slider, navigation-menu, menubar, progress, toggle, toggle-group, calendar, date-picker composition, table, sidebar and others. Some are styled native elements/compositions or use other libraries (e.g. Sonner); Base UI availability does not mean each is a Base UI primitive. Date picker is a composition, not a `date-picker` item in this snapshot. All names in the add command above were present in the live registry.

Base UI uses `render` composition instead of Radix `asChild`:

```tsx
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '@/components/ui/button';
<Dialog.Root>
  <Dialog.Trigger render={<Button variant="outline" />}>Settings</Dialog.Trigger>
</Dialog.Root>
```

Custom rendered components must forward ref and spread received props so handlers, focus and ARIA survive. Avoid nested buttons. For navigation, current shadcn guidance uses `<Link className={buttonVariants()}>…</Link>`; rendering an anchor through Base UI Button can override link semantics with `role="button"`. Keep Lucide icons, focus visibility, coarse-pointer touch targets and reduced-motion rules from #67.

Sources: installed `shadcn/dist/index.js` (base-nova), `@base-ui/react/dialog/trigger/DialogTrigger.d.ts`; [Next install](https://ui.shadcn.com/docs/installation/next), [Base Button](https://ui.shadcn.com/docs/components/base/button), [Base UI composition](https://base-ui.com/react/handbook/composition).

## R2 presigned PUT

```ts
import 'server-only';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});
const url = await getSignedUrl(s3, new PutObjectCommand({
  Bucket: env.R2_BUCKET,
  Key: serverGeneratedOwnerScopedKey,
  ContentType: validatedContentType,
}), { expiresIn: 300 });
// Browser: await fetch(url, { method: 'PUT', body: file,
//   headers: { 'Content-Type': validatedContentType } });
```

Only the URL goes to the browser. Authorize first, generate an unpredictable owner-scoped object key, validate file type/size, and configure bucket CORS for the exact origin, PUT and Content-Type. Sign against the S3 endpoint, not a custom/public domain. A signed URL is reusable until expiry and PUT can overwrite the same key; do not log it. A declared size or Content-Type does not prove the actual file is safe: verify metadata and content after upload before marking the Attachment ready. Do not assume a presigned PUT imposes a POST-policy content-length range. Sources: installed AWS `dist-types/index.d.ts` exports and `getSignedUrl.d.ts`; [R2 official presigning docs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [AWS v3 presigner README](https://github.com/aws/aws-sdk-js-v3/tree/main/packages/s3-request-presigner).

Verification: extracted server snippets (with declared application inputs) passed TypeScript `--strict --noEmit --skipLibCheck --moduleResolution bundler --module esnext --target es2022` against the versions above. The reconnect snippet also passed; generated shadcn component composition was checked against Base UI declarations rather than compiled against a component that has not been generated yet. No external provider was called for snippet verification.
