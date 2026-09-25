# Conditional Settlement Kit

A [scaffold-hbar](https://github.com/hashgraph/scaffold-hbar) template for
**conditional settlement**: money held in escrow, released when a verified
external condition is met, refunded when a deadline passes first, with an
audit trail either way.

That shape is not one product. It is:

- **Freelance milestone release** — pay when the milestone is verified
- **Grant disbursement** against a measured KPI
- **SLA credits** issued automatically when a threshold is breached
- **Marketplace delivery confirmation**
- **Warranty and guarantee claims**
- **Escrow with a timeout**
- **Price protection** — the demo instance, and the one this repo ships

The escrow is on-chain, the condition source is swappable, and every state
change leaves a public record a counterparty can audit without being given
access to anything.

> **This is not an oracle adapter.** Provider adapters are already solved by
> the official `oracles` template, which normalises Chainlink, Supra and Pyth
> behind one interface and reads prices. It stops at the read. **This template
> is what happens after the price is read**: the policy state machine, the
> settlement guarantees, the evidence trail, the expiry logic, and the failure
> behaviour. One provider is implemented properly rather than three
> superficially.

---

## Contents

1. [Create a project from this template](#1-create-a-project-from-this-template)
2. [Disclaimer](#2-disclaimer)
3. [Verify every claim in five minutes](#3-verify-every-claim-in-five-minutes)
4. [The problem this template is actually about](#4-the-problem-this-template-is-actually-about)
5. [The six invariants](#5-the-six-invariants)
6. [The routes, and what to do on each](#6-the-routes-and-what-to-do-on-each)
7. [Architecture](#7-architecture)
8. [Prerequisites](#8-prerequisites)
9. [Quick start](#9-quick-start)
10. [Environment variables](#10-environment-variables)
11. [Networks](#11-networks)
12. [The evidence trail](#12-the-evidence-trail)
13. [Scheduled expiry (HSS)](#13-scheduled-expiry-hss)
14. [Verified testnet transactions](#14-verified-testnet-transactions)
15. [Extending this template](#15-extending-this-template)
16. [Testing](#16-testing)
17. [The traps, and what each one costs you](#17-the-traps-and-what-each-one-costs-you)
18. [Troubleshooting](#18-troubleshooting)
19. [Running the harness gate](#19-running-the-harness-gate)
20. [Evidence index](#20-evidence-index)
21. [Licence and credits](#21-licence-and-credits)

---

## 1. Create a project from this template

```bash
npm create scaffold-hbar@latest -- --template <org>/conditional-settlement-kit
cd conditional-settlement-kit
yarn install
yarn next:dev        # http://localhost:3000
```

Replace `<org>` with the GitHub owner this repository is published under —
`--template` takes an `owner/repo` reference, not a template name.

**The `--` is required.** Without it `npm create` consumes `--template`
itself, runs `create-scaffold-hbar <org> conditional-settlement-kit`, and
scaffolds the default project instead. It fails silently, in the sense that
you get a working project that is not this one.

Already cloned it? `yarn install && yarn next:dev` is the whole setup, and
needs no scaffolding step.

No `.env`, no wallet, no keys. Three of the six routes work completely before
you configure anything — including the one that reads live oracle data and the
one that audits a settlement.

---

## 2. Disclaimer

This is a **template**, not an audited financial product. It has not been
through a security review. The constants in `lib/settlement/feeds.ts` are one
sample each, taken on a single day, and section 4 shows how much they move.

Read [section 17](#17-the-traps-and-what-each-one-costs-you) before you put
anything you care about behind it, and tune the staleness bounds against your
own observations rather than trusting the ones shipped here. The claim this
template makes is that the bound must be **per feed and configurable** — not
that these particular numbers are right for you.

Everything demonstrated runs on **Hedera testnet**. Nothing here has been run
against mainnet.

---

## 3. Verify every claim in five minutes

Nothing in this section needs a wallet, a key, or a `.env`.

**The central claim — that no single staleness bound fits these feeds:**

```bash
yarn install
yarn next:test:live
```

Ten tests read all seven Chainlink proxies from Hedera testnet and print the
table. They assert the *shape* of the finding, not the constants, because the
constants move (section 4).

**That the contracts do what the invariants say:**

```bash
yarn hardhat:test        # 65 tests, one file per invariant, ~12 seconds
yarn next:test           # 132 tests, hermetic, no network, ~5 seconds
```

**That the deployed bytecode is this source.** All three contracts are
verified on Sourcify with `exact_match`:

- [ChainlinkPriceSource](https://repo.sourcify.dev/contracts/full_match/296/0x348C2590D0Ea01daEbD4d907B83F5752FfC577DF/)
- [PolicyRegistry](https://repo.sourcify.dev/contracts/full_match/296/0x0d107277BAA8D031D5CeD8CA6E1b4C0c552A993a/)
- [Settlement](https://repo.sourcify.dev/contracts/full_match/296/0x57eDdaAe98A54D3346e556BB8D681cf91E6E1554/)

**That a settlement really happened, pushed by an unrelated account:**

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10651678/messages?limit=100&order=asc"
```

Or open `/evidence` in the running app, which reads exactly that and checks
each lifecycle against the state machine.

### Two honest caveats about running the gate yourself

**Move `.env` aside first.** The static validator forbids it — correctly,
since a committed key is unrecoverable. On a fresh clone there is no `.env`
and the gate passes; if you have created one locally, the gate fails on it
until you move it.

**`routes=0` is almost never your code.** See
[section 19](#19-running-the-harness-gate). It has at least four distinct
causes and all of them report identically.

---

## 4. The problem this template is actually about

Chainlink on Hedera gives you seven price feeds. Every one of them declares an
86,400-second heartbeat. So every tutorial written against them does this:

```solidity
require(block.timestamp - updatedAt < MAX_AGE, "stale price");
```

One constant, applied to all seven. **That is wrong in both directions, and
the dangerous direction is silent.**

Here is what the feeds were actually doing when read live on 21 September
2026:

| Feed | Age | Declared heartbeat | In spec? |
| --- | --- | --- | --- |
| LINK/USD | 12 minutes | 24 hours | yes |
| HBAR/USD | 13 minutes | 24 hours | yes |
| BTC/USD | 18 minutes | 24 hours | yes |
| ETH/USD | 36 minutes | 24 hours | yes |
| USDT/USD | 16.0 hours | 24 hours | yes |
| USDC/USD | 16.1 hours | 24 hours | yes |
| DAI/USD | 23.1 hours | 24 hours | yes |

A **116-fold spread**, and not one feed out of spec.

- A **tight** global bound of one hour rejects USDC, USDT and DAI. All three
  are healthy. Your settlement just stopped working for reasons the user
  cannot act on.
- A **loose** global bound of 24 hours accepts everything — including an
  HBAR/USD price twenty-three hours old, roughly a hundred updates behind. It
  settles a payout on it and nothing looks wrong. The feed is inside its
  declared heartbeat, the call succeeds, and the money moves on yesterday's
  price.

The second one is the reason this template exists. It is not a crash, it is a
wrong answer delivered confidently.

**So the bound belongs to the feed, not to the system.**
`ChainlinkPriceSource` stores `maxAge` per feed and has no global default at
all — `registerFeed` reverts on `maxAge == 0`, because the most likely reason
a caller omits it is that they have not thought about it.

### Check this yourself, right now

Open **`/feeds`**. It reads all seven proxies over JSON-RPC when the page
renders and shows you the current ages against the bounds this template would
enforce. No wallet, no keys, no configuration — it is a Server Component doing
an HTTP request.

Or run it as a test:

```bash
yarn next:test:live
```

**The numbers move a lot.** Five readings taken across one day:

| Reading | Spread | Feed a 1-hour global bound would wrongly reject |
| --- | --- | --- |
| 1 | 116× | USDC, USDT, DAI |
| 2 | 228× | BTC/USD |
| 3 | 269× | BTC, USDC, USDT, DAI |
| 4 | 1,213× | BTC, USDC, USDT, DAI |
| 5 | 3,810× | BTC, USDC, USDT, DAI |

Every specific number changed within hours. The structural finding did not:
some feeds are minutes old, others are hours old, all of them are in spec, and
no single bound fits them. The live test asserts that **shape** rather than
the constants, so this argument cannot quietly stop being true while the
README still claims it.

**And the argument caught me out.** Reading 4 turned BTC/USD red at 2.0 hours
against the 2-hour bound this template recommended for it — a healthy feed,
refused by my own constant. That is the tight-bound mistake in miniature. The
bound was widened to 6h and the assertion kept: **the constant was wrong, not
the test.** Every live run now checks each feed sits inside its own bound.

The constants in `lib/settlement/feeds.ts` are a defensible starting point
from one sample each, not derived truth. Tune them against your own
observations before trusting them with money.

---

## 5. The six invariants

These are the deliverable. They live in
[`lib/settlement/invariants.ts`](packages/nextjs/lib/settlement/invariants.ts)
as data, are rendered on the home page from that same file, and each names
the test that would catch it breaking. `invariants.test.ts` asserts every one
of those paths resolves to a file that exists, because a broken pointer is a
claim the project cannot back.

| | Guarantee | Proven by | Test |
| --- | --- | --- | --- |
| **I1** | A policy settles at most once. Repeated evidence, repeated clicks or a replayed observation cannot pay twice. | Call settle twice with the same observation; the second reverts. | `I1_settles_once.t.ts` |
| **I2** | A trigger must use an allowed provider and feed, satisfy **that feed's own** freshness bound, and match the policy's units and decimals. | Submit an observation older than that feed's bound; reverts. Submit from an unregistered feed; reverts. | `I2_freshness_and_feed.t.ts` |
| **I3** | Payout never exceeds funded escrow. | Configure a payout larger than escrow; reverts. | `I3_payout_bounded.t.ts` |
| **I4** | Only authorised paths change final state. | Unauthorised caller attempts settle; reverts. | `I4_authorisation.t.ts` |
| **I5** | Expiry and settlement cannot both succeed. Both are terminal and mutually exclusive. | Race expiry-then-settle and settle-then-expiry; exactly one wins each way. | `I5_expiry_race.t.ts` |
| **I6** | Public evidence contains no secrets or personal data — hashes and minimal summaries only. | Adversarial tests against the builder, plus reading a real topic back. | `I6_evidence_shape.test.ts` |

The rule when changing that file: an invariant may be clarified, but it may
not be weakened to match an implementation that failed it. If the code cannot
hold the line, the code is wrong.

```
197 offline tests, plus 10 that need the network

  132  unit       yarn next:test       hermetic, ~5 seconds
   65  contract   yarn hardhat:test    ~12 seconds
   10  live       yarn next:test:live  re-takes the feed measurement
```

---

## 6. The routes, and what to do on each

| Route | Wallet? | Client JS | What it does |
| --- | --- | --- | --- |
| `/` | no | 173 B | What this is, and the six invariants rendered from `invariants.ts` |
| `/feeds` | no | 173 B | All seven feeds read live, ages against bounds |
| `/evidence` | no | 136 B | Read any topic's trail back from the mirror node |
| `/policies` | **yes** | 6.3 kB | Create, fund, settle, expire, refund |
| `/debug` | yes | — | Scaffold's contract debugger, kept deliberately |
| `/blockexplorer` | — | — | Scaffold's local explorer |

The credential-free routes come first in the nav on purpose. Someone
evaluating this should be able to check its central claim before deciding
whether to trust it with anything.

### `/feeds` — the argument, live

Reads all seven proxies with a plain `eth_call` when the page renders, and
computes the spread from what it rendered rather than printing a constant.
Any feed flagged *"a 1h global bound would reject this"* is simultaneously
marked fresh against its own bound — that pairing is the whole case.

Cached for 60 seconds so a visitor does not hammer the public endpoint. The
footer names the RPC URL and the timestamp, so the claim is checkable.

### `/evidence` — audit without permission

A plain GET form. Paste any testnet topic id. It decodes the messages, reports
the ones it could not read as evidence rather than hiding them, surfaces
sequence gaps, and checks each policy's lifecycle against the state machine.

Try `0.0.10651678` for this deployment's trail. Try `0.0.999999999` to see it
distinguish *does not exist* from *exists and is empty* — the mirror node
returns 200 for both, and getting that wrong means telling an auditor a
settlement produced no evidence when they simply mistyped an id.

### `/policies` — the only route that needs a wallet

Create a policy, fund its escrow, settle it, expire it, refund it. Only the
actions the state machine permits are rendered: a settled policy shows no
Settle button, because the state already answers the question.

Connect a burner from the header. On a local chain, **Fund locally** appears
and sends you 100 test HBAR — see [section 9](#9-quick-start).

### `/debug` — kept deliberately

Ships with scaffold-hbar and is not removed. It is the fastest way to call
`registerFeed`, `maxAgeOf` or `getPolicy` directly and confirm the interface
is not inventing anything.

---

## 7. Architecture

### Contracts

Four files. Three of them matter.

```
IPriceSource.sol          the seam
ChainlinkPriceSource.sol  one implementation, done properly
PolicyRegistry.sol        holds the escrow and the state machine
Settlement.sol            decides, and holds nothing
```

**`Settlement` never mentions Chainlink.** It talks to `IPriceSource`, so the
oracle is swappable without touching the contract that moves money. That seam
is what makes this a template rather than an application.

**`Settlement` holds no value.** The registry pays; settlement only decides.
A bug in trigger validation cannot drain an escrow on its own — the worst it
can do is ask the registry for a transition the registry refuses. Two
contracts, two different ways to be wrong, and both have to be wrong at once
for money to move incorrectly.

**Triggering is permissionless.** Anyone can push a settlement, because the
decision rests entirely on what the price source says and not on who is
asking. A beneficiary should never depend on the creator's goodwill to get
paid. I4 is upheld by the registry restricting `settle` to the settlement
contract, not by the settlement contract restricting callers.

### The state machine

```
draft ──fund──> active ──condition met──> triggered ──settle──> settled ┐
  │                │                                                    │ terminal
  │                └── deadline ──> expired ──refund──> refunded ────────┘
  │                                    ▲
  └── deadline ────────────────────────┘
```

`settled` and `refunded` are both terminal and unreachable from one another.
That is I5, and `_transition()` is the single guard every state change goes
through.

`draft → expired` exists so the machine is **total**: a policy created and
never funded still reaches a terminal state rather than sitting forever. No
escrow is involved, because `fund()` reverts rather than leaving a policy
partially funded — a Draft policy holds exactly zero, always.

I3 is enforced at the `fund` boundary rather than at settlement, so a
beneficiary who reads `active` knows the money is actually present.

### The credential split

This is the architecture, not an implementation detail.

| Needs nothing at all | Needs an operator |
| --- | --- |
| `feedReader.ts` — live feed state | `hcsPublisher.ts` — writes evidence |
| `hcs.ts` — reads a topic back | `schedule.ts` — schedules an expiry |
| `feeds.ts`, `invariants.ts`, `evidence.ts`, `units.ts` | |

Reading and writing live in **separate files** so a Server Component that only
displays an audit trail does not drag the Hiero SDK and a key requirement into
a page that needs neither. The SDK is imported dynamically, inside functions,
for the same reason.

Everything under `lib/settlement/` is framework-free — no React, no Next, no
wagmi. It runs from a route handler, a script, a test, or another framework
entirely.

### What was deliberately not built

- **A provider adapter layer.** The official `oracles` template already
  normalises Chainlink, Supra and Pyth. Rebuilding it invites exactly the
  comparison this template does not want.
- **A token, or ERC-20 payouts.** HBAR escrow is the scope.
- **A wallet, custody, or key storage.**
- **HSS as a load-bearing dependency.** See [section 13](#13-scheduled-expiry-hss).

---

## 8. Prerequisites

| | Version | Notes |
| --- | --- | --- |
| Node | ≥ 20.18 | 22 and 24 both work |
| Yarn | 3.2.3 | **Vendored.** Do not install globally — see section 9 |
| Git | any | |
| An HBAR-funded testnet account | | **Only** for deploying or publishing evidence |

You do **not** need Docker, Hedera Local Node (this template does not use it),
a global yarn, or any account at all to run the app and the tests.

---

## 9. Quick start

### If `yarn` is not on your PATH

Do not install it globally. Yarn 3 is committed at `.yarn/releases/` and every
script routes through it:

```bash
node .yarn/releases/yarn-3.2.3.cjs install
node .yarn/releases/yarn-3.2.3.cjs next:dev
```

`corepack enable` needs Administrator on Windows, which is why the binary is
vendored. This matters more than it sounds — it is the single most common
cause of the harness reporting five broken builds that are not broken
([section 19](#19-running-the-harness-gate)).

### The two-command version

```bash
# 1. Install. The committed lockfile is in sync, so this works under CI too.
yarn install

# 2. Run it. No account, no key, no .env needed for this step.
yarn next:dev
```

Open <http://localhost:3000/feeds>. That page is the argument.

### Dev server or production server?

`yarn next:dev` for development. For anything being timed or gated, use the
production server, which serves a real build:

```bash
yarn next:build
yarn next:serve
```

**Note the script names.** In scaffold-hbar, `next:start` runs `next dev` and
`next:serve` runs `next start` — the opposite of what both names suggest.

### Exercise the whole lifecycle offline, with no testnet HBAR

The deploy script registers a **mock feed** on any non-Hedera chain, and a
**Fund locally** button appears in the header on chain 31337. Together that
means the full create → fund → settle path runs on your machine with no
account and no faucet:

```bash
yarn hardhat:chain:local                      # terminal 1 — a local node
yarn hardhat:deploy --network localhost       # terminal 2
yarn next:dev                                 # terminal 3
```

`chain:local` rather than `hardhat:chain`, because the latter sets
`HEDERA_FORKING=true` and fetches state from Hashio — useful when you need
real Hedera state, and the opposite of what you want for an offline demo.
The deploy needs no password on `localhost`; the encrypted-key prompt only
appears for a real network.

Then switch the network to **Hedera Local Fork** in the header, connect a
burner, and click **Fund locally**.

### Deploy to testnet

```bash
yarn hardhat:account:import           # key is encrypted at rest, never stored raw
yarn hardhat:deploy --network hederaTestnet
```

The deploy script registers each feed **with its own bound**, wires
`registry.setSettlement()`, and then **verifies that wiring** rather than
assuming it. A deployment that stops one call short produces a system where
policies fund cleanly and can never pay.

On a non-Hedera chain it skips the real feeds and says why — the Chainlink
proxies do not exist there, and registering them would revert on `decimals()`.

---

## 10. Environment variables

**None of them are required to run the app or the tests.** See
`packages/hardhat/.env.example` and `packages/nextjs/.env.example`.

| Variable | Where | Needed for |
| --- | --- | --- |
| `HEDERA_NETWORK` | hardhat | Which network. `testnet` \| `mainnet` \| `previewnet` |
| `HEDERA_RPC_URL` | hardhat | JSON-RPC endpoint. Defaults to Hashio testnet |
| `DEPLOYER_PRIVATE_KEY_ENCRYPTED` | hardhat | `yarn hardhat:deploy`. Written by `account:import`, encrypted at rest |
| `HEDERA_OPERATOR_ID` | hardhat | `evidence:topic`, `evidence:publish` |
| `HEDERA_OPERATOR_KEY` | hardhat | as above. A **raw** key — use a throwaway testnet account |
| `HEDERA_KEY_TYPE` | hardhat | Only if your raw key is ED25519. Defaults to ECDSA |
| `NEXT_PUBLIC_EVIDENCE_TOPIC` | nextjs | The topic `/evidence` opens on by default |
| `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL` | nextjs | Override the default relay |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | nextjs | Your own WalletConnect id before real users |

`.gitignore` blocks `.env` **before** any file that could hold a key, and the
harness's static gate forbids it as well. Deleting a committed key does not
help: git keeps history, and bots scrape GitHub for Hedera keys within
seconds.

---

## 11. Networks

| Name | Chain ID | `msg.value` decimals | Notes |
| --- | --- | --- | --- |
| `hederaTestnet` | 296 | **8** | Everything here was verified against this |
| `hederaMainnet` | 295 | **8** | Untested. Nothing has been run against it |
| Hedera Local Fork | 31337 | **18** | A Hardhat node. Gets a mock feed on deploy |

That decimals column is not decoration. It is the difference described in
[section 17](#17-the-traps-and-what-each-one-costs-you), and it is why a local
chain cannot tell you whether your Hedera arithmetic is correct.

This template does **not** use Hedera Local Node, which is being retired in
favour of Solo. `yarn chain` runs an ordinary Hardhat node; the optional
`@hashgraph/system-contracts-forking` plugin forks *state* from testnet over
JSON-RPC rather than running a local Hedera network.

---

## 12. The evidence trail

Every state change is written to a Hedera consensus topic. Reading one back
takes an HTTP GET and nothing else — no wallet, no key, no permission. That is
the point: the person who most needs to audit a settlement is the
counterparty, who has access to none of your systems.

```bash
yarn evidence:topic                                      # create one
EVIDENCE_TOPIC=0.0.x yarn evidence:publish --network hederaTestnet
```

Topics are created **with a submit key** by default. A topic without one
accepts messages from anyone on the network, which for an audit trail means a
third party can append a plausible-looking `settled` record to your evidence.
You have to pass `--open` to give that up.

`evidence:publish` derives records from `PolicyRegistry` events rather than
hooking into the settlement path, and that is deliberate: publishing costs
HBAR and needs a key, so wiring it into settlement would mean either the app
holds a key or settlement fails when the operator is unfunded. **The trail
describes what happened; it must never be able to prevent it.**

It reads the topic back before writing and skips every `(kind, policyId)`
already present, so running it twice publishes nothing the second time. **One
topic per deployment** — that key carries no contract address, so a second
registry pointed at the same topic would see its policy #1 as already
published.

### What reaches a public topic, and what never does

`evidence.ts` inverts the usual rule. Rather than deciding what to exclude, it
decides what may be **included**, and refuses everything else. `buildEvidence`
constructs the record field by field rather than spreading an input object,
because a spread is how a beneficiary address ends up on a public ledger
without anyone choosing to put it there. Then `assertPublishable` scans the
**serialised** form — what actually gets submitted — against a list of
forbidden keys and a set of patterns for EVM addresses, Hedera account ids,
private keys and email addresses.

An HCS topic is permanent. A field published carelessly cannot be withdrawn;
the best anyone can do afterwards is append a correction beneath it.

A real record, exactly as it sits on the ledger:

```json
{"v":1,"kind":"settled","policyId":1,"at":1790012422,
 "assetHash":"0x2c03d7a8…cfa908","price":"91340000000000000"}
```

No address. No account id. No name, memo, or free-text field of any kind. The
asset is a keccak hash rather than the string `HBAR/USD`, because a pair name
today is a customer reference once somebody generalises the field.

### What comes back is not trusted

Messages read from a topic are untrusted input. They may be malformed,
truncated, someone else's JSON, or written by an older schema. The reader
**reports** what it could not parse rather than dropping it, and surfaces
sequence gaps, because a hole in an audit trail that nobody is told about is
worse than a visible one.

---

## 13. Scheduled expiry (HSS)

A policy past its deadline can be expired by anyone, and `expire()` checks the
deadline itself. HSS lets the **network** push that call so nobody has to be
watching.

**It is a convenience, never the guarantee.** If a schedule fails — the payer
runs dry, the schedule is deleted, the node throttles — the system degrades to
"someone must call `expire()`", never to "the escrow is stuck". I5's tests
never touch HSS. Making a scheduling service load-bearing would turn a
convenience into a custody risk.

Whether Hedera even accepts a scheduled contract call was worth checking
rather than assuming: `ContractCall` is in the `SchedulableTransactionBody`
protobuf, but `scheduling.whitelist` is a node property that excluded contract
calls for years. Decoding what the network has actually accepted, from the
mirror node:

- **mainnet**, 3,000 most recent schedules: 2,525 `cryptoTransfer`, 315
  `tokenBurn`, **88 `contractCall`**, 45 `tokenMint`, and a tail. Most recent
  contract-call schedule: 15 September 2026.
- **testnet**, 2,500 oldest schedules (February 2024): 2,315 `cryptoTransfer`,
  139 `consensusSubmitMessage`, 24 `tokenMint`, 22 `tokenBurn` — and **not one
  `contractCall`**.

So it works now and did not then. If a `ScheduleCreate` ever comes back
`NOT_IN_WHITELIST`, the message says so and leads with the thing the user
actually needs to know: the escrow is fine, call `expire()` directly.

HIP-423 caps a schedule at 62 days, and `scheduleExpiry` refuses a longer
window *before* loading the SDK rather than after — three seconds of module
loading is not worth spending to reject a malformed address.

---

## 14. Verified testnet transactions

Everything in [`EVIDENCE.md`](EVIDENCE.md) happened on Hedera testnet and can
be verified without running this repository.

### Contracts

| | Address | |
| --- | --- | --- |
| `PolicyRegistry` | `0x0d107277BAA8D031D5CeD8CA6E1b4C0c552A993a` | [HashScan](https://hashscan.io/testnet/contract/0x0d107277BAA8D031D5CeD8CA6E1b4C0c552A993a) · [Sourcify](https://repo.sourcify.dev/contracts/full_match/296/0x0d107277BAA8D031D5CeD8CA6E1b4C0c552A993a/) |
| `Settlement` | `0x57eDdaAe98A54D3346e556BB8D681cf91E6E1554` | [HashScan](https://hashscan.io/testnet/contract/0x57eDdaAe98A54D3346e556BB8D681cf91E6E1554) · [Sourcify](https://repo.sourcify.dev/contracts/full_match/296/0x57eDdaAe98A54D3346e556BB8D681cf91E6E1554/) |
| `ChainlinkPriceSource` | `0x348C2590D0Ea01daEbD4d907B83F5752FfC577DF` | [HashScan](https://hashscan.io/testnet/contract/0x348C2590D0Ea01daEbD4d907B83F5752FfC577DF) · [Sourcify](https://repo.sourcify.dev/contracts/full_match/296/0x348C2590D0Ea01daEbD4d907B83F5752FfC577DF/) |
| Evidence topic | `0.0.10651678` | [HashScan](https://hashscan.io/testnet/topic/0.0.10651678) |

All three are **`exact_match`**, so the deployed bytecode provably compiles
from this source. You do not have to take the addresses on trust.

Note that `yarn hardhat:verify:testnet` does **not** work: the bundled
hardhat-verify 2.x calls Sourcify's retired V1 API and fails with a JSON parse
error that reads like an explorer outage. Use `yarn hardhat:verify:sourcify`.

### Six outcomes, six transactions

The demo is the failures. A happy path shows the code can pay out; it shows
nothing about whether it can be made to pay out when it should not, which is
the only question that matters for something holding escrow.

| | Outcome | Contract's own answer |
| --- | --- | --- |
| 1 | a fresh observation settles | paid 1 HBAR |
| 2 | a replay is refused | reverted |
| 3 | a stale reading is refused | `ObservationStale(asset, 1790014007, 1790015384, 1)` |
| 4 | an unauthorised caller is refused | `NotSettlement()` |
| 5 | settlement cannot touch an expired policy | `AlreadyExpired(9, …)` |
| 6 | a payout larger than the escrow is refused | `PayoutExceedsEscrow(10, 1e8, 1e7)` |

Policy #1 was created, funded with 1 HBAR, and **settled by an account that
was neither the creator nor the beneficiary** —
[the trigger transaction](https://hashscan.io/testnet/transaction/0x2e00806f0ea3b3ed72f45df64bae1e51b44f5de80c6105f18906fca71adcc968).
A second trigger reverted.

Outcome 3 is the template's argument on-chain. A live feed cannot be forced
stale, so the **same proxy** is registered under a second asset key with a
one-second bound. Same contract, same price, same moment — one asset settles
and the other reverts, because the bound belongs to the feed.

Reproduce all of it:

```bash
yarn lifecycle --network hederaTestnet   # the settlement, with HashScan links
yarn failures  --network hederaTestnet   # the four refusals
```

---

## 15. Extending this template

### Swap the oracle — the extension point this is built around

`Settlement` reaches prices only through `IPriceSource`:

```solidity
interface IPriceSource {
    struct Observation { uint256 value; uint64 observedAt; bytes32 feedId; }
    function supportsAsset(bytes32 asset) external view returns (bool);
    function maxAgeOf(bytes32 asset) external view returns (uint64);
    function latest(bytes32 asset) external view returns (Observation memory);
}
```

To use Supra, Pyth, or an off-chain attestation instead:

1. Implement those three functions. **Revert** on stale, negative, or
   carried-over readings rather than returning a flag beside a usable-looking
   number — a caller who ignores the flag is the failure mode this guards.
2. Normalise to 18 decimals. Widening is exact; `normaliseTo18` refuses to
   narrow, because narrowing loses money silently.
3. Call `settlement.setPriceSource(asset, yourSource)`. It checks the source
   actually supports the asset at registration rather than discovering it at
   settlement time, when a beneficiary is waiting.

No change to `Settlement` or `PolicyRegistry`. The contract that moves money
never learns which oracle you chose.

### Condition types beyond price

The condition today is `price >= threshold` or `price <= threshold`,
evaluated in `Settlement.trigger()`. Anything expressible as *"a number
crossed a line, from a source with a freshness bound"* fits without touching
the registry — a KPI, a sensor reading, a delivery-confirmation count.

### Change what gets published

Add a field to `EvidenceRecord` in `evidence.ts`, then add it explicitly to
the object `buildEvidence` constructs. Do **not** spread the input. If the
field could ever hold an address or an identifier, add it to `FORBIDDEN_KEYS`
and let the guard refuse it.

### Add a feed

`source.registerFeed(keccak256("PAIR/USD"), proxy, maxAge)`, then
`settlement.setPriceSource(...)`. Add the same row to **both** the table in
`lib/settlement/feeds.ts` and the one in `deploy/00_deploy_settlement.ts` —
`I7_deploy_table_parity.t.ts` fails if they disagree, because a mismatch means
the interface states a bound the chain does not enforce.

---

## 16. Testing

```bash
yarn next:test        # 132 unit tests, hermetic, offline, ~5s
yarn hardhat:test     # 65 contract tests, ~12s
yarn next:test:live   # 10 tests against live feeds, needs network
yarn lint
yarn next:build       # also type-checks
```

**One contract test file per invariant**, named after it, so a reader maps
guarantee → proof in seconds.

**Unit tests are hermetic.** Anything touching the network is named
`*.integration.test.ts` and excluded from the default run, so `yarn next:test`
never goes red because testnet was slow. A suite that fails for reasons
unrelated to the code teaches developers to ignore red.

**Never enable `HEDERA_FORKING` for the suite.** See section 17.

Tests worth reading, because they encode reasoning rather than coverage:

- `units.test.ts` — the ten-billion gap, and why a local chain cannot catch it
- `hcsPublisher.test.ts` — asserts the SDK quirk directly, so the fix cannot
  be tidied back into a broken try/catch
- `feedReader.integration.test.ts` — re-takes the central measurement and
  asserts the shape rather than the constants
- `I7_deploy_table_parity.t.ts` — the deploy table against the UI table
- `I3_payout_bounded.t.ts` — contains the test that failed and thereby proved
  a bug I believed existed did not

---

## 17. The traps, and what each one costs you

The full list, with symptoms and diagnoses, is in
[`NOTES-failures.md`](NOTES-failures.md). Nine of the twelve **do not
reproduce on a local chain**, which is the theme. The ones most likely to bite
you:

**Ten billion, and it passes every test.** A transaction's `value` field is
weibar (18dp), but by the time a contract reads `msg.value` it is **tinybar
(8dp)**. So a contract taking an amount as an argument and comparing it
against `msg.value` is comparing two different units. This cost a reverted
testnet transaction — `PayoutExceedsEscrow(1, 1000000000000000000, 100000000)`,
where both calls said "one HBAR". A Hardhat node is an ordinary EVM where the
two agree, so all 65 contract tests passed and always would have. Use
[`lib/settlement/units.ts`](packages/nextjs/lib/settlement/units.ts).

**`PrivateKey.fromStringDer()` accepts a raw ECDSA hex key** and returns a
*different* key rather than throwing, so a try-DER-then-ECDSA fallback never
falls back. You get `INVALID_SIGNATURE` on an operation that needed no
permission at all. Decide the format by shape.

**Gas on Hedera is not the EVM estimate.** `trigger()` costs 111,226 gas on a
Hardhat node and ran out at a 500,000 limit on Hedera, because it reaches
through two contracts into an external oracle. Budget multiples, not margins.
`gasUsed ≈ gasLimit` is the signature of out-of-gas rather than a logic
revert, and both surface as a bare `CONTRACT_REVERT_EXECUTED`.

**The scaffold forks Hedera for every test.** `networks.hardhat.forking` ships
unconditional, so every deploy and call round-trips to Hashio. The suite took
**10 minutes** that way and takes **12 seconds** without it, while fetching
nothing it needs. Now gated behind `HEDERA_FORKING`.

**The mirror node returns 200 for a topic that does not exist**, with a body
byte-for-byte identical to a real empty topic. Taken at face value, an audit
page tells you "this topic exists and has no messages" about a typo.

**`eth_getLogs` is capped at seven days.** `queryFilter` with no range asks
for block 0 to latest and is refused. Start from the deployment block and walk
forward in windows.

**Tailwind's source-scan cache survives a rebuild.** If `h-5` resolves while
`mt-6` and `max-w-5xl` produce nothing, the CSS was built before your pages
existed. `rm -rf packages/nextjs/.next`.

**The component names are not the Scaffold-ETH ones.** It is `HbarInput` and
`HederaAddressInput`. `HbarInput` is uncontrolled. `HederaAddressInput` keeps
the raw `0.0.n` text in `value` and gives you the resolved EVM address through
`onResolvedEvmChange` — bind a contract call to `value` and you send a Hedera
id where an address belongs.

**`getPolicy` returns struct fields typed as `any`**, so `maxPayout - escrow`
is a `number` and loses precision past 2^53 weibar. Pin them to `bigint`.

**`answer` is a signed int256.** Read as unsigned, a negative price becomes a
number near 2^256 and sails through a naive bounds check.

**Hollow accounts need more than the arithmetic says.** Sending HBAR to an
unknown EVM address auto-creates an account with no key until its first
transaction completes it. Fund throwaways generously.

---

## 18. Troubleshooting

**The app builds but every page is unstyled.**
Tailwind's cache. `rm -rf packages/nextjs/.next && yarn next:build`.

**`yarn: command not found`.**
Use the vendored binary: `node .yarn/releases/yarn-3.2.3.cjs <script>`.

**`/policies` says "No PolicyRegistry deployed on the selected network".**
Correct, and it names the network it looked at. Either switch networks in the
header or run `yarn hardhat:deploy --network hederaTestnet`.

**A policy will not activate, and `PayoutExceedsEscrow` names two numbers that
look like the same amount.**
They differ by 10^10. Section 17, first entry.

**`trigger()` reverts with `CONTRACT_REVERT_EXECUTED` and no reason.**
Check `gasUsed` against your limit first — if they are close, it ran out of
gas. Otherwise `staticCall` the same function to get the decoded custom error.

**`ObservationStale` on a feed that looks fine.**
It is fine, against the *declared* heartbeat. The bound enforced is per feed
and tighter. `maxAgeOf(asset)` tells you which one applies.

**The contract suite takes ten minutes.**
`HEDERA_FORKING` is set. Unset it.

**`INSUFFICIENT_PAYER_BALANCE`.**
Fund the operator at <https://portal.hedera.com/faucet>.

**A feed stops answering, or the ages look wrong.**
`yarn next:test:live` reports which feeds could not be read and why, rather
than failing the whole run on one bad proxy.

---

## 19. Running the harness gate

```bash
npx hedera-harness validate
```

Last full run: **`passed=true`, `findings=0`, `playwrightGate=true`,
`routes=8`.**

### What it actually checks

| Tier | File | Checks |
| --- | --- | --- |
| Static | `.harness/validators/static.json` | Required files present, forbidden files absent, no secrets |
| Commands | `.harness/validators/yarn.json` | install, lint, unit tests, contract tests, build |
| Routes | `.harness/validators/playwright-smoke.yaml` | All 8 routes load, render, log no console errors, show no forbidden text |

The acceptance contract in `.harness/acceptance-contract.json` carries 14
assertions. Thirteen are verifiable with **no credentials**; exactly one
spends testnet HBAR.

### Three things that will waste your afternoon

**Move `.env` aside first.** The static gate forbids it. This is correct, and
the fix is not to delete the rule.

**A bare `yarn` in the command validator fails on any machine without a global
install.** The harness resolves the package manager for `baseline.commands`
but hands **validator** commands straight to a shell. The symptom is five
commands failing in ~50ms each, which reads like a broken project rather than
a missing binary. Every command here calls
`node .yarn/releases/yarn-3.2.3.cjs` explicitly.

**`routes=0` has at least four causes and they all look identical**: the bare
yarn above, the Windows detached-console problem (hence the leading `echo` in
the server command), a dev server too slow to announce itself (hence
`next:serve` rather than `next dev`), and an unrunnable browser. The CLI does
not print which. Get the real error from the API:

```js
import { runPlaywrightGate } from "hedera-harness/dist/validation/playwrightGate.js";
const r = await runPlaywrightGate(process.cwd(), ".harness/validators/playwright-smoke.yaml");
console.log(JSON.stringify(r, null, 1));
```

On one machine that produced `browserType.launch: spawn UNKNOWN` — Playwright's
bundled Chromium present but not executable. The harness falls back to system
Chrome only when that download is *missing*, testing with `fs.access`, which
checks existence rather than executability. Moving the download aside makes
the fallback fire.

### Tier 3.5 — read before enabling

`chainValidation` is present but commented out in `.harness/spec.yaml`. It is
**not reachable** with `hedera-harness validate`: only `validate-semantic`
provisions a chain signer, and that path also runs the agent, which is billed.
Setting the two environment variables alone changes nothing, silently — the
run reports `passed=true` with the operator balance untouched.

---

## 20. Evidence index

| What | Where |
| --- | --- |
| Deployed addresses, transactions, topic contents | [`EVIDENCE.md`](EVIDENCE.md) |
| Twelve failures, with symptoms and diagnoses | [`NOTES-failures.md`](NOTES-failures.md) |
| The six invariants, as data | [`lib/settlement/invariants.ts`](packages/nextjs/lib/settlement/invariants.ts) |
| The feed table and the measurement behind it | [`lib/settlement/feeds.ts`](packages/nextjs/lib/settlement/feeds.ts) |
| The units gap | [`lib/settlement/units.ts`](packages/nextjs/lib/settlement/units.ts) |
| Rules for coding agents | [`AGENTS.md`](AGENTS.md) |
| Harness recipe and acceptance contract | [`.harness/`](.harness/) |

---

## 21. Licence and credits

MIT. See [LICENSE](LICENSE).

Built on [scaffold-hbar](https://github.com/hashgraph/scaffold-hbar). Price
data from [Chainlink](https://docs.chain.link/data-feeds/price-feeds/addresses)
on Hedera testnet. Contract verification by [Sourcify](https://sourcify.dev).

The feed measurements, the schedule statistics, and every transaction linked
in this README were read from live endpoints rather than taken from
documentation. Where a number here disagrees with a documentation page, the
number is what the network actually returned.
