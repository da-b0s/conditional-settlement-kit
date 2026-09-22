# Conditional Settlement Kit — core

## What this is

A scaffold-hbar template for price-triggered settlement. A creator escrows
HBAR against a condition on a price feed; once the condition holds, anyone can
push the settlement and the beneficiary is paid. If the deadline passes first,
anyone can expire it and the creator takes the escrow back.

## The problem worth solving

Chainlink on Hedera exposes seven price feeds. All seven declare an
86,400-second heartbeat, so the obvious implementation is one global
`maxAge` constant, and that is what every tutorial written against them does.

It is wrong in both directions:

- **Tight** (one hour) rejects the stablecoin feeds, which routinely sit past
  sixteen hours while behaving exactly as designed.
- **Loose** (twenty-four hours) accepts an HBAR/USD price a day old — around a
  hundred updates behind — and settles a payout on it. Nothing looks wrong:
  the feed is in spec, the call succeeds, the money moves.

The second is the dangerous one, because it is a confident wrong answer rather
than a failure. So the bound must be stored **per feed**, and there must be no
global default to fall back into.

This is not a theoretical concern and the numbers are not stable. Measured on
21 September 2026 the spread between the freshest and stalest feed was 116×;
re-read hours later it was 228×, DAI/USD had moved from 23.1 hours to 27
minutes, and the feed that a one-hour bound would wrongly reject had changed
from three stablecoins to BTC/USD. **Assert the structure, never the
constants.**

## Non-negotiables

1. **`lib/settlement/` is framework-free.** No React, no Next, no wagmi, no
   hooks. It runs from a route handler, a script, a test, or another framework.

2. **The credential split is the architecture.** Reading — live feed state,
   and a topic's contents — needs nothing. Writing needs an operator. These
   live in separate modules (`hcs.ts` vs `hcsPublisher.ts`) so a Server
   Component that displays an audit trail does not pull in the Hiero SDK and a
   key requirement. The SDK is imported dynamically, inside functions.

3. **Three routes must work with no credentials at all**: `/`, `/feeds`,
   `/evidence`. Someone evaluating this must be able to check its central
   claim before deciding whether to trust it with anything.

4. **The oracle is behind a seam.** `Settlement` never names Chainlink; it
   talks to `IPriceSource`. This is what makes the repository a template
   rather than an application.

5. **`Settlement` holds no value.** It decides; the registry pays. Both have
   to be wrong at once for money to move incorrectly.

6. **Triggering is permissionless.** The decision rests on what the price
   source says, not on who asks. A beneficiary must never depend on the
   creator's goodwill to get paid.

7. **HSS is never load-bearing.** `expire()` checks the deadline itself and is
   permissionless. A schedule that fails degrades the system to "someone must
   call expire()", never to "the escrow is stuck".

## The six invariants

These are the deliverable. They live in `lib/settlement/invariants.ts` as
data, are rendered on the home page from that file, and each names the test
that would catch it breaking.

| | Guarantee |
| --- | --- |
| I1 | A policy settles at most once. |
| I2 | A trigger must use an allowed feed, satisfy **that feed's own** freshness bound, and match the policy's units and decimals. |
| I3 | Payout never exceeds funded escrow. |
| I4 | Only authorised paths change final state. |
| I5 | Expiry and settlement cannot both succeed; both are terminal. |
| I6 | Public evidence contains no secrets or personal data. |

An invariant may be clarified. It may **not** be weakened to match an
implementation that failed it.

## State machine

```
draft ──fund──> active ──condition met──> triggered ──settle──> settled ┐
                   │                                                    │ terminal
                   └── deadline ──> expired ──refund──> refunded ────────┘
```

Every transition routes through a single guarded `_transition()`. `settled`
and `refunded` are terminal and unreachable from one another — that is I5.

I3 is enforced at the `fund` boundary rather than at settlement: a policy
cannot become `active` while it promises more than it holds, so a beneficiary
who reads `active` knows the money is actually present.

## Deliverables

**Contracts** (`packages/hardhat/contracts/`)

- `IPriceSource.sol` — the seam. `supportsAsset`, `maxAgeOf`, `latest`.
- `ChainlinkPriceSource.sol` — per-feed `maxAge`, no global default,
  `registerFeed` reverts on zero. Pins `decimals()` at registration and
  reverts if it later changes. Reverts on stale, negative, and carried-over
  readings rather than returning a flag beside a usable-looking number.
- `PolicyRegistry.sol` — escrow and state machine.
- `Settlement.sol` — validates and asks the registry to pay. Holds nothing.

**Core** (`packages/nextjs/lib/settlement/`)

- `invariants.ts` — the six, plus the transition table.
- `feeds.ts` — the feed table, bounds, and the measurement behind them.
- `feedReader.ts` — live feed state over raw `eth_call`. No library.
- `evidence.ts` — build and refuse. Constructs field by field; validates the
  serialised form.
- `hcs.ts` / `hcsPublisher.ts` — read (free) and write (operator).
- `schedule.ts` — HSS expiry, with every guard running before the SDK loads.

**Routes** — `/`, `/feeds`, `/evidence`, `/policies`, plus the scaffold's
`/debug` and `/blockexplorer`.

**Tests** — one contract file per invariant, named for it. Unit tests
hermetic and offline; anything touching the network named
`*.integration.test.ts` and excluded from the default run.

## Definition of done

- `yarn lint`, `yarn next:test`, `yarn hardhat:test` and `yarn next:build` all
  pass.
- `/`, `/feeds` and `/evidence` render correctly with no `.env` present.
- `/feeds` shows live ages for at least five of seven feeds and computes the
  spread from what it rendered.
- `/evidence` distinguishes a topic that does not exist from one that is
  empty, and reports unreadable messages rather than dropping them.
- The deploy script verifies its own wiring.
- Every `testFile` named in `invariants.ts` resolves to a file that exists.
