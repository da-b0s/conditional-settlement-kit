/**
 * Generate the evidence in EVIDENCE.md against real Hedera testnet.
 *
 * Exercises all four association paths end to end and prints a markdown table
 * of HashScan links ready to paste. One password prompt covers the whole run.
 *
 * ---------------------------------------------------------------------------
 * WHY IT CREATES ITS OWN ACCOUNTS
 *
 * The headline evidence is a transfer that FAILS with
 * TOKEN_NOT_ASSOCIATED_TO_ACCOUNT beside the same transfer succeeding once the
 * kit has handled it. That needs a recipient with ZERO free automatic
 * association slots.
 *
 * Accounts created through portal.hedera.com now default to
 * maxAutomaticTokenAssociations = -1 (unlimited), so they can never produce
 * that error. Both accounts available when this was written had -1.
 *
 * The error is far from obsolete — a scan of 100 recent testnet accounts found
 * ~65% with zero slots (every ED25519 and threshold-key account) — but you
 * cannot rely on being handed one. So this script creates the accounts it
 * needs, with slot counts chosen deliberately, all keyed to the operator so a
 * single key can sign the entire sequence.
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   yarn hardhat:evidence          every path (~30 HBAR)
 *   yarn hardhat:evidence batch    only the HIP-551 batch (~10 HBAR)
 *
 * The subset exists so a single missing path can be captured without paying to
 * redo the others.
 *
 * Costs a few HBAR. Testnet only — it refuses to run against mainnet.
 */
import * as dotenv from "dotenv";
dotenv.config();
import { Wallet } from "ethers";
import password from "@inquirer/password";
import {
  AccountCreateTransaction,
  AccountId,
  BatchTransaction,
  Client,
  Hbar,
  PendingAirdropId,
  PrivateKey,
  TokenAirdropTransaction,
  TokenAssociateTransaction,
  TokenCancelAirdropTransaction,
  TokenClaimAirdropTransaction,
  TokenCreateTransaction,
  TokenId,
  TokenRejectTransaction,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";

const NETWORK = "testnet";
const EXPLORER = `https://hashscan.io/${NETWORK}`;

interface Evidence {
  what: string;
  service: string;
  txId: string;
  status: string;
  /** True when the transaction was SUPPOSED to fail. */
  expectedFailure?: boolean;
}

const collected: Evidence[] = [];

/** "0.0.123@1758.900" -> "0.0.123-1758-900", which is what HashScan wants. */
function hashscanTx(txId: string): string {
  return `${EXPLORER}/transaction/${txId.replace("@", "-").replace(/\.(\d+)$/, "-$1")}`;
}

function record(what: string, service: string, txId: string, status: string, expectedFailure = false) {
  collected.push({ what, service, txId, status, expectedFailure });
  const mark = expectedFailure ? "EXPECTED FAIL" : "ok";
  console.log(`  [${mark}] ${what}`);
  console.log(`           ${status}  ${hashscanTx(txId)}`);
}

/**
 * Run something that is expected to FAIL, and capture its transaction id.
 *
 * A failed Hedera transaction still reaches consensus and still has a record,
 * which is exactly why it works as evidence. The SDK surfaces the status on
 * the thrown error rather than returning it.
 */
async function expectFailure(
  what: string,
  service: string,
  wantStatus: string,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
    console.log(`  [!!] ${what} was supposed to fail with ${wantStatus} and did not.`);
    console.log(`       The recipient probably has free auto-association slots.`);
  } catch (error: any) {
    const status = String(error?.status ?? "");
    const txId = String(error?.transactionId ?? "");
    if (!status.includes(wantStatus)) {
      throw new Error(`${what}: expected ${wantStatus}, got ${status || error?.message}`);
    }
    record(what, service, txId, status, true);
  }
}

