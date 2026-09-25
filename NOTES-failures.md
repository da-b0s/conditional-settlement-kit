# Failures

Every one of these cost real time while building this template. They are
written down because the fix is rarely the interesting part — the interesting
part is what the symptom looked like, which is almost never what the cause
was.

Nine of the eleven do not reproduce on a local chain. That is the theme.

---

## 1. `msg.value` is tinybar. Transaction `value` is weibar. They differ by 10^10.

**Symptom.** A policy funded with exactly its payout refused to activate:

```
PayoutExceedsEscrow(1, 1000000000000000000, 100000000)
```

**What was actually happening.** One HBAR is `1e18` in a transaction's `value`
field and `1e8` by the time a contract reads `msg.value`. The relay accepts
weibar for Ethereum tooling compatibility and divides by 10^10 before the
transaction reaches the network. So `createPolicy(maxPayout)` was given an
18-decimal number while `fund()`'s `msg.value` arrived with 8. Both calls
said "one HBAR".

**Why it survived the test suite.** A Hardhat node is an ordinary EVM where
`value` and `msg.value` are both wei. All 65 contract tests passed, and
always would have. The failure exists only on real Hedera.

**Fix.** `lib/settlement/units.ts` owns both conversions and returns them as
a pair, because a call site that derives only one of them is a call site that
got it wrong. It also refuses to truncate below what the chain can express —
rounding `0.000000001` to zero is how a payout silently becomes nothing.

**The lesson.** A local EVM cannot tell you whether your Hedera arithmetic is
right. Some things only a testnet transaction can prove.

---

## 2. `PrivateKey.fromStringDer()` accepts a raw ECDSA hex key and returns the wrong one

**Symptom.** Creating a consensus topic failed with `INVALID_SIGNATURE`,
which the error translator rendered as *"the operator key does not hold this
topic's submit key"* — about a topic that did not exist yet.

**Cause.** `fromStringDer()` does not reject a 64-character raw hex key. It
logs a warning suggesting `fromStringECDSA` and then returns a key anyway —
a **different** key. So this, which looks careful, is not:

```ts
try { key = PrivateKey.fromStringDer(raw); }
catch { key = PrivateKey.fromStringECDSA(raw); }   // never reached
```

The first call always succeeds, signs with the wrong key, and the network
refuses the signature.

**Fix.** Decide the format by **shape** before asking the SDK: 64 hex
characters is a raw key, longer is DER. `hcsPublisher.test.ts` asserts the
SDK quirk directly, so nobody can tidy the fix back into a try/catch without
a test going red.

**The lesson.** A fallback chain is only as good as the first call's
willingness to fail.

---

## 3. The error message pointed at the wrong thing

Worth separating from #2. The message said "the operator key does not hold
this topic's submit key" — a permissions problem — for an operation that
needs no permissions at all. Anyone can create a topic. The real cause was
key parsing, and the message sent me looking at submit keys for a while.

`INVALID_SIGNATURE` now says all three possibilities and leads with the
likely one.

**The lesson.** An error message that names one cause confidently is worse
than one that names three honestly.

---

## 4. `trigger()` costs 111,226 gas locally and ran out at 500,000 on Hedera

**Symptom.** `status: 0`, `gasUsed: 488758` against a 500,000 limit.

**Cause.** `trigger()` reaches through `Settlement` into
`ChainlinkPriceSource` and then into the real aggregator contract.
Cross-contract calls on Hedera are charged far more heavily than the EVM
estimate suggests. It needed 3,000,000.

**The lesson.** Budget multiples, not margins. And `gasUsed ≈ gasLimit` is
the signature of out-of-gas rather than a logic revert — worth recognising,
because both surface as a bare `CONTRACT_REVERT_EXECUTED`.

---

## 5. `eth_getLogs` is capped at a seven-day window

**Symptom.**

```
The provided fromBlock and toBlock contain timestamps that exceed the
maximum allowed duration of 7 days
```

**Cause.** `queryFilter(filter)` with no range asks for block 0 to latest.

**Fix.** Start from the contract's deployment block — there cannot be events
before it — and walk forward in 250,000-block windows. Hedera blocks are
roughly two seconds apart, so seven days is about 302,000 of them.

---

## 6. The mirror node returns 200 for a topic that does not exist

**Symptom.** `/evidence` cheerfully reported "this topic exists and has no
messages" for a topic id that had never been created.

**Cause.** The messages endpoint answers `200` with
`{"messages":[],"links":{"next":null}}` for a nonexistent topic — byte for
byte what a real empty topic returns.

