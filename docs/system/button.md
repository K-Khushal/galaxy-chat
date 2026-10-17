<!-- Draft component entry derived from current source and call sites. -->
# Button

## Description

Button performs an action and exposes its disabled, busy, focus and tone states.

`import { Button } from "@/components/ui/button"`; shared primitive, source `components/ui/button.tsx`. Registry status: existing canonical UI primitive.

## Examples

Simplified from `components/account-settings.tsx`:

```tsx
<Button variant="outline" onClick={() => void downloadExport()}>Export data</Button>
```

### Example files

| File | Covers | Caption |
| --- | --- | --- |
| `components/account-settings.tsx` | outline, destructive, pending, error, wrapping footer | Account data actions |
| `components/chat/chat-input.tsx` | icon, disabled, busy stop | Composer |
| `components/chat/message/message-action.tsx` | ghost, icon, copied feedback | Copy |

## Variants

### variant

- `default`: primary action, primary foreground/background.
- `destructive`: irreversible confirmation, destructive foreground/background.
- `outline`: secondary action, border and background.
- `secondary`: selected/secondary action, secondary foreground/background.
- `ghost`: low emphasis action, accent on interaction.
- `link`: inline action with primary text and underline on hover.

### size

`default`, `sm`, `lg` are at least 44px tall and differ in horizontal padding. `icon` is at least 44px square. Default is `default`.

## States

Rest, hover, active press, focus-visible, disabled, aria-invalid are defined in the primitive. Busy behavior is supplied by the caller through `aria-busy`, a spinner and a duplicate-action guard. Disabled blocks pointer interaction and dims the control. Focus uses the ring token. Selected state is supplied by the consuming control.

## Props

Native button props, `variant`, `size`, `asChild` (default false). With `asChild`, the Radix Slot forwards behavior/style to the child. Caller supplies the visible label or `aria-label` for an icon-only action.

## Usage

### When to use

Use for an action in the composer, dialog, settings, or preview controls. Use `type="button"` inside a form unless the action submits it.

### When not to use

Use `Link` for navigation instead. Use TabsTrigger for tab selection instead so arrow-key semantics remain with Radix.

### Rules

`rule/button-icon-name`: When only an icon is visible, provide `aria-label` because the action has no text name. Evidence: composer and message action call sites. Check: review and SSR composer test. Don't: `<Button size="icon"><Copy /></Button>`.

`rule/button-pending-label`: When work is pending, keep the idle action label and add `aria-busy` plus a spinner. Evidence: export/delete in account settings and the requested stable layout. Check: review. Don't: `<Button>{pending ? "Working…" : "Export data"}</Button>`.

### Content

Use short sentence-case verbs describing the result. Caller controls labels; the primitive supplies no invented action name.

### Anti-slop

Not applicable: no fresh-agent comparison was performed; no claim of such evidence.

### Limits

Caller `className` can override geometry. Runtime target/focus measurement across every legacy consumer remains NEEDS REVIEW.

## Accessibility

Native button or slotted native/link element. Enter/Space behavior is native for buttons. Focus-visible ring is defined in source. Disabled and aria-invalid styling come from source. Actual focus-return behavior belongs to dialog callers and needs a browser probe.

## Tokens

`primary`, `primary-foreground`, `destructive`, `destructive-foreground`, `secondary`, `secondary-foreground`, `background`, `accent`, `accent-foreground`, `input`, `ring`, `border`, `--motion-press`, `--ease-out`. Tailwind spacing and radius scale define geometry.

## Related

Dialog owns focus trapping and dismissal. DropdownMenuItem owns menu keyboard behavior. Input owns text entry.

Sources: primitive source above; account-settings, chat-input and message-action real call sites. Conflicts: no new primitive registry/ratchet is introduced in F04; legacy consumer overrides remain outside this entry. Guessed at: labels are intentionally caller-owned. Gates: none; runtime review is recorded separately.
