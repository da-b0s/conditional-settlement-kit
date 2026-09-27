# Conditional Settlement Kit

A Scaffold-HBAR template for **price-triggered HBAR escrow on Hedera testnet**.
A creator defines a beneficiary, payout, price threshold and deadline, then
funds the policy. Anyone can submit a settlement transaction when the latest
accepted oracle reading meets the condition. After expiry, anyone can mark the
policy expired, and its creator can request a refund.

The template combines Chainlink price reads, a settlement state machine and
an optional HCS evidence publisher. It is an unaudited developer starting
point, not a production financial product.

## Quick start

Use Node **20.18.3 or later**, Git, and an internet connection for installation
and live testnet reads. Yarn 3.2.3 is included; no global Yarn installation is
required. Run these commands from the extracted or cloned repository root:

```sh
node .yarn/releases/yarn-3.2.3.cjs install --immutable
node .yarn/releases/yarn-3.2.3.cjs next:dev
```

Open [localhost:3000](http://localhost:3000). Stop the server with Ctrl+C.
If Yarn is already configured, `yarn install --immutable` and `yarn next:dev`
are equivalent. All scripts below can use the vendored Yarn command.

No wallet, private key, `.env` file or redeployment is needed to explore Home,
Feeds or Evidence, which opens on this deployment's topic `0.0.10743528`.
Wallet transactions require a funded Hedera testnet account. Hedera testnet is
the only network the app and contracts target.

First installation and first visits in development mode can take several
minutes, depending on the computer and network. Loading feedback does not
eliminate compilation time. For a presentation, stop the development server:

```sh
node .yarn/releases/yarn-3.2.3.cjs next:build
node .yarn/releases/yarn-3.2.3.cjs next:serve
```

`next:serve` is the production server; `next:start` runs development mode here.
A known stylesheet warning concerns external font-import ordering; the last
local production build completed despite it. See [START-HERE.md](START-HERE.md)
for a shorter walkthrough.

## Implemented features and extensions

| Capability | Current scope |
| --- | --- |
| Escrow | HBAR only; creator, beneficiary, fixed payout, threshold and deadline |
| Condition | Latest accepted price at or above/below a threshold |
| Oracle | Chainlink implementation with explicit freshness limits per feed and decimal checks |
| Settlement | Permissionless transaction submission; no continuously running keeper |
| Expiry/refund | Permissionless `expire()`, followed by creator-only `refund()` |
| Evidence | Public HCS reader and separate operator-run publisher for selected events |
| Scheduling | Optional `scheduleExpiry()` helper; not automatically invoked by the policy UI |
| Developer tools | Contract debugger, HashScan links for the deployment, offline contract and library tests |

Milestone payments, grants, delivery confirmation and warranty claims are
**possible extensions**, not shipped workflows. They need their own condition
verification, authorization model and tests. Supra/Pyth adapters are also not
implemented; `IPriceSource` is the extension point.

## Suggested demo journey

1. **Home:** understand the escrow lifecycle and its intended checks.
2. **Feeds:** inspect live readings and configured freshness limits. Each
   parallel RPC read has a 15-second deadline, including its response body.
   Healthy feeds remain visible if others fail. A total outage shows the
   configuration and retry option. Retries fetch fresh data.
3. **Evidence:** opens on topic `0.0.10743528`, the recorded testnet lifecycle. Reads
   share a 15-second budget across pagination and the empty-topic check. A
   timeout reports failure rather than presenting the partial read as complete.
4. **Policies:** connect a funded testnet wallet to create and fund a policy,
   then submit settlement or expiry/refund transactions. These spend testnet
   HBAR; opening the page does not send a transaction.
5. **Debug Contracts / Block Explorer:** inspect deployed state, and follow links to HashScan.

Settlement checks the observation available **when the transaction executes**.
It does not prove that a price crossed the threshold earlier. Neither a price
crossing nor the deadline automatically sends a transaction or returns funds.

## Why configure freshness per feed?

The repository records samples from 21 September 2026 in which testnet feed
ages differed substantially. See [EVIDENCE.md](EVIDENCE.md) and the
[feed table](packages/nextjs/lib/settlement/feeds.ts). Those are historical
observations, not current prices or guaranteed update schedules.

A shared short limit can reject readings still within a provider's advertised
heartbeat. A longer limit can accept data older than an application wants.
This does not prove every shared limit is invalid, or that every in-heartbeat
reading is suitable for a payout. An observed age spread is not a security proof.

This implementation requires a nonzero limit for each registered asset.
Choose it using provider guidance, observations and application risk tolerance.
The shipped limits are examples, not certified safe values. The live tests
contain assumptions about feed ages and can fail when those conditions change,
even if the contract's configured checks still work.

## Architecture and trust assumptions

| Component | Responsibility |
| --- | --- |
| [PolicyRegistry.sol](packages/hardhat/contracts/PolicyRegistry.sol) | Escrow, lifecycle transitions, payouts and refunds |
| [Settlement.sol](packages/hardhat/contracts/Settlement.sol) | Source lookup, threshold check and payment request |
| [ChainlinkPriceSource.sol](packages/hardhat/contracts/ChainlinkPriceSource.sol) | Feed registration, positive answer, round, age and decimal checks |
| [IPriceSource.sol](packages/hardhat/contracts/IPriceSource.sol) | Interface for alternative price providers |
| [lib/settlement](packages/nextjs/lib/settlement) | Framework-free readers, evidence helpers, units and scheduling |
| `packages/nextjs/app` | Public pages and wallet-enabled policy components |

[invariants.ts](packages/nextjs/lib/settlement/invariants.ts) maps intended
checks to test files. Passing tests demonstrate covered behaviours, not a
security audit or proof of all inputs. Mainnet use has not been validated.

Before adapting the template, understand these limits:

- Owners can replace the authorized settlement address, change an asset's
  source, and register/remove feeds or change their limits. These settings are
  not pinned per policy. Owner behavior and key security are part of the trust
  model; no timelock or emergency pause is implemented.
- The registry checks authorization, state and escrow; it does **not**
  independently verify the oracle condition. Splitting it from `Settlement`
  does not make faulty or malicious authorized settlement logic harmless.
- `preview()` does not perform every lifecycle check from `trigger()`.
  A positive preview cannot guarantee transaction success.
- The first funding call must cover the payout or it reverts. `fund()`
  accepts only Draft or Active policies strictly before their
  deadline. Later states reject deposits with `FundingNotAllowed`; a Draft
  or Active policy at or past its deadline rejects them with `AlreadyExpired`.
  Valid Active top-ups are still allowed. Excess funds and refunds go to the
  creator, not necessarily the funder.
- Surplus escrow at settlement is credited to the creator and claimed with
  `withdraw()`, not sent inside `settle()`. A creator that refuses HBAR
  therefore cannot block the beneficiary's payout. A beneficiary that refuses
  HBAR can still revert its own settlement, and a creator that refuses it
  cannot take a refund. Execution still depends on fees, oracle data and
  network availability.
- Reverted transactions roll back their events. Legacy source comments saying
  `TriggerAccepted` survives a later revert are inaccurate.

**Current deployment:** the testnet contracts in
[deployedContracts.ts](packages/nextjs/contracts/deployedContracts.ts) include
the funding guard and surplus `withdraw()`, and are verified on Sourcify. See
[EVIDENCE.md](EVIDENCE.md). The earlier deployment it replaced lacked both;
its records are kept there as history. The legacy comments identified above
should not be treated as extra guarantees.

## HCS evidence: a separate operator task

Contract events are the original on-chain record. HCS is an optional summary,
**not an automatic write on every state change**. The publisher handles creation,
triggering, settlement, expiry and refund, but not the funding event. It can
lag behind the contracts.

For your own deployment, configure a funded testnet operator using
[packages/hardhat/.env.example](packages/hardhat/.env.example). Create a topic,
then put its returned ID in `packages/hardhat/.env` as `EVIDENCE_TOPIC` before
running the publisher:

```sh
node .yarn/releases/yarn-3.2.3.cjs evidence:topic
node .yarn/releases/yarn-3.2.3.cjs evidence:publish --network hederaTestnet
```

These commands spend testnet HBAR. Use one topic per deployment. Topics are
created with a submit key by default. The publisher skips existing
`(kind, policyId)` pairs it has read; this is not an exactly-once guarantee.
Concurrent publishers and history beyond the reader's default ten pages of
up to 100 messages need additional coordination.

HCS proves ordering of submitted records, not the truth or completeness of
operator claims. Cross-check important records against contract state and
transactions. Field restrictions reduce accidental disclosure; hashes and
policy IDs are not a general privacy guarantee. On-chain transactions still
expose public addresses. Do not publish confidential data.

## HSS: optional scheduled expiry

[schedule.ts](packages/nextjs/lib/settlement/schedule.ts) exposes `scheduleExpiry()`
to request an `expire(policyId)` call at a deadline. It is not automatically
called during policy creation. It needs funded operator credentials and network
support; the helper currently limits requests to a 62-day window.

Helper validation tests exist, but this review has not verified a complete
scheduled-expiry transaction from this deployment. Historical observations of
other schedules do not prove this integration.

If scheduling fails, anyone can still call `expire()` after the deadline.
The creator calls `refund()` separately. Scheduling does not guarantee
execution, successful payout or automatic refunds.

## Configuration and deployment

| Setting | Location | Purpose |
| --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY_ENCRYPTED` | `packages/hardhat/.env` | Written by the account-import flow for deployment |
| `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY` | `packages/hardhat/.env` | HCS operator; also used by callers of the scheduling helper |
| `HEDERA_KEY_TYPE` | `packages/hardhat/.env` | Operator key interpretation; defaults to ECDSA |
| `HEDERA_NETWORK` | `packages/hardhat/.env` | Operator SDK network; keep consistent with the deployment |
| `EVIDENCE_TOPIC` | `packages/hardhat/.env` | Publisher's topic |
| `NEXT_PUBLIC_EVIDENCE_TOPIC` | `packages/nextjs/.env.local` | Overrides the default topic (`PROJECT_EVIDENCE_TOPIC` in `lib/settlement/hcs.ts`) |
| `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL` | `packages/nextjs/.env.local` | Wallet/scaffold RPC override; `/feeds` uses `DEFAULT_RPC.testnet` in `feedReader.ts` |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | `packages/nextjs/.env.local` | Your WalletConnect project configuration |

The two environment files are separate. A frontend topic setting does not
automatically configure the publisher. Restart the frontend after environment
changes. Never put private keys in `NEXT_PUBLIC_*` variables or commit real
`.env` files. Treat private credentials distributed in an archive as exposed;
use your own testnet credentials for writes.

To deploy your own contracts, import a funded testnet deployer, then deploy:

```sh
node .yarn/releases/yarn-3.2.3.cjs hardhat:account:import
node .yarn/releases/yarn-3.2.3.cjs hardhat:deploy --network hederaTestnet
```

The deployment configures sources, checks registry wiring and writes deployment
information used by the frontend. It is not required to inspect the included demo.

Deploying, `lifecycle` and `failures` all prompt for the deployer password
and run on `hederaTestnet` by default; any other network is refused. Run any
other way, Hardhat would sign with its public test key, which holds no HBAR.
Contract tests still run offline in Hardhat's in-memory chain against a mock
feed; that is a test fixture, not a deployment target.

Use [units.ts](packages/nextjs/lib/settlement/units.ts) for payout arguments
and transaction values. The implementation distinguishes Hedera contract
amounts (8 decimals) from relay transaction values (18); the in-memory test
chain uses 18. Price thresholds use 18 decimals independently of payout units.

## Validation and evidence

Run from the repository root:

```sh
node .yarn/releases/yarn-3.2.3.cjs lint
node .yarn/releases/yarn-3.2.3.cjs hardhat:compile
node .yarn/releases/yarn-3.2.3.cjs hardhat:check-types
node .yarn/releases/yarn-3.2.3.cjs next:check-types
node .yarn/releases/yarn-3.2.3.cjs next:test
node .yarn/releases/yarn-3.2.3.cjs hardhat:test:ci
node .yarn/releases/yarn-3.2.3.cjs next:build
```

Keep `HEDERA_FORKING` unset for offline contract tests. Recent local checks
recorded 160 core-library tests passing. The contract suite has
79 passing tests, covering rejected deposits, unchanged escrow balances,
deadline boundaries and valid top-up recovery. Contract lint also passes.
The separate `hardhat:check-types` command now passes after adding generated
contract and event types to the evidence and demo scripts. Run `hardhat:compile`
first on a fresh checkout to generate those types. The transaction-producing
scripts have not been rerun on testnet as part of that typing fix. Frontend type
checking, the production build and targeted navigation/form/retry browser
checks also passed. This is not a fresh public scaffold or a security review;
the full harness has not been rerun on the current edits.

Optional live measurement (network-dependent, no wallet transaction):

```sh
node .yarn/releases/yarn-3.2.3.cjs next:test:live
```

[EVIDENCE.md](EVIDENCE.md) records deployment addresses and successful/rejected
transactions from 21 September 2026. The
[recorded settlement](https://hashscan.io/testnet/transaction/0x2e00806f0ea3b3ed72f45df64bae1e51b44f5de80c6105f18906fca71adcc968)
was independently checked as successful during this local review. Other records
and historical verification claims are not a new validation of every linked
transaction or later source edit.

`lifecycle` and `failures` reproduce transaction scenarios with configured
testnet credentials and spend HBAR. They are not needed for read-only review.
[NOTES-failures.md](NOTES-failures.md) contains historical debugging notes;
apply machine-specific workarounds only after reproducing their symptoms.

## External template and submission

Once the owner chooses to publish a public repository, consumers can scaffold
from it by replacing `OWNER/REPOSITORY` in this command:

```sh
npm create scaffold-hbar@latest -- --template OWNER/REPOSITORY
```

This is a future publication step, not a working reference to a published copy
of this local project. Verify the actual scaffold output and repeat install,
lint, build and route checks from that fresh copy before submission.
The manifest is [template.json](template.json).

Harness configuration is in [.harness](.harness/). Run its configured checks with:

```sh
node .yarn/releases/yarn-3.2.3.cjs exec hedera-harness validate
```

The static validator rejects certain local `.env` files even when Git ignores
them. Use a clean checkout without private environment files for the gate.
Do not delete credentials or weaken the validator to obtain a pass.
A `routes=0` result needs its detailed error inspected; it does not by itself
identify a code defect or machine problem.

See the [official bounty brief](https://hedera.com/blog/scaffold-hbar-template-bounty/)
for submission requirements. Publication remains the owner's decision.

## Licence and credits

MIT; see [LICENSE](LICENSE). Built on
[scaffold-hbar](https://github.com/hashgraph/scaffold-hbar), using Chainlink
price feeds on Hedera testnet. See [AGENTS.md](AGENTS.md) for coding guidance.