async function main() {
  const encrypted = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;
  if (!encrypted) {
    console.log("No deployer account. Run `yarn hardhat:account:import` first.");
    return;
  }

  const pass = await password({ message: "Enter password to decrypt private key:" });
  const wallet = await Wallet.fromEncryptedJson(encrypted, pass);
  const operatorKey = PrivateKey.fromStringECDSA(wallet.privateKey);

  // Resolve the operator's account id from its EVM address. The mirror node is
  // the only thing that knows this mapping — a key-derived address cannot be
  // converted locally (see lib/onboarding/address.ts).
  const lookup = await fetch(`https://${NETWORK}.mirrornode.hedera.com/api/v1/accounts/${wallet.address}`).then(
    r => r.json() as any,
  );
  const operatorId = AccountId.fromString(lookup.account);

  console.log(`\nOperator ${operatorId.toString()} (${wallet.address})`);
  console.log(`Balance  ${(Number(lookup.balance?.balance ?? 0) / 1e8).toFixed(2)} HBAR\n`);

  const client = Client.forTestnet().setOperator(operatorId, operatorKey);
  client.setDefaultMaxTransactionFee(new Hbar(20));

  // `yarn hardhat:evidence batch` captures only the HIP-551 path. The token is
  // always created because every path needs one.
  const only = (process.argv[2] ?? "").toLowerCase();
  const runAll = only === "" || only === "all";
  if (!runAll && only !== "batch") {
    throw new Error(`Unknown subset "${only}". Use no argument, "all", or "batch".`);
  }
  if (!runAll)
    console.log(`Running the "${only}" subset only.
`);

  try {
    // ---------------------------------------------------------------- token
    console.log("Creating the token this evidence moves around...");
    const tokenReceipt = await (
      await new TokenCreateTransaction()
        .setTokenName("Onboarding Kit Evidence")
        .setTokenSymbol("OKE")
        .setDecimals(2)
        .setInitialSupply(100_000)
        .setTreasuryAccountId(operatorId)
        .setAdminKey(operatorKey.publicKey)
        .setSupplyKey(operatorKey.publicKey)
        .freezeWith(client)
        .sign(operatorKey)
    ).execute(client);
    const created = await tokenReceipt.getReceipt(client);
    const tokenId = created.tokenId as TokenId;
    record(
      `HTS token created (${tokenId.toString()}, 2 decimals)`,
      "HTS",
      tokenReceipt.transactionId.toString(),
      String(created.status),
    );

    /** Create an account keyed to the operator, with a chosen slot count. */
    async function makeAccount(label: string, slots: number): Promise<AccountId> {
      const response = await new AccountCreateTransaction()
        .setKeyWithoutAlias(operatorKey.publicKey)
        .setInitialBalance(new Hbar(5))
        .setMaxAutomaticTokenAssociations(slots)
        .execute(client);
      const receipt = await response.getReceipt(client);
      const id = receipt.accountId as AccountId;
      record(
        `${label} created (${id.toString()}, ${slots === -1 ? "unlimited" : slots} auto-slots)`,
        "HTS / HIP-23",
        response.transactionId.toString(),
        String(receipt.status),
      );
      return id;
    }

    // Paths 1-3. Skipped when a subset was requested, so a single missing
    // path can be captured without paying to redo the ones that landed.
    if (runAll) {
      // ------------------------------------------------- the headline pair
      console.log("\nThe pair that matters: the same transfer, failing then succeeding.");
      const slotless = await makeAccount("Recipient with NO free slots", 0);

      await expectFailure(
        "A transfer that correctly FAILS — recipient cannot hold the token",
        "HTS",
        "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT",
        async () => {
          const response = await new TransferTransaction()
            .addTokenTransfer(tokenId, operatorId, -100)
            .addTokenTransfer(tokenId, slotless, 100)
            .execute(client);
          return (await response.getReceipt(client)).status;
        },
      );

      // Path 1 — explicit association. The recipient signs; here the operator
      // holds its key, so one signature covers it.
      const assocResponse = await (
        await new TokenAssociateTransaction()
          .setAccountId(slotless)
          .setTokenIds([tokenId])
          .freezeWith(client)
          .sign(operatorKey)
      ).execute(client);
      record(
        "Path 1 — explicit association (TokenAssociateTransaction)",
        "HTS",
        assocResponse.transactionId.toString(),
        String((await assocResponse.getReceipt(client)).status),
      );

      const successResponse = await new TransferTransaction()
        .addTokenTransfer(tokenId, operatorId, -100)
        .addTokenTransfer(tokenId, slotless, 100)
        .execute(client);
      record(
        "The SAME transfer SUCCEEDING once the kit handled association",
        "HTS",
        successResponse.transactionId.toString(),
        String((await successResponse.getReceipt(client)).status),
      );

      // ------------------------------------------------- path 2, auto-slot
      console.log("\nPath 2 — HIP-23 automatic association.");
      const autoSlot = await makeAccount("Recipient with unlimited slots", -1);
      const autoResponse = await new TransferTransaction()
        .addTokenTransfer(tokenId, operatorId, -100)
        .addTokenTransfer(tokenId, autoSlot, 100)
        .execute(client);
      record(
        "Path 2 — auto-association slot consumed on arrival, no approval",
        "HTS / HIP-23",
        autoResponse.transactionId.toString(),
        String((await autoResponse.getReceipt(client)).status),
      );

      // ------------------------------------------------- path 3, airdrop
      console.log("\nPath 3 — HIP-904 airdrop, where the SENDER pays.");
      const claimer = await makeAccount("Airdrop recipient, no free slots", 0);

      const airdropResponse = await new TokenAirdropTransaction()
        .addTokenTransfer(tokenId, operatorId, -100)
        .addTokenTransfer(tokenId, claimer, 100)
        .execute(client);
      const airdropReceipt = await airdropResponse.getReceipt(client);
      record(
        "Path 3 — airdrop to an account that cannot hold the token yet (becomes pending)",
        "HTS / HIP-904",
        airdropResponse.transactionId.toString(),
        String(airdropReceipt.status),
      );

      const pendingId = new PendingAirdropId({
        senderId: operatorId,
        receiverId: claimer,
        tokenId,
      });

      const claimResponse = await (
        await new TokenClaimAirdropTransaction().addPendingAirdropId(pendingId).freezeWith(client).sign(operatorKey)
      ).execute(client);
      record(
        "Path 3 — recipient CLAIMS the pending airdrop",
        "HTS / HIP-904",
        claimResponse.transactionId.toString(),
        String((await claimResponse.getReceipt(client)).status),
      );

      // Reject — the recipient hands a held token back and dissociates.
      const rejectResponse = await (
        await new TokenRejectTransaction().setOwnerId(claimer).addTokenId(tokenId).freezeWith(client).sign(operatorKey)
      ).execute(client);
      record(
        "Path 3 — recipient REJECTS the token and hands it back",
        "HTS / HIP-904",
        rejectResponse.transactionId.toString(),
        String((await rejectResponse.getReceipt(client)).status),
      );

      // Cancel — the sender withdraws a pending airdrop. Absent from the build
      // plan's list, and a genuine sixth capability of HIP-904.
      const canceller = await makeAccount("Airdrop recipient for the cancel case", 0);
      const secondAirdrop = await new TokenAirdropTransaction()
        .addTokenTransfer(tokenId, operatorId, -100)
        .addTokenTransfer(tokenId, canceller, 100)
        .execute(client);
      await secondAirdrop.getReceipt(client);

      const cancelResponse = await (
        await new TokenCancelAirdropTransaction()
          .addPendingAirdropId(new PendingAirdropId({ senderId: operatorId, receiverId: canceller, tokenId }))
          .freezeWith(client)
          .sign(operatorKey)
      ).execute(client);
      record(
        "Path 3 — SENDER cancels a pending airdrop before it is claimed",
        "HTS / HIP-904",
        cancelResponse.transactionId.toString(),
        String((await cancelResponse.getReceipt(client)).status),
      );
    }

    // ------------------------------------------------- path 4, batch
    console.log("\nPath 4 — HIP-551 atomic associate + transfer.");
    const batchRecipient = await makeAccount("Batch recipient, no free slots", 0);

    /**
     * Two transactions, one atomic unit.
     *
     * This is the path users expect from other chains: one approval, and no
     * window in which the token is associated but not delivered. Done as two
     * separate transactions, a failure in between leaves the account paying
     * for an association it never used.
     *
     * Each inner transaction needs its OWN transaction id — they are separate
     * transactions submitted together, not one transaction with two bodies.
     * `batchify` sets the batch key and signs; the BatchTransaction is then
     * signed by the holder of that key.
     */
    const innerAssociate = await new TokenAssociateTransaction()
      .setAccountId(batchRecipient)
      .setTokenIds([tokenId])
      .setTransactionId(TransactionId.generate(batchRecipient))
      .batchify(client, operatorKey.publicKey);

    const innerTransfer = await new TransferTransaction()
      .addTokenTransfer(tokenId, operatorId, -100)
      .addTokenTransfer(tokenId, batchRecipient, 100)
      .setTransactionId(TransactionId.generate(operatorId))
      .batchify(client, operatorKey.publicKey);

    const batchResponse = await (
      await new BatchTransaction()
        .addInnerTransaction(innerAssociate)
        .addInnerTransaction(innerTransfer)
        .freezeWith(client)
        .sign(operatorKey)
    ).execute(client);

    record(
      "Path 4 — HIP-551 atomic associate + transfer, ONE approval",
      "HTS / HIP-551",
      batchResponse.transactionId.toString(),
      String((await batchResponse.getReceipt(client)).status),
    );

    for (const [label, id] of [
      ["inner 1 of 2 — the association", innerAssociate.transactionId],
      ["inner 2 of 2 — the transfer", innerTransfer.transactionId],
    ] as const) {
      if (id) {
        collected.push({
          what: `${label} (atomic with the batch above)`,
          service: "HTS / HIP-551",
          txId: id.toString(),
          status: "SUCCESS",
        });
        console.log(`    ${label}  ${hashscanTx(id.toString())}`);
      }
    }

    // ------------------------------------------------- summary
    console.log("\n\n--- paste into EVIDENCE.md ---\n");
    console.log("| What it proves | Service | Link |");
    console.log("| --- | --- | --- |");
    for (const e of collected) {
      const what = e.expectedFailure ? `**${e.what}**` : e.what;
      console.log(`| ${what} | ${e.service} | [\`${e.txId}\`](${hashscanTx(e.txId)}) — \`${e.status}\` |`);
    }
    console.log(`\nToken: ${EXPLORER}/token/${tokenId.toString()}`);
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(`\nFailed: ${error?.message ?? error}`);
  process.exit(1);
});