**Why it matters more than it looks.** For an audit tool that is a confident
wrong answer. A typo in a topic id reads as "the settlement produced no
evidence".

**Fix.** The entity endpoint `/api/v1/topics/{id}` does 404 properly, so ask
it — but only when the message list came back empty, so the normal path stays
one request per page.

---

## 7. Hollow accounts need more funding than the arithmetic says

**Symptom.** "Insufficient funds for transfer" from an account holding 3 HBAR,
for a call costing 1.71 HBAR in gas.

**Cause.** Sending HBAR to an unknown EVM address auto-creates a *hollow*
account — one with no key until its first transaction completes it. The relay
reserves more than the visible gas cost to cover that completion.

**Fix.** Fund throwaway accounts generously. 10 HBAR for a call that needs 2.

---

## 8. The scaffold forks Hedera for every single test

**Symptom.** The contract suite took **ten minutes**.

**Cause.** scaffold-hbar ships `networks.hardhat.forking` unconditional, so
every deploy and every call round-trips to Hashio to fetch state.

**Why it was pure cost.** The suite fetches nothing it needs. The feed under
test is `MockAggregatorV3`, deployed locally precisely so a staleness bound
can be exercised at an age no live feed would ever show. Forking also made
the suite fail whenever Hashio rate-limited — a red test that says nothing
about the code, which is the fastest way to train a developer to ignore red.

**Fix.** Gated on `HEDERA_FORKING`, the same flag that loads the plugin.
**Ten minutes to twelve seconds.**

---

## 9. Tailwind's source-scan cache survives a rebuild

**Symptom.** Every new page rendered unstyled — a full-width hamburger icon
and nothing else. The CSS bundle loaded fine and contained rules, which is
what made it baffling.

**Diagnosis that settled it.** A probe element in the live page:

```
h-5         -> 20px     works
mt-6        -> 0px      missing
max-w-5xl   -> none     missing
rounded-box -> 0px      missing
```

Utilities from files that existed when the cache was written were present;
everything newer was absent.

**Fix.** `rm -rf packages/nextjs/.next`. An ordinary rebuild is not enough.

---

## 10. The harness reported five broken builds in fifty milliseconds each

**Symptom.**

```
command yarn install exit=1 durationMs=73
command yarn lint    exit=1 durationMs=52
...
```

**Cause.** There is no global `yarn` on the machine — this repo relies on the
vendored Yarn 3 at `.yarn/releases/`, because `corepack enable` needs
Administrator on Windows. The harness resolves the package manager for
`baseline.commands` but hands **validator** commands straight to a shell, so
a bare `yarn` dies with "command not found".

**What made it hard.** Fifty milliseconds is not a failing build, it is a
missing binary — but the harness reports both identically, and a reader sees
"your project does not build". I had already documented this exact trap for
the Playwright *server* command and fixed it there, then assumed validator
commands were resolved like baseline ones. They are not.

**Fix.** Every command in `.harness/validators/yarn.json` invokes
`node .yarn/releases/yarn-3.2.3.cjs` explicitly.

**The lesson.** I wrote the warning and then did not apply it one file over.
Knowing a trap is not the same as having checked for it.

---

## 11. My own decoder dropped every zero-argument custom error

**Symptom.** Three of four failure demos decoded to named contract errors.
The fourth returned a bare `CONTRACT_REVERT_EXECUTED`.

**Cause.** A custom error with no arguments is exactly the four-byte
selector, so its revert data is ten characters: `0x` plus eight hex. The
length guard said `> 10`.

That silently excluded `NotSettlement`, `NotOwner`, `NotCreator` and
`ZeroAddress` — the entire authorisation family, and precisely the errors
whose names carry the whole meaning.

**Fix.** `>= 10`.

---

## Two things that were not bugs

**The recommended BTC/USD bound was wrong, and the live test caught it.**
BTC drifted from 18 minutes to 2.0 hours over an afternoon and tripped the
2-hour bound this template recommended for it. That is the exact mistake the
template argues against — a bound that rejects a healthy feed. The constant
was widened to 6h. **The test was not relaxed**, and it remains as a
permanent assertion that every feed sits inside its own bound.

**Stranded escrow in `Draft` policies did not exist.** I wrote a test
asserting that a policy funded 3 against a promise of 10 could still be
expired and refunded. It failed: `fund()` reverts when a payment would leave
a Draft policy short, and the revert rolls back the escrow increment with it.
A Draft policy holds exactly zero, always. The fix I had started writing was
for a bug that was not there; what shipped instead was one state-machine edge
so an abandoned draft can reach a terminal state, and the failed test became
the one that pins why no escrow is at risk.
