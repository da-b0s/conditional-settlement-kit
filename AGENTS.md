# Agent instructions

Briefing for coding agents in this repository (Claude Code, Cursor, Codex).
Claude Code loads it through `CLAUDE.md`.

## Project overview

This is the **Conditional Settlement Kit**: a scaffold-hbar template for
price-triggered settlement. Escrow a payout, attach it to a price condition,
and let anyone settle it once the condition holds.

The product is not "an oracle wrapper". Chainlink on Hedera hands you seven
feeds that all declare the same 24-hour heartbeat while behaving completely
differently, and every tutorial written against them uses one global
`maxAge`. That is wrong in both directions, and the dangerous direction is
silent. This template stores the staleness bound **per feed, with no global
default**, and proves the need for it from live data on a page that requires
no wallet.

Six invariants in `lib/settlement/invariants.ts` are the actual deliverable.
Everything else exists to uphold or demonstrate one of them.

## Which Solidity package

- `packages/hardhat` exists → Hardhat (`hardhat-deploy`). **This repo.**
- `packages/foundry` does not exist here. Ignore Foundry instructions.
- `packages/nextjs` is the frontend (App Router, Wagmi, Viem, DaisyUI).

## Commands

Yarn is vendored at `.yarn/releases/`. No global install is needed.

```bash
yarn install

# Quality — all four must pass before any commit
yarn lint
yarn next:test        # vitest, 88 tests, hermetic and offline
yarn next:build
yarn hardhat:test     # 61 tests, ~12 seconds

# The live measurement. Needs the network, no credentials.
yarn next:test:live

# Frontend
yarn next:dev         # http://localhost:3000

# Contracts
yarn hardhat:compile
yarn hardhat:deploy --network hederaTestnet

# Evidence topic (the one command that needs an operator)
yarn evidence:topic
```

## Layout

| What | Where | Rule |
| --- | --- | --- |
| Contracts | `packages/hardhat/contracts/` | Four files. Keep it that way. |
| Deploy | `packages/hardhat/deploy/` | Verifies its own wiring. See below. |
| Contract tests | `packages/hardhat/test/` | One file per invariant, named for it. |
| **Core library** | `packages/nextjs/lib/settlement/` | **Framework-free. See below.** |
| Routes | `packages/nextjs/app/` | `/`, `/feeds`, `/evidence`, `/policies`, `/debug`, `/blockexplorer`. |
| The invariants | `packages/nextjs/lib/settlement/invariants.ts` | The contract. Read it first. |

## The rules that matter

### 1. `lib/settlement/` must stay framework-free

Nothing under `lib/settlement/` may import React, Next.js, wagmi, or any
hook. This is what lets the core run from a route handler, a script, a test,
or another framework — and it is what makes this a foundation rather than a
UI.

Consumed in two places, neither of which is a hook:

- **Server Components** (`app/page.tsx`, `app/feeds/page.tsx`,
  `app/evidence/page.tsx`) call it directly. `/` and `/feeds` ship 173 bytes
  of page JavaScript between them; `/evidence` ships 136.
- **Client components** under `app/policies/_components/` use the scaffold
  hooks for wallet work, and import `lib/settlement/feeds.ts` for the feed
  table only.

If you want a `hooks/settlement/` directory, ask first whether the work
belongs in a Server Component. It usually does, and moving it to the client
costs the credential-free first journey.

### 2. The credential split is the architecture

Every module is on one side of this line, and the split is why the template
is worth anything:

| Needs nothing | Needs an operator |
| --- | --- |
| `feedReader.ts` — live feed state over `eth_call` | `hcsPublisher.ts` — writes to a topic |
| `hcs.ts` — reads a topic back | `schedule.ts` — creates a scheduled expiry |
| `feeds.ts`, `invariants.ts`, `evidence.ts` | |

`hcs.ts` and `hcsPublisher.ts` are separate files for exactly this reason. A
Server Component that only displays a trail must not drag the Hiero SDK and a
key requirement into a page that needs neither. **Do not merge them.**

