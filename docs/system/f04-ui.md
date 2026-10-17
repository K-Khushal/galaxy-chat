# Galaxy UI foundations and contracts

F04 uses one semantic palette from `app/globals.css`, existing Radix/shadcn behavior, and adapted AI Elements/Streamdown rendering. The chat shell does not import the large Halaska kit at runtime. Vendor provenance/checksums remain unchanged.

| Role | Token/family | Use |
| --- | --- | --- |
| Workspace canvas | background / foreground | chat and auth |
| Raised surface | card / card-foreground | composer, account panels |
| Transient layer | popover / popover-foreground | models, menus |
| Navigation | sidebar family | history/account |
| Primary action | primary / primary-foreground | send, submit |
| Secondary surface | secondary / secondary-foreground | user bubble |
| Supporting text | muted-foreground | status, labels |
| Selection | accent / accent-foreground | hovered/selected controls |
| Destructive | destructive / destructive-foreground | deletion and error |
| Boundary/focus | border, input, ring | outlines and focus |

Light and dark role pairs are defined together; system follows `next-themes`. Sans/mono use the existing self-hosted Next Geist outputs. Body 14–16px, supporting text 12px, headings 24–36px; touch inputs explicitly remain 16px below desktop. Native text elements retain semantic headings and paragraphs rather than adding a generic text wrapper.

Chat content and composer share max-w-3xl, with reading content inset. The desktop sidebar is 16rem, icon rail 4rem, mobile drawer at most viewport minus 2rem. Geometry exceptions are viewport/safe-area calculations, Radix positioning variables, content overflow selectors and preview dimensions. Overlays retain the standard black/50 scrim; code highlighting is controlled by Streamdown. Legacy landing, library and F01 spike have not been migrated by this slice.

| Component | Canonical states/behavior |
| --- | --- |
| Button | primary/secondary/outline/ghost/link/destructive; focus, active, disabled, invalid |
| Input | idle, focus, invalid, disabled; labeled native input; mobile 16px |
| Dialog/Sheet | Radix focus trap, Escape/outside dismiss, named title/description; controlled opener focus refs |
| History | loading, empty, search empty, error/retry, page, rename, delete confirm/failure |
| Composer | unavailable, draft, ready fixture, submitted, streaming stop; IME-safe Enter, Shift+Enter newline |
| Messages | empty, user, assistant, submitted, streaming, error, code, table, sources/reasoning when supplied |
| Account | profile, appearance, privacy; export busy/failure, delete confirm/busy/failure |

Motion: high-frequency chat/nav/text changes are immediate. Button color feedback uses the shared 140ms press token and ease-out. Menus/dialogs retain short Radix/Tailwind opacity/scale motion; drawer enters 200ms and exits 150ms. No streamed-token or history-title animation. Reduced-motion CSS overrides component animation/transition utilities; manual message scrolling uses `auto` and automatic following is instant.

`ChatInput` receives `onSend`, `stop`, text/model state and `ChatAvailability`. The real shell defaults to unavailable, never invents a model or provider response. Model catalog population and branch edits are F05. `CreditStatus` is a display union with unavailable, available, exhausted, paused and BYOK states. `PlatformCreditView`/`toCreditStatus` maps the agreed F06 API contract, with disabled/configuration state winning over the numeric balance. F04 does not fetch a nonexistent endpoint. F06 integration must use authenticated no-store data. Secure provider keys are F07; no key entry or storage is simulated here.

Focus contracts to probe independently: history rename close -> same row action; history delete success -> same action if connected, otherwise search; account close -> account trigger; nested delete cancel -> original account action; mobile drawer -> outside opener. Root owns rendered review. Source/tests are not screen-reader or physical-device proof.
