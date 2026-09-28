# Start here

Talon demonstrates price-triggered HBAR escrow on Hedera testnet. It is a
Scaffold-HBAR template, built for the Scaffold-HBAR template bounty.
Start with the read-only pages; wallet transactions and operator setup can wait.

## 1. Run the frontend

Install Node 20.18.3 or later. Open a terminal in the extracted or cloned
`talon` folder, then run:

```sh
node .yarn/releases/yarn-3.2.3.cjs install --immutable
node .yarn/releases/yarn-3.2.3.cjs next:dev
```

Open [localhost:3000](http://localhost:3000). Yarn is included; no global install
or administrator setup is needed. No private key, wallet, environment file or
redeployment is required to browse. Live reads need internet access.
First installation and development-page compilation can take several minutes.
Stop the server with Ctrl+C.

## 2. Inspect the demo

| Page | What to check |
| --- | --- |
| Home | What Talon does, in one sentence |
| How it works | The lifecycle, an FAQ and the guarantees |
| Feeds | Live prices, reading ages and configured freshness limits |
| Evidence | Opens on topic `0.0.10752744`, the recorded demo trail |
| Policies | Review the flow; connect a funded testnet wallet when ready to transact |

Reaching a price threshold does not automatically send a settlement transaction.
Someone must submit it. Refunds also require transactions. HCS publication is
a separate operator task and can lag behind contract events.

## 3. Use production mode for a presentation

Stop the development server first, then run:

```sh
node .yarn/releases/yarn-3.2.3.cjs next:build
node .yarn/releases/yarn-3.2.3.cjs next:serve
```

This avoids development compilation on first visits. Live network reads can
still take time; Feeds and Evidence show progress and retry options.
`next:start` runs development mode here; use `next:serve` above.

## 4. Before changing configuration

- Inspect the included testnet deployment without redeploying it.
- The app and contracts target Hedera testnet only. Surplus escrow from a
  settled policy is claimed with **Withdraw** on the Policies page.
- A clean clone has no private `.env`. Treat credentials supplied in an archive
  as exposed; use your own testnet account for writes.
- Do not publish private environment files. Public topic IDs are configuration;
  operator private keys are not frontend configuration.
- Scheduled expiry is an optional helper, not a demonstrated automatic part of
  the policy UI.

Continue with [README.md](README.md) for implemented features, trust assumptions,
tests and operator commands. Use [EVIDENCE.md](EVIDENCE.md)
for transaction links and [AGENTS.md](AGENTS.md) for coding guidance.