The SDK is imported **dynamically**, inside functions. A static import makes
`@hiero-ledger/sdk` a hard dependency of anything that so much as type-imports
the module.

### 3. Hook names — the trap that will bite you

```ts
// CORRECT — import from ~~/hooks/scaffold-hbar
useScaffoldReadContract
useScaffoldWriteContract
useScaffoldEventHistory
useScaffoldWatchContractEvent
useDeployedContractInfo
useScaffoldContract
useTransactor
```

They are **not** `useScaffoldContractRead` / `useScaffoldContractWrite` — that
is older Scaffold-ETH naming, and most models emit it from memory because the
ETH version dominates their training data. Grep before every commit:

```bash
grep -rn "useScaffoldContractRead\|useScaffoldContractWrite" packages/
```

### 4. Component names — the same trap, one layer down

`@scaffold-hbar-ui/components` exports **`HbarInput`** and
**`HederaAddressInput`**. It does **not** export `EtherInput` or
`AddressInput`; those are Scaffold-ETH names and importing them fails the
build. The full export list is `Address`, `Balance`, `HederaAddress`,
`HederaPortalFaucet`, `hederaPortalFaucetUrl`, `BaseInput`,
`HederaAddressInput`, `HbarInput`.

Two behavioural differences that cost real bugs:

- **`HbarInput` is uncontrolled.** No `value`/`onChange`. It takes
  `defaultValue` and reports through
  `onValueChange({ valueInNative, valueInUsd, displayUsdMode })`. Read
  `valueInNative` — it is always HBAR, so the USD toggle cannot change what
  gets escrowed.
- **`HederaAddressInput` keeps the raw text in `value`.** If a user types
  `0.0.12345`, `value` stays `0.0.12345`. The resolved EVM address arrives via
  `onResolvedEvmChange`. **Pass the resolved one to contract calls.** Binding a
  call to `value` sends a Hedera id where an address belongs.

### 5. The SDK is Hiero, not Hashgraph

```ts
import { ScheduleCreateTransaction } from "@hiero-ledger/sdk";  // correct
import { ScheduleCreateTransaction } from "@hashgraph/sdk";     // WRONG
```

This project uses **`@hiero-ledger/sdk`** (^2.80.0). Hiero is the Linux
Foundation's renamed Hedera SDK and is what scaffold-hbar ships. Most models
emit `@hashgraph/sdk` from memory; installing it adds a second, conflicting
SDK to the tree.

Verified present and callable in 2.80.0: `TopicCreateTransaction`,
`TopicMessageSubmitTransaction`, `ScheduleCreateTransaction`,
`ScheduleSignTransaction`, `ScheduleDeleteTransaction`, `ScheduleInfoQuery`,
`ContractExecuteTransaction`, `Timestamp`, `ScheduleId`, `AccountId`.

`setPayerAccountId` wants an **`AccountId`**, not a string. A string compiles
under a loose signature and fails at runtime, on a path that costs HBAR to
reach.

### 6. Decimals, and the two ways to be off by ten billion

- Chainlink feeds on Hedera report **8 decimals**. Every one of the seven.
  Read `decimals()` anyway; `ChainlinkPriceSource` pins it at registration and
  reverts with `DecimalsChanged` if it ever moves.
- The system composes at **18 decimals**. Widening 8→18 is exact; narrowing is
  lossy and `normaliseTo18` refuses it.
- Thresholds are compared against the **normalised 18dp** price. Parsing a
  threshold at 8dp is off by 10^10.
- Transaction `value` is in **weibar** (18dp) and the network divides by 10^10
  to reach tinybar. Use `parseEther`, never `Number(x) * 1e18` — the float
  route loses precision above about 9 HBAR.

`answer` from `latestRoundData()` is a **signed int256**. Read as unsigned, a
negative price becomes a number near 2^256, which sails through a naive
bounds check.

