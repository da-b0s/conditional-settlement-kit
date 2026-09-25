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

## The problem this template is actually about

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

**The numbers move a lot.** Re-read a few hours after the table above:

| | first read | second read |
| --- | --- | --- |
| spread | 116× | 228× |
| DAI/USD | 23.1 hours | 27 minutes |
| wrongly rejected by a 1-hour bound | USDC, USDT, DAI | BTC/USD |

Every specific number changed within hours. The structural finding did not:
some feeds are minutes old, others are hours old, all of them are in spec, and
no single bound fits them. The live test asserts that **shape** rather than
the constants, so this argument cannot quietly stop being true while the
README still claims it.

The constants in `lib/settlement/feeds.ts` are a defensible starting point
from one sample each, not derived truth. Tune them against your own
observations before trusting them with money. The claim is that the bound must
be per-feed and configurable — not that these particular numbers are right for
you.

---

## The six invariants

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
162 offline tests, plus 9 that need the network

  101  unit       yarn next:test       hermetic, ~5 seconds
   61  contract   yarn hardhat:test    ~12 seconds
    9  live       yarn next:test:live  re-takes the feed measurement
```

---

## Architecture

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

```
draft ──fund──> active ──condition met──> triggered ──settle──> settled ┐
                   │                                                    │ terminal
                   └── deadline ──> expired ──refund──> refunded ────────┘
```

`settled` and `refunded` are both terminal and unreachable from one another.
That is I5, and `_transition()` is the single guard every state change goes
through.

### The credential split

This is the architecture, not an implementation detail.

| Needs nothing at all | Needs an operator |
| --- | --- |
| `feedReader.ts` — live feed state | `hcsPublisher.ts` — writes evidence |
| `hcs.ts` — reads a topic back | `schedule.ts` — schedules an expiry |
| `feeds.ts`, `invariants.ts`, `evidence.ts` | |

Reading and writing live in **separate files** so a Server Component that only
displays an audit trail does not drag the Hiero SDK and a key requirement into
a page that needs neither. The SDK is imported dynamically, inside functions,
for the same reason.

Everything under `lib/settlement/` is framework-free — no React, no Next, no
wagmi. It runs from a route handler, a script, a test, or another framework
entirely.

### Routes

| Route | Wallet? | Client JS | What it does |
| --- | --- | --- | --- |
| `/` | no | 173 B | What this is, and the six invariants rendered from `invariants.ts` |
| `/feeds` | no | 173 B | All seven feeds read live, ages against bounds |
| `/evidence` | no | 136 B | Read any topic's trail back from the mirror node |
| `/policies` | **yes** | 6.3 kB | Create, fund, settle, expire, refund |
| `/debug` | yes | — | Scaffold's contract debugger |
| `/blockexplorer` | — | — | Scaffold's local explorer |

The credential-free routes come first in the nav on purpose. Someone
evaluating this should be able to check its central claim before deciding
whether to trust it with anything.

---

## The evidence trail

Every state change is written to a Hedera consensus topic. Reading one back
takes an HTTP GET and nothing else — no wallet, no key, no permission. That is
the point: the person who most needs to audit a settlement is the
counterparty, who has access to none of your systems.

```bash
yarn evidence:topic     # the one command that needs an operator
```

Topics are created **with a submit key** by default. A topic without one
accepts messages from anyone on the network, which for an audit trail means a
third party can append a plausible-looking `settled` record to your evidence.
You have to pass `--open` to give that up.

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

### What comes back is not trusted

Messages read from a topic are untrusted input. They may be malformed,
truncated, someone else's JSON, or written by an older schema. The reader
**reports** what it could not parse rather than dropping it, and surfaces
sequence gaps, because a hole in an audit trail that nobody is told about is
worse than a visible one.

---

## Scheduled expiry (HSS)

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

---

## Getting started

### Run it with nothing configured

```bash
yarn install
yarn next:dev
```

Open `/feeds`. It works. Open `/evidence` and paste any testnet topic id. That
works too.

### Run the tests

```bash
yarn next:test        # 88, hermetic, no network
yarn hardhat:test     # 61, ~12 seconds
yarn next:test:live   # 9, re-takes the feed measurement
```

### Deploy

```bash
yarn hardhat:account:import           # key is encrypted at rest, never stored raw
yarn hardhat:deploy --network hederaTestnet
```

The deploy script registers each feed **with its own bound**, wires
`registry.setSettlement()`, and then **verifies that wiring** rather than
assuming it. A deployment that stops one call short produces a system where
policies fund cleanly and can never pay.

On a non-Hedera chain it skips feed registration and says why — the Chainlink
proxies do not exist there, and registering them would revert on `decimals()`.

### Publish evidence

```bash
yarn evidence:topic
# → NEXT_PUBLIC_EVIDENCE_TOPIC=0.0.xxxxx
```

The command prints both the mirror-node URL and a
`https://hashscan.io/testnet/topic/0.0.xxxxx` link. Deployed contracts are
browsable the same way, at `https://hashscan.io/testnet/contract/<address>` —
`/blockexplorer` links to each of yours once they are deployed, because the
scaffold's own explorer indexes a local chain and there is not one here.

---

## Things that cost me time, so they need not cost you any

The full list, with symptoms and diagnoses, is in
[`NOTES-failures.md`](NOTES-failures.md). Nine of the eleven do not
reproduce on a local chain, which is the theme. The ones most likely to bite
you:

