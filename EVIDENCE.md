# Evidence

Everything below happened on Hedera testnet on **21 September 2026** and can
be checked without running this repository, without a wallet, and without
asking anyone for access. Every link goes to HashScan or the public mirror
node.

Reproduce it yourself with `yarn lifecycle --network hederaTestnet`.

---

## Deployed contracts

| Contract | Address | |
| --- | --- | --- |
| `PolicyRegistry` | `0xa940AdB6D97BaD78cddF5c451b8Ce05EE6EdECEF` | [HashScan](https://hashscan.io/testnet/contract/0xa940AdB6D97BaD78cddF5c451b8Ce05EE6EdECEF) |
| `Settlement` | `0x7710BbaDcC568f52306a13ec2976517EcdE4abcc` | [HashScan](https://hashscan.io/testnet/contract/0x7710BbaDcC568f52306a13ec2976517EcdE4abcc) |
| `ChainlinkPriceSource` | `0x05956Cca58B1CAEE6Bd798FFD85c0103B363387e` | [HashScan](https://hashscan.io/testnet/contract/0x05956Cca58B1CAEE6Bd798FFD85c0103B363387e) |

Deployer / operator: [`0.0.10349640`](https://hashscan.io/testnet/account/0.0.10349640)

### Feeds registered, each with its own bound

This is the central claim of the template, on-chain. Seven feeds, seven
different staleness bounds, no global default:

| Asset | Proxy | `maxAge` |
| --- | --- | --- |
| HBAR/USD | `0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a` | 3,600s |
| LINK/USD | `0xF111b70231E89D69eBC9f6C9208e9890383Ef432` | 7,200s |
| BTC/USD | `0x058fE79CB5775d4b167920Ca6036B824805A9ABd` | 21,600s |
| ETH/USD | `0xb9d461e0b962aF219866aDfA7DD19C52bB9871b9` | 10,800s |
| USDC/USD | `0xb632a7e7e02d76c0Ce99d9C62c7a2d1B5F92B6B5` | 86,400s |
| USDT/USD | `0x06823de8E77d708C4cB72Cbf04495D67afF4Bd37` | 86,400s |
| DAI/USD | `0xdA2aBF7C90aDC73CDF5cA8d720B87bD5F5863389` | 86,400s |

Check any of them yourself:

```bash
curl -s -X POST https://testnet.hashio.io/api \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x05956Cca58B1CAEE6Bd798FFD85c0103B363387e","data":"0x..."},"latest"]}'
```

Or just open [`/feeds`](#), which does it on page load with no credentials.

---

## A complete settlement, pushed by a stranger

Policy **#4**, against the real HBAR/USD Chainlink feed.

| Step | Transaction |
| --- | --- |
| Fund the settler | [`0xa7bc3927420dec8a…`](https://hashscan.io/testnet/transaction/0xa7bc3927420dec8a74c4933e736310f73354ee4da78d85b25f2e9184a8bb1558) |
| `createPolicy` | [`0x47b13a6c6d71e22e…`](https://hashscan.io/testnet/transaction/0x47b13a6c6d71e22e87f810ee4d2e1ac2508a10dac427148fbbd4244bafa0f3f3) |
| `fund` the escrow | [`0xd433644282e1a2a0…`](https://hashscan.io/testnet/transaction/0xd433644282e1a2a0e81fba3516c500625517d3848abc087d4e147db706194366) |
| **`trigger()` — by the stranger** | [`0xded6b84925026ccd…`](https://hashscan.io/testnet/transaction/0xded6b84925026ccdd545a85446ee2f1ad7860e190ddc1f8420257d28b357ce6e) |

| | |
| --- | --- |
| Beneficiary | [`0xb13171D8f4d6d94c83CF57cB3f2A44497C870460`](https://hashscan.io/testnet/account/0xb13171D8f4d6d94c83CF57cB3f2A44497C870460) |
| Settler | [`0x472E0314ff404cbd55bBC909D866A479228b4C61`](https://hashscan.io/testnet/account/0x472E0314ff404cbd55bBC909D866A479228b4C61) |
| Price it settled on | `0.09231262` (18dp: `92312620000000000`) |
| Feed reading age | 18 minutes, against a 3,600s bound |
| Paid to beneficiary | **1.0 HBAR** |

**The settler is neither the creator nor the beneficiary.** That is the part
worth checking: settlement is permissionless because the decision rests on
what the price source says, not on who is asking. A beneficiary who depended
on the creator's goodwill to get paid would not have a guarantee, they would
have a promise.

### I1, on the live chain

A second `trigger()` on policy #4 **reverted**. The registry found the policy
in `Settled` and refused the `Active → Triggered` transition. There is no
"already paid" flag to forget to check — the state machine is the check.

---

## The public evidence trail

Topic [`0.0.10651272`](https://hashscan.io/testnet/topic/0.0.10651272), created
with a submit key so only the operator can append.

Read the whole thing with no credentials:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10651272/messages?limit=100&order=asc"
```

The six records, exactly as they sit on the ledger:

```json
{"v":1,"kind":"policy_created","policyId":1,"at":1790010090,"assetHash":"0x2c03d7a8…cfa908"}
{"v":1,"kind":"policy_created","policyId":2,"at":1790010278,"assetHash":"0x2c03d7a8…cfa908"}
{"v":1,"kind":"policy_created","policyId":3,"at":1790010421,"assetHash":"0x2c03d7a8…cfa908"}
{"v":1,"kind":"policy_created","policyId":4,"at":1790010523,"assetHash":"0x2c03d7a8…cfa908"}
{"v":1,"kind":"triggered","policyId":4,"at":1790010541,"assetHash":"0x2c03d7a8…cfa908","price":"92312620000000000"}
{"v":1,"kind":"settled","policyId":4,"at":1790010541,"assetHash":"0x2c03d7a8…cfa908","price":"92312620000000000"}
```

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
  topic 0.0.10651272 already holds 6 evidence records

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
