# KOO-01 — design evidence

Captured 8 September 2026 from the Expo **web** preview
(`npx expo start --web`), driven by Playwright. `capture.js` is the exact
script; re-run it with `OUT=<dir> node capture.js` against a running dev server.

The records shown are the repository's fictional demonstration data, seeded
only in a demo build. No real report appears in any of these files.

## What each profile is

| Profile | Viewport | What it shows |
| --- | --- | --- |
| `small` | 360 × 740 | A compact phone |
| `large` | 430 × 932 | A large phone |
| `narrow` | 240 × 740 | Layout under pressure — see the caveat below |

## What this evidence does not cover

**These are not native screenshots.** React Native Web is a different renderer
from React Native: it lays out with CSS, and it does not use the platform's own
text, navigation or safe-area behaviour. What these images prove is that the
palette, the section order, the card hierarchy, the empty states and both
navigation shells are correct, and that the copy on the screen says what it is
supposed to say. What they cannot prove is native layout, native text scaling,
or how either shell behaves under an actual screen reader.

**`narrow` is not "200% text".** React Native Web renders absolute pixel font
sizes and ignores both the OS text-size setting and the browser's root font
size, so enlarged text cannot be simulated by scaling the page — an attempt to
do so produced images pixel-identical to the unscaled ones, which is exactly the
sort of evidence that looks like proof and is not. `narrow` applies the same
pressure from the other direction: the same text in a third less width. It
catches clipping and overflow, and it is not a substitute for turning large text
on for real.

Native verification on a device or emulator, and screen-reader verification,
remain open for KOO-01 and are recorded as such in `PROGRESS.md`. No Android or
iOS toolchain is available in the session that produced these.

## Defects these captures found

Both were invisible to the test suite and obvious on the screen:

- The demonstration badge truncated to "…these records are fictio" on a 360pt
  phone at the parent's larger text size. `Badge` now wraps instead of clipping.
- The parent shell's "My health" tab label came out as "My hea…". The tab bar
  now keeps the caregiver shell's label size, since the taller bar and larger
  tap targets are what that density is for.
