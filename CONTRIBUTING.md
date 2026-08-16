# Contributing to Folio

## You keep your copyright

Folio uses a **Developer Certificate of Origin**, not a copyright-assigning CLA.
Sign your commits:

```sh
git commit -s -m "your change"
```

That is the whole ceremony. You keep the copyright in your contribution, and
Folio is collectively owned by everyone who has contributed to it.

**This is deliberate and it is a promise you can verify rather than one you have
to trust.** Because no single party holds the copyright, no single party can
relicense the project — the manoeuvre that produced the Redis and Terraform forks
is structurally unavailable here. If we ever wanted to rug-pull you, we could
not.

## The open-core line, stated plainly

The engine, the `.folio` format, the validator, and the conformance suite are MIT
and always will be. The hosted gallery and creator studio are the commercial
product.

**The ability to make, export, and play a `.folio` is never behind the paid
product.** If that line ever moves, this file will be part of the diff, and you
will be able to point at it.

## What we look for

- **Tests that could fail.** A validator that only ever says VALID is decoration.
  When you add a check, add the case that proves it bites.
- **Derived numbers, not guessed ones.** Several bugs in this codebase were
  hard-coded constants that disagreed with the thing they described. If a value
  can be computed from the layout, the font, or the corpus, compute it.
- **Honesty about what was verified.** Never let a badge, a log line, or a comment
  claim more than the code actually checked.

## Changing the format

The `.folio` format is a public contract. Format changes need a conformance
fixture proving the new behaviour and demonstrating that old games still load.
Old-version playability is a hard guarantee, not an aspiration.

## Running things

```sh
npm test              # both backends, the container, the validator, parity
npm run build         # the self-contained browser player
npm run test:browser  # drives the player in a real browser
```

## Code of conduct

Be decent. Assume good faith, including when you are correcting someone and
especially when someone is correcting you. Harassment gets you removed.

Report problems to hello@mochilabs.xyz.
