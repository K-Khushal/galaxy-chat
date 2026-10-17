# F04 independent review

Baseline: e7792318bfa07967c7d8c055b6ba944ea10f3152. Reviewed uncommitted implementation. Root independently passed lint, TypeScript, 29 tests/167 assertions, vendor integrity, diff whitespace check and production build at final handoff.

## Standards

Independent GPT-6.1 Sol reviewer found mobile drawer external opener restoration missing (P2) and pending history mutation spinners missing (P3), against documented focus/button contracts. Fixed; root verified source and relevant browser focus behavior. No additional actionable Fowler heuristic findings.

## Spec

Independent GPT-6.1 Sol reviewer found response completion screen-reader announcement missing (P2) and nested account delete cancellation opener restoration missing (P2). Fixed; root verified source and relevant browser focus behavior. No scope creep; inspected development+flag gate and fixture callbacks maintain preview/auth separation.

## Browser review

Root used supported CUA against credential-free preview. Initial 390px iframe in 1280x720 host clipped the greeting because automatic following ran on empty content. Worker removed empty following/reset scroll top and compacted phone starters; root fresh navigation confirmed greeting visible. Drawer Escape initially focused the frame document, consistent with standards finding.

Observed coherent desktop light empty view, dark account dialog, phone drawer/history and long-message scrolling/latest control. Rename initially focuses Title; Escape returns to exact row actions. Preview labels are explicit and generation unavailable. Local screenshots: /private/tmp/galaxy-f04-mobile.png and /private/tmp/galaxy-f04-desktop-dark.png. No live product/provider proof implied. Transient React dependency-array warning during hot edits cleared on fresh navigation.

## Rams heuristic review

Changed shell/account/sidebar/primitives: initial critical 0, serious 4 focus/announcement/visibility issues above, moderate 1 pending-feedback issue. All five assigned findings were corrected. Root browser confirms mobile drawer Escape returns to Toggle Sidebar and nested account confirmation Escape returns to Delete account with a visible ring after animation. Source confirms persistent polite/atomic completion status and pending spinners. Remaining findings within this reviewed slice: 0 critical, 0 serious, 0 moderate. Heuristic score: 92/100; broader accessibility/device/performance proof remains pending. Limited source/browser checklist; no full WCAG certification, measured contrast, physical-mobile, assistive-technology session or live streaming performance claim.

Local skill: heuristic checks. The full engine runs at
https://www.rams.ai/?utm_source=skill&utm_medium=footer
(291 scored rules, verified re-reviews, one-click fixes on every PR)