### 7. Per-feed staleness bounds. This is the point of the project.

Do not add a global `maxAge`. Do not add a default. `registerFeed` reverts on
`maxAge == 0` because the most likely reason a caller omits it is that they
have not thought about it.

Measured on Hedera testnet, 21 September 2026 — and re-measured hours later
the same day:

| | first read | second read |
| --- | --- | --- |
| spread between freshest and stalest | 116× | 228× |
| DAI/USD age | 23.1 hours | 27 minutes |
| feed a 1-hour global bound would wrongly reject | USDC, USDT, DAI | BTC/USD |

Every specific number moved within hours. The structure did not: some feeds
are minutes old, others hours, **all of them in spec**, and no single bound
fits them. `feedReader.integration.test.ts` re-takes this live and asserts the
structure rather than the constants, so the argument cannot quietly stop being
true. Run `yarn next:test:live`.

### 8. Testing rules

- **Never enable `HEDERA_FORKING` for the test suite.** The scaffold ships
  `networks.hardhat.forking` unconditional; it is now gated. With forking on,
  every deploy and call round-trips to Hashio: the suite took **10 minutes**
  that way and takes **12 seconds** without it, and it fetches nothing it
  needs. It also makes the suite fail whenever Hashio rate-limits, which is a
  failure that says nothing about the code.
- Unit tests are hermetic. Anything touching the network is named
  `*.integration.test.ts` and excluded from `yarn next:test`.
- Test against real data before believing a page works. Pointing `/evidence`
  at a real stranger's topic found two bugs that no fixture would have: the
  mirror node returns **200 with an empty list** for a topic that does not
  exist (identical to a real empty topic), and a topic with 1,000 non-evidence
  messages rendered all 1,000.

### 9. Deployment wiring

`deploy/00_deploy_settlement.ts` calls `registry.setSettlement()` and then
**verifies it**. A deployment that stops one call short produces a system
where policies fund cleanly and can never pay. Do not remove that check.

The deploy script carries its own copy of the feed table, because Hardhat
scripts and the Next app do not share a module graph.
`test/I7_deploy_table_parity.t.ts` fails if the two ever drift — a mismatch
means the UI states a bound the chain does not enforce.

### 10. If the CSS looks broken, delete `.next`

Tailwind v4 caches its source scan inside `.next`, and the cache **survives an
ordinary rebuild**. The symptom is that some utilities work and others do not
— `h-5` resolves while `mt-6` and `max-w-5xl` produce nothing — because the
classes from files that existed when the cache was written are present and
everything newer is missing. The CSS bundle loads fine and contains rules,
which is what makes it confusing.

```bash
rm -rf packages/nextjs/.next && yarn next:build
```

### 11. Styling

Use DaisyUI component classes and the `@scaffold-hbar-ui` components. Do not
rebuild them and do not hand-roll raw Tailwind where DaisyUI has a component.
Keep contrast at WCAG AA (4.5:1).

## Non-goals

Do **not**:

- switch package manager (Yarn only — it is what `template.json` declares),
- remove scaffold conventions or the `/debug` page,
- commit a `.env`, or any real key,
- ship a `.mcp.json` (the harness pins its own `@playwright/mcp` via npx),
- add a token, an ERC20 payout path, or multi-asset escrow — HBAR escrow is
  the scope,
- build a wallet, custody, key storage, or account creation,
- make HSS load-bearing. Scheduled expiry is a convenience; `expire()` is
  permissionless and the deadline is enforced on-chain. If a schedule never
  fires the system degrades to "someone must call expire()", never to "the
  escrow is stuck",
- and **never `git push`, create a remote, open a pull request, merge, tag a
  release, or change repository visibility. Publication is a human decision.**

That last item is not a style preference. Local commits, branches and rebases
are always fine — commit constantly. Publication is irreversible and belongs
to the project owner alone. If you believe a task requires pushing, stop and
say so instead.