**The scaffold forks Hedera for every test.** `networks.hardhat.forking` ships
unconditional, so every deploy and call in the suite round-trips to Hashio.
The invariant suite took **10 minutes** that way and takes **12 seconds**
without it — and it fetches nothing it needs, because the feed under test is a
local mock deployed precisely so a bound can be exercised at an age no live
feed would ever show. Forking is now gated behind `HEDERA_FORKING`, the same
flag that loads the plugin.

**Tailwind's source-scan cache survives a rebuild.** If some utility classes
work and others do not — `h-5` resolves, `mt-6` and `max-w-5xl` produce
nothing — the CSS bundle was built before your pages existed. It loads fine
and contains rules, which is what makes it confusing. `rm -rf
packages/nextjs/.next`.

**The mirror node returns 200 for a topic that does not exist.** The messages
endpoint answers `{"messages":[],"links":{"next":null}}` — byte-for-byte what
a real empty topic returns. Taken at face value, an audit page tells you "this
topic exists and has no messages" about a typo, which reads as "the settlement
produced no evidence". The entity endpoint 404s properly, so `readEvidence`
asks it, but only when the list came back empty.

**The component names are not the Scaffold-ETH ones.** It is `HbarInput` and
`HederaAddressInput`, not `EtherInput` and `AddressInput`. `HbarInput` is
uncontrolled. `HederaAddressInput` keeps the raw `0.0.n` text in `value` and
gives you the resolved EVM address through `onResolvedEvmChange` — bind a
contract call to `value` and you send a Hedera id where an address belongs.

**`getPolicy` returns struct fields typed as `any`.** So `maxPayout - escrow`
is a `number`, and past 2^53 weibar — about 0.009 HBAR — it silently loses
precision. Pin them to `bigint`.

**Ten billion, three times.** The worst one first: a transaction's `value`
field is weibar (18dp), but by the time a contract reads `msg.value` it is
**tinybar (8dp)**. So a contract that takes an amount as an argument and
compares it against `msg.value` is comparing two different units. This cost a
reverted testnet transaction — `PayoutExceedsEscrow(1, 1000000000000000000,
100000000)`, where both calls said "one HBAR" — and it **does not reproduce
locally**, because a Hardhat node is an ordinary EVM where the two agree.
Every contract test passed. Use [`lib/settlement/units.ts`](packages/nextjs/lib/settlement/units.ts).
Then: use `parseEther` and never `Number(x) * 1e18` for the tx value. And
thresholds compare against the price normalised to 18dp, not the feed's
native 8dp.

**`PrivateKey.fromStringDer()` accepts a raw ECDSA hex key** and returns a
different key rather than throwing, so a try-DER-then-ECDSA fallback never
falls back. You get `INVALID_SIGNATURE` on an operation that needed no
permission. Decide the format by shape.

**Gas on Hedera is not the EVM estimate.** `trigger()` costs 111,226 gas on a
Hardhat node and ran out at a 500,000 limit on Hedera, because it reaches
through two contracts into an external oracle. Budget multiples.

**`eth_getLogs` is capped at seven days.** `queryFilter` with no range asks
for block 0 to latest and is refused. Start from the deployment block and
walk forward in windows.

**`answer` is a signed int256.** Read as unsigned, a negative price becomes a
number near 2^256 and sails through a naive bounds check.

---

## Deployed, and checkable

Everything in [`EVIDENCE.md`](EVIDENCE.md) happened on Hedera testnet and can
be verified without running this repository:

| | |
| --- | --- |
| `PolicyRegistry` | [`0x0d107277BAA8D031D5CeD8CA6E1b4C0c552A993a`](https://hashscan.io/testnet/contract/0x0d107277BAA8D031D5CeD8CA6E1b4C0c552A993a) |
| `Settlement` | [`0x57eDdaAe98A54D3346e556BB8D681cf91E6E1554`](https://hashscan.io/testnet/contract/0x57eDdaAe98A54D3346e556BB8D681cf91E6E1554) |
| `ChainlinkPriceSource` | [`0x348C2590D0Ea01daEbD4d907B83F5752FfC577DF`](https://hashscan.io/testnet/contract/0x348C2590D0Ea01daEbD4d907B83F5752FfC577DF) |
| Evidence topic | [`0.0.10651678`](https://hashscan.io/testnet/topic/0.0.10651678) |

### Six outcomes, six transactions

The demo is the failures. A happy path shows the code can pay out; it shows
nothing about whether it can be made to pay out when it should not.

| | Outcome | Result |
| --- | --- | --- |
| 1 | a fresh observation settles | paid 1 HBAR |
| 2 | a replay is refused | reverted |
| 3 | a stale reading is refused | `ObservationStale` |
| 4 | an unauthorised caller is refused | `NotSettlement()` |
| 5 | settlement cannot touch an expired policy | `AlreadyExpired` |
| 6 | a payout larger than the escrow is refused | `PayoutExceedsEscrow` |

Every one has a testnet transaction behind it in
[`EVIDENCE.md`](EVIDENCE.md). Reproduce with `yarn lifecycle` and
`yarn failures`.

Policy #1 was created, funded with 1 HBAR, and **settled by an account that
was neither the creator nor the beneficiary** —
[the trigger transaction](https://hashscan.io/testnet/transaction/0x2e00806f0ea3b3ed72f45df64bae1e51b44f5de80c6105f18906fca71adcc968).
A second trigger reverted. All three contracts are verified on Sourcify with
`exact_match`, so the deployed bytecode provably compiles from this source.
Reproduce the whole thing with `yarn lifecycle --network hederaTestnet`.

---

## Licence

MIT. See [LICENSE](LICENSE).
