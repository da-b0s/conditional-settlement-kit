# Talon — evidence

## Current deployment — 28 September 2026

The contracts the app uses today, on Hedera testnet. On top of the 27 September
deployment below, `createPolicy()` refuses a zero payout or threshold, and
`preview()` refuses an expired or non-Active policy with the same errors
`trigger()` would. All three contracts are verified on Sourcify with
`exact_match`.

| Contract | Address | |
| --- | --- | --- |
| `PolicyRegistry` | `0x25B67900B72BFf2FfeC604F197117570E351b6db` | [HashScan](https://hashscan.io/testnet/contract/0x25B67900B72BFf2FfeC604F197117570E351b6db) · [Sourcify](https://repo.sourcify.dev/contracts/full_match/296/0x25B67900B72BFf2FfeC604F197117570E351b6db/) |
| `Settlement` | `0xa95601CA138C2a673C4314E6beFf56bb3832257C` | [HashScan](https://hashscan.io/testnet/contract/0xa95601CA138C2a673C4314E6beFf56bb3832257C) · [Sourcify](https://repo.sourcify.dev/contracts/full_match/296/0xa95601CA138C2a673C4314E6beFf56bb3832257C/) |
| `ChainlinkPriceSource` | `0x63c544315Dc21187eb1B6668bE8139e8a778C6d1` | [HashScan](https://hashscan.io/testnet/contract/0x63c544315Dc21187eb1B6668bE8139e8a778C6d1) · [Sourcify](https://repo.sourcify.dev/contracts/full_match/296/0x63c544315Dc21187eb1B6668bE8139e8a778C6d1/) · unchanged, reused |

Deployer and contract owner: [`0.0.10743664`](https://hashscan.io/testnet/account/0.0.10743664).
Evidence operator: [`0.0.10349640`](https://hashscan.io/testnet/account/0.0.10349640).

### A settlement, end to end

Policy #1 on HBAR/USD, 1 HBAR payout, settled by an account that is neither
its creator nor its beneficiary. The beneficiary holds exactly 1 HBAR and the
policy's escrow is zero.

| Step | Transaction |
| --- | --- |
| `createPolicy` | [`0xd3b61cde2c70d029…`](https://hashscan.io/testnet/transaction/0xd3b61cde2c70d029a3f738ac537b772818ffe2db424ddd0bd417c49aad481a39) |
| `fund` the escrow | [`0xa3510083e7b84177…`](https://hashscan.io/testnet/transaction/0xa3510083e7b84177caf9c1b0570c23053a84eda614b58d745ecfa332ec155d3f) |
| Fund the settler | [`0x98f3c06fc2f4036c…`](https://hashscan.io/testnet/transaction/0x98f3c06fc2f4036c5a0acf92f6c96254dcca4c7a287c9923ced0bcd9513254a3) |
| **`trigger()` — by the stranger** | [`0x3d3397ddfe128d84…`](https://hashscan.io/testnet/transaction/0x3d3397ddfe128d84d749be71916db810011fa9c6124fc2ed404ecd3b3540c0ab) |

| Party | Account |
| --- | --- |
| Beneficiary | [`0xA563aB5A8DCB548B14E49308D8D663493A1b80Bf`](https://hashscan.io/testnet/account/0xA563aB5A8DCB548B14E49308D8D663493A1b80Bf) — received 1 HBAR |
| Settler | [`0x967f338d51626090B94B78F62917e843A75a271D`](https://hashscan.io/testnet/account/0x967f338d51626090B94B78F62917e843A75a271D) |

Settled on an HBAR/USD reading of 0.09476357, inside that feed's 3,600-second
bound. After settlement, simulating `trigger(1)` and calling `preview(1)` both
revert with `IllegalTransition(1, Settled, Triggered)`: I1 holds, and preview
now says so rather than reporting "ready".

This run was interrupted by dropped connections to the relay. The script died
waiting for the `trigger()` receipt after the transaction had been accepted;
the result above was read back from the mirror node. The deploy was likewise
finished across reruns, which is why it now skips work already on chain.

### Evidence topic

Topic [`0.0.10752744`](https://hashscan.io/testnet/topic/0.0.10752744), created
with a submit key, holds three records for policy #1: `policy_created`,
`triggered`, `settled`. `/evidence` opens on it by default.

```sh
curl -s "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10752744/messages?limit=100&order=asc"
```

Reproduce with `yarn hardhat:deploy`, `yarn lifecycle` and
`yarn evidence:publish --network hederaTestnet`; the first two prompt for the
deployer password.

HCS records were published separately by an operator. Their ordering does not
prove that they capture every contract event or independently validate the
operator's claims. This file does not demonstrate an HSS scheduled expiry.

---

## Earlier deployment — 27 September 2026 (history)

Replaced on 28 September 2026 by the deployment above, which reuses its
`ChainlinkPriceSource`. Its policy #1 and topic `0.0.10743528` remain readable.

The contracts the app used until 28 September. They include the funding
guard and the surplus `withdraw()` (settlement credits any escrow beyond the
payout to the creator instead of sending it, so a creator that refuses HBAR
cannot block the beneficiary's payout). All three are verified on Sourcify
with `exact_match`.

| Contract | Address | |
| --- | --- | --- |
| `PolicyRegistry` | `0xB3BfE675cbab5bF146fAc6B4B6a6B3d02f7648Ea` | [HashScan](https://hashscan.io/testnet/contract/0xB3BfE675cbab5bF146fAc6B4B6a6B3d02f7648Ea) · [Sourcify](https://repo.sourcify.dev/contracts/full_match/296/0xB3BfE675cbab5bF146fAc6B4B6a6B3d02f7648Ea/) |
| `Settlement` | `0x9c6b35c1b7b95B0C60d02fa43bACf399E26f73B3` | [HashScan](https://hashscan.io/testnet/contract/0x9c6b35c1b7b95B0C60d02fa43bACf399E26f73B3) · [Sourcify](https://repo.sourcify.dev/contracts/full_match/296/0x9c6b35c1b7b95B0C60d02fa43bACf399E26f73B3/) |
| `ChainlinkPriceSource` | `0x63c544315Dc21187eb1B6668bE8139e8a778C6d1` | [HashScan](https://hashscan.io/testnet/contract/0x63c544315Dc21187eb1B6668bE8139e8a778C6d1) · [Sourcify](https://repo.sourcify.dev/contracts/full_match/296/0x63c544315Dc21187eb1B6668bE8139e8a778C6d1/) |

Deployer and contract owner: [`0.0.10743664`](https://hashscan.io/testnet/account/0.0.10743664).
Evidence operator: [`0.0.10349640`](https://hashscan.io/testnet/account/0.0.10349640).

### A settlement, end to end

Policy #1 on HBAR/USD, 1 HBAR payout, settled by an account that is neither
its creator nor its beneficiary. A second `trigger()` from the same account
reverted, as I1 requires.

| Step | Transaction |
| --- | --- |
| `createPolicy` | [`0x6dc42fa1b473e210…`](https://hashscan.io/testnet/transaction/0x6dc42fa1b473e210026caa08b0061088284d3dc42b4ef91117888ba33737cf12) |
| `fund` the escrow | [`0x65d06b411802719b…`](https://hashscan.io/testnet/transaction/0x65d06b411802719b3db7f450851fbe7fe27551bfad3b0e13d43ff05220aba773) |
| Fund the settler | [`0xac634776950c2dd2…`](https://hashscan.io/testnet/transaction/0xac634776950c2dd20ee3a923da64c6283c0e9ba558560d1d804ff0ce20a3b73c) |
| **`trigger()` — by the stranger** | [`0x4550455177efd06a…`](https://hashscan.io/testnet/transaction/0x4550455177efd06a74bceae92ab0c3ec8b55d34599db6a30f61bc0ccbc1759a0) |

| Party | Account |
| --- | --- |
| Beneficiary | [`0x6789a959BC0Aef740806473b9ad6567ce472FC1B`](https://hashscan.io/testnet/account/0x6789a959BC0Aef740806473b9ad6567ce472FC1B) — received 1 HBAR |
| Settler | [`0xE7e1CAd0f788F7092d24bB60EA22836756B8FF15`](https://hashscan.io/testnet/account/0xE7e1CAd0f788F7092d24bB60EA22836756B8FF15) |

Settled on an HBAR/USD reading of 0.09531825, inside that feed's 3,600-second
bound. The first attempt at this run funded a settler and then failed before
`trigger()`: the throwaway wallet priced its call at 218 wei and the relay
refused it. `runLifecycle.ts` now sets the gas price explicitly and can
resume a funded policy with `LIFECYCLE_POLICY_ID`.

### Evidence topic

Topic [`0.0.10743528`](https://hashscan.io/testnet/topic/0.0.10743528), created
with a submit key, holds three records for policy #1: `policy_created`,
`triggered`, `settled`.

```sh
curl -s "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10743528/messages?limit=100&order=asc"
```

Reproduce with `yarn hardhat:deploy`, `yarn lifecycle` and
`yarn evidence:publish --network hederaTestnet`; the first two prompt for the
deployer password.

HCS records were published separately by an operator. Their ordering does not
prove that they capture every contract event or independently validate the
operator's claims. This file does not demonstrate an HSS scheduled expiry.

---

## Previous deployment — 21 September 2026 (history)

Replaced on 27 September 2026. These contracts predate the funding guard and
the surplus `withdraw()`; the app no longer points at them. The records below
are kept because the links still verify what happened then.

Everything below happened on Hedera testnet on **21 September 2026** and can
be checked without running this repository, without a wallet, and without
asking anyone for access. Every link goes to HashScan or the public mirror
node.

Reproduce it yourself with `yarn lifecycle --network hederaTestnet`.

---

## Deployed contracts

| Contract | Address | |
| --- | --- | --- |
| `PolicyRegistry` | `0x0d107277BAA8D031D5CeD8CA6E1b4C0c552A993a` | [HashScan](https://hashscan.io/testnet/contract/0x0d107277BAA8D031D5CeD8CA6E1b4C0c552A993a) |
| `Settlement` | `0x57eDdaAe98A54D3346e556BB8D681cf91E6E1554` | [HashScan](https://hashscan.io/testnet/contract/0x57eDdaAe98A54D3346e556BB8D681cf91E6E1554) |
| `ChainlinkPriceSource` | `0x348C2590D0Ea01daEbD4d907B83F5752FfC577DF` | [HashScan](https://hashscan.io/testnet/contract/0x348C2590D0Ea01daEbD4d907B83F5752FfC577DF) |

Deployer / operator: [`0.0.10349640`](https://hashscan.io/testnet/account/0.0.10349640)

**All three are verified on Sourcify with `exact_match`**, so the deployed
bytecode provably compiles from the source in this repository — you do not
have to take the addresses on trust:

- [ChainlinkPriceSource](https://repo.sourcify.dev/contracts/full_match/296/0x348C2590D0Ea01daEbD4d907B83F5752FfC577DF/)
- [PolicyRegistry](https://repo.sourcify.dev/contracts/full_match/296/0x0d107277BAA8D031D5CeD8CA6E1b4C0c552A993a/)
- [Settlement](https://repo.sourcify.dev/contracts/full_match/296/0x57eDdaAe98A54D3346e556BB8D681cf91E6E1554/)

Reproduce with `yarn hardhat:verify:sourcify <address> contracts/X.sol:X`.
Note that `yarn hardhat:verify:testnet` does NOT work: the bundled
hardhat-verify 2.x calls Sourcify's retired V1 API and fails with a JSON
parse error that reads like an explorer outage.

### Feeds registered, each with its own bound

Seven feeds, each registered with an explicit staleness bound and no global
default. Several feeds share the same configured value:

| Asset | Proxy | `maxAge` |
| --- | --- | --- |
| HBAR/USD | `0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a` | 3,600s |
| LINK/USD | `0xF111b70231E89D69eBC9f6C9208e9890383Ef432` | 7,200s |
| BTC/USD | `0x058fE79CB5775d4b167920Ca6036B824805A9ABd` | 21,600s |
| ETH/USD | `0xb9d461e0b962aF219866aDfA7DD19C52bB9871b9` | 10,800s |
| USDC/USD | `0xb632a7e7e02d76c0Ce99d9C62c7a2d1B5F92B6B5` | 86,400s |
| USDT/USD | `0x06823de8E77d708C4cB72Cbf04495D67afF4Bd37` | 86,400s |
| DAI/USD | `0xdA2aBF7C90aDC73CDF5cA8d720B87bD5F5863389` | 86,400s |

Open `/feeds` in the running app to read live prices and compare them with
the frontend's configured bounds. To verify the deployed configuration itself,
use the contract debugger to read `ChainlinkPriceSource.maxAgeOf(asset)`, where
`asset` is the keccak256 hash of the pair name (for example, `HBAR/USD`). The
frontend table is not a substitute for checking owner-changeable on-chain settings.

---

## A complete settlement, pushed by a stranger

Policy **#1**, against the real HBAR/USD Chainlink feed.

| Step | Transaction |
| --- | --- |
| Fund the settler | [`0x9a0059a1f219e1f5…`](https://hashscan.io/testnet/transaction/0x9a0059a1f219e1f5b35c63f7de6924d0f68bafb869dfcc2bc992bf5191f12514) |
| `createPolicy` | [`0x6695c6a1981ab9c9…`](https://hashscan.io/testnet/transaction/0x6695c6a1981ab9c9f88776eb4c6b1c87add42a5e0dac65f5ef437922cae0190e) |
| `fund` the escrow | [`0xc3f7901b3b44b6bd…`](https://hashscan.io/testnet/transaction/0xc3f7901b3b44b6bd2115389fc554de72ecc80b7a2f017082fe3b6cdbf671e68a) |
| **`trigger()` — by the stranger** | [`0x2e00806f0ea3b3ed…`](https://hashscan.io/testnet/transaction/0x2e00806f0ea3b3ed72f45df64bae1e51b44f5de80c6105f18906fca71adcc968) |

| | |
| --- | --- |
| Beneficiary | [`0xAF44ed77Af8B92564Ca0065677b66e8BbBE5612c`](https://hashscan.io/testnet/account/0xAF44ed77Af8B92564Ca0065677b66e8BbBE5612c) |
| Settler | [`0x506138B351eF51dAe9FD84CE54c4fCD0f58Ac3fD`](https://hashscan.io/testnet/account/0x506138B351eF51dAe9FD84CE54c4fCD0f58Ac3fD) |
| Price it settled on | `0.09134` (18dp: `91340000000000000`) |
| Feed bound applied | 3,600s — HBAR/USD carries the tightest one |
| Paid to beneficiary | **1.0 HBAR** |

**The settler is neither the creator nor the beneficiary.** This demonstrates
permissionless submission through the deployed settlement contract. Execution
still depends on the configured source, contract state, available fees and
the owner-controlled settings described in README.md.

### I1, on the live chain

A second `trigger()` on policy #1 **reverted**. The registry found the policy
in `Settled` and refused the `Active → Triggered` transition. There is no
"already paid" flag to forget to check — the state machine is the check.

---

## The four refusals, on chain

A happy path shows that the code can pay out. It shows nothing about whether
the code can be made to pay out when it should not, which is the only
question that matters for something holding escrow. So each of these is a
real transaction against the same deployed contracts, and each one **failed**.

Reproduce with `yarn failures --network hederaTestnet`.

| | Refusal | Transaction | Contract's own error |
| --- | --- | --- | --- |
| **F1** | `trigger()` against a feed whose own bound it cannot meet | [`0x32a66611d054bec3…`](https://hashscan.io/testnet/transaction/0x32a66611d054bec3cc18e41b614368951c25e318e61b0bcf161c8849d4fdfb13) | `ObservationStale(0xab2485a4…fe776, 1790014007, 1790015384, 1)` |
| **F2** | `registry.settle()` called directly, bypassing `Settlement` | [`0x1bc78e3b77d1f61d…`](https://hashscan.io/testnet/transaction/0x1bc78e3b77d1f61dc6cffeee961a2717515fbf08b55090cbb5473c9c9f768997) | `NotSettlement()` |
| **F3** | `trigger()` on a policy already expired | [`0xae59e5381cb3a977…`](https://hashscan.io/testnet/transaction/0xae59e5381cb3a977ac3009b6493fdbc967c886e6a262ab6e14019032c0450f25) | `AlreadyExpired(9, 1790015455, 1790015495)` |
| **F4** | `fund()` with 0.1 HBAR against a 1 HBAR promise | [`0x266432771905fef9…`](https://hashscan.io/testnet/transaction/0x266432771905fef9c7afc8e61e63b6ae94620605ef76c3d7b798d1c1dd5e519f) | `PayoutExceedsEscrow(10, 100000000, 10000000)` |

Together with the successful settlement and the refused replay above, that is
**six outcomes, each with a testnet transaction behind it**.

### F1 is the template's whole argument, on-chain

A real Chainlink feed cannot be forced stale on demand, so F1 registers the
**same proxy** — `0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a`, the real
HBAR/USD feed — under a second asset key with a **one-second** bound.

Same contract. Same price. Same moment. One asset settles and the other
reverts, because the bound belongs to the feed rather than to the system.
The error carries the arithmetic: reading from `1790014007`, evaluated at
`1790015384`, against a `maxAge` of `1` — 1,377 seconds too old.

### F4 shows the units, too

`PayoutExceedsEscrow(10, 100000000, 10000000)` is a 1 HBAR promise against
0.1 HBAR of escrow, in **tinybar** — `1e8` and `1e7`. That is `msg.value`'s
own precision, and seeing it here rather than as `1e18` is the units fix
holding on a live network.

### What did not decode, and why it is worth saying

F2 first came back as a bare `CONTRACT_REVERT_EXECUTED` while the other three
decoded cleanly. The cause was in the decoder, not the chain: a custom error
with no arguments is exactly the 4-byte selector, so its revert data is 10
characters, and the length guard said `> 10`. Every zero-argument error —
`NotSettlement`, `NotOwner`, `NotCreator`, `ZeroAddress` — was being silently
dropped, which is exactly the set whose names carry the entire meaning.

---

## The public evidence trail

Topic [`0.0.10651678`](https://hashscan.io/testnet/topic/0.0.10651678), created
with a submit key so only the operator can append.

Read the whole thing with no credentials:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10651678/messages?limit=100&order=asc"
```

Abbreviated examples of the first three records show the successful lifecycle.
The historical capture held 18 records, including expiries and refunds from
the failure demos; query the topic for its current contents and full hashes:

```json
{"v":1,"kind":"policy_created","policyId":1,"at":1790012394,"assetHash":"0x2c03d7a8…cfa908"}
{"v":1,"kind":"triggered","policyId":1,"at":1790012422,"assetHash":"0x2c03d7a8…cfa908","price":"91340000000000000"}
{"v":1,"kind":"settled","policyId":1,"at":1790012422,"assetHash":"0x2c03d7a8…cfa908","price":"91340000000000000"}
```

One topic belongs to one deployment. The idempotence key is
`(kind, policyId)` and carries no contract address, so pointing a second
registry at the same topic would make its policy #1 look already-published.
The address is deliberately not in the record — `evidence.ts` refuses
anything shaped like one, and weakening that guard to solve a bookkeeping
problem would be the wrong trade.

### I6, verifiable by inspection

There is no address in there. No account id, no beneficiary, no creator, no
name, no memo, no free-text field of any kind. The asset is a keccak hash,
not the string `HBAR/USD`, because a pair name today is a customer reference
once somebody generalises the field.

`buildEvidence` constructs each record field by field rather than spreading
its input, and `assertPublishable` re-checks the serialised JSON immediately
before submission. An HCS topic is permanent: a field published carelessly
cannot be withdrawn, only apologised for underneath.

### Idempotence

`yarn evidence:publish` run a second time against the same registry published
nothing:

```
  topic 0.0.10651678 already holds 18 evidence records

Nothing to publish — the topic is up to date.
```

It reads the topic back and skips every `(kind, policyId)` already present.
An append-only permanent log is not somewhere to discover you were not
idempotent.

---

## What the live feed measurement says

Re-taken repeatedly on the same day with `yarn next:test:live`:

| Reading | Spread | Feed a 1-hour global bound would wrongly reject |
| --- | --- | --- |
| 1 | 116× | USDC, USDT, DAI |
| 2 | 228× | BTC/USD |
| 3 | 269× | BTC, USDC, USDT, DAI |
| 4 | 1,213× | BTC, USDC, USDT, DAI |
| 5 | 3,810× | BTC, USDC, USDT, DAI |

Every specific number moved. The structure never did: some feeds minutes old,
others hours old, **all inside their declared 24-hour heartbeat**, and no
single bound that serves them all.

Reading 4 is the one that matters most. BTC/USD hit 2.0 hours against the
2-hour bound this template recommended for it, and the suite went red. The
bound was widened to 6h — **the constant was wrong, not the test**. Shipping
it would have been this template's own argument made in miniature: a bound
that rejects a feed behaving exactly as designed.

---

## Things that went wrong on the way, kept because they are the useful part

**`msg.value` is tinybar, transaction `value` is weibar.** One HBAR is `1e18`
in a transaction's value field and `1e8` by the time a contract reads
`msg.value`. The first attempt at this lifecycle reverted with:

```
PayoutExceedsEscrow(1, 1000000000000000000, 100000000)
```

Both calls said "one HBAR". They were ten billion apart. It does not
reproduce locally, because a Hardhat node is an ordinary EVM where both are
18dp — every contract test passed. `lib/settlement/units.ts` exists because
of this, and `units.test.ts` pins it.

**`PrivateKey.fromStringDer()` accepts a raw ECDSA hex key.** It logs a
warning and returns a *different* key rather than throwing, so a
try-DER-then-ECDSA fallback never reaches its fallback. The topic creation
failed with `INVALID_SIGNATURE`, which my own error translator rendered as
"the operator key does not hold this topic's submit key" — about a topic that
did not exist yet. Key format is now decided by shape, and
`hcsPublisher.test.ts` asserts the SDK quirk directly so the fix cannot be
undone by someone tidying it back into a try/catch.

**`trigger()` costs 111,226 gas locally and ran out at 500,000 on Hedera.**
Cross-contract calls reaching an external oracle are charged far more heavily
than the EVM estimate suggests. Budget multiples, not margins.

**Hedera caps `eth_getLogs` at a seven-day window.** `queryFilter` with no
range asks for block 0 to latest and is refused. The publisher starts from
the registry's deployment block and walks forward in 250,000-block windows.

**A hollow account needs more than the arithmetic suggests.** Sending HBAR to
an unknown EVM address auto-creates an account with no key until its first
transaction completes it. Funded with 3 HBAR against a 1.71 HBAR gas cost,
the relay still answered "Insufficient funds for transfer".
