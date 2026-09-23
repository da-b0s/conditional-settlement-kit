"use client";

import { useState } from "react";
import { HbarInput, HederaAddressInput } from "@scaffold-hbar-ui/components";
import type { Address } from "viem";
import { keccak256, parseUnits, toHex } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";
import { TESTNET_FEEDS } from "~~/lib/settlement/feeds";
import { hbarToContractAmount } from "~~/lib/settlement/units";

/** The asset key the contracts use: keccak256 of the pair name. */
const assetKey = (pair: string) => keccak256(toHex(pair));

/** Sensible default: a week out, well inside the 62-day scheduling limit. */
const defaultExpiry = () => {
  const d = new Date(Date.now() + 7 * 86_400_000);
  // datetime-local wants `YYYY-MM-DDTHH:mm` in LOCAL time, and toISOString
  // returns UTC — using it directly shifts the deadline by the offset.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const PolicyForm = ({ onCreated }: { onCreated: () => void }) => {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  // HederaAddressInput keeps whatever was typed — `0.0.n` or `0x…` — in
  // `value`, and reports the RESOLVED EVM address separately. The contract
  // needs the resolved one; passing the raw text would send a Hedera id where
  // an address belongs.
  const [beneficiaryText, setBeneficiaryText] = useState("");
  const [beneficiary, setBeneficiary] = useState<Address | undefined>();
  const [pair, setPair] = useState(TESTNET_FEEDS[0].pair);
  const [threshold, setThreshold] = useState("");
  const [triggerAbove, setTriggerAbove] = useState(true);
  const [maxPayout, setMaxPayout] = useState("");
  const [expiry, setExpiry] = useState(defaultExpiry);
  const [problem, setProblem] = useState<string | null>(null);

  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "PolicyRegistry" });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);

    // Validate here rather than letting the contract revert. A revert costs
    // gas and names the problem in a language the user did not write in.
    const expirySeconds = Math.floor(new Date(expiry).getTime() / 1000);
    if (!Number.isFinite(expirySeconds)) return setProblem("That deadline is not a date.");
    if (expirySeconds <= Math.floor(Date.now() / 1000)) {
      return setProblem("The deadline is in the past. A policy cannot be created already expired.");
    }
    if (!beneficiary) {
      return setProblem(
        beneficiaryText
          ? `Could not resolve "${beneficiaryText}" to an EVM address. A Hedera id only resolves once the account exists.`
          : "A policy needs a beneficiary — the address that gets paid.",
      );
    }
    if (!threshold || Number(threshold) <= 0) return setProblem("Set a threshold price above zero.");
    if (!maxPayout || Number(maxPayout) <= 0) return setProblem("Set a payout above zero.");

    try {
      await writeContractAsync({
        functionName: "createPolicy",
        args: [
          beneficiary,
          assetKey(pair),
          // Thresholds are compared against a price normalised to 18dp, not
          // against the feed's native 8dp. Parsing at 8 here would be off by
          // ten billion, which is the same shape of mistake as tinybar for
          // weibar and just as invisible.
          parseUnits(threshold, 18),
          triggerAbove,
          // NOT parseEther. maxPayout is compared against msg.value inside
          // the contract, and msg.value on Hedera is TINYBAR (8dp) while a
          // transaction's value field is weibar (18dp). parseEther here
          // overstates the promise by 10^10 and the policy can never
          // activate. See lib/settlement/units.ts.
          hbarToContractAmount(maxPayout, targetNetwork.id),
          BigInt(expirySeconds),
        ],
      });
      onCreated();
      setThreshold("");
    } catch (caught) {
      // useScaffoldWriteContract already surfaces a toast; this keeps the
      // reason next to the form the user is looking at.
      setProblem(caught instanceof Error ? caught.message.split("\n")[0] : String(caught));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-box border border-base-300 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="form-control">
          <span className="label-text mb-1">Beneficiary</span>
          <HederaAddressInput
            value={beneficiaryText}
            onChange={setBeneficiaryText}
            onResolvedEvmChange={setBeneficiary}
            placeholder="0.0.x or 0x… — who gets paid"
          />
          {address && (
            <button
              type="button"
              className="link link-hover mt-1 self-start text-xs text-primary"
              onClick={() => {
                setBeneficiaryText(address);
                setBeneficiary(address);
              }}
            >
              use my address
            </button>
          )}
        </label>

        <label className="form-control">
          <span className="label-text mb-1">Feed</span>
          <select className="select select-bordered" value={pair} onChange={e => setPair(e.target.value)}>
            {TESTNET_FEEDS.map(feed => (
              <option key={feed.pair} value={feed.pair}>
                {feed.pair} — bound {feed.recommendedMaxAgeSeconds / 3600}h
              </option>
            ))}
          </select>
          <span className="mt-1 text-xs text-base-content/50">
            A reading older than this feed&apos;s bound will not settle.
          </span>
        </label>

        <label className="form-control">
          <span className="label-text mb-1">Condition</span>
          <div className="join">
            <button
              type="button"
              className={`btn join-item grow ${triggerAbove ? "btn-primary" : "btn-outline"}`}
              onClick={() => setTriggerAbove(true)}
              aria-pressed={triggerAbove}
            >
              at or above
            </button>
            <button
              type="button"
              className={`btn join-item grow ${!triggerAbove ? "btn-primary" : "btn-outline"}`}
              onClick={() => setTriggerAbove(false)}
              aria-pressed={!triggerAbove}
            >
              at or below
            </button>
          </div>
        </label>

        <label className="form-control">
          <span className="label-text mb-1">Threshold price (USD)</span>
          <input
            type="text"
            inputMode="decimal"
            className="input input-bordered font-mono"
            value={threshold}
            onChange={e => setThreshold(e.target.value)}
            placeholder="0.10"
          />
          <span className="mt-1 text-xs text-base-content/50">In {pair.split("/")[1]}, as the feed reports it.</span>
        </label>

        <label className="form-control">
          <span className="label-text mb-1">Payout</span>
          {/* HbarInput is uncontrolled and reports through onValueChange. It
              offers a USD toggle; valueInNative is always the HBAR figure, so
              reading that means the USD view cannot change what is escrowed. */}
          <HbarInput placeholder="0.0" onValueChange={({ valueInNative }) => setMaxPayout(valueInNative)} />
          <span className="mt-1 text-xs text-base-content/50">
            The escrow must cover this before the policy activates.
          </span>
        </label>

        <label className="form-control">
          <span className="label-text mb-1">Deadline</span>
          <input
            type="datetime-local"
            className="input input-bordered"
            value={expiry}
            onChange={e => setExpiry(e.target.value)}
          />
          <span className="mt-1 text-xs text-base-content/50">
            After this, the policy can be expired and the escrow refunded.
          </span>
        </label>
      </div>

      {problem && (
        <p role="alert" className="text-sm text-error">
          {problem}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={isMining}>
          {isMining && <span className="loading loading-spinner loading-xs" />}
          Create policy
        </button>
        <span className="text-xs text-base-content/60">
          Creating costs gas but escrows nothing. Funding is the next step.
        </span>
      </div>
    </form>
  );
};
