import { useAccount, useSwitchChain } from "wagmi";
import { ArrowsRightLeftIcon } from "@heroicons/react/24/solid";
import { getTargetNetworks } from "~~/utils/scaffold-hbar";

type NetworkOptionsProps = { hidden?: boolean; onSwitched?: () => void };
export const NetworkOptions = ({ hidden = false, onSwitched }: NetworkOptionsProps) => {
  const { switchChain, isPending, error } = useSwitchChain();
  const { chain } = useAccount();
  // Only networks this app is configured for — Hedera testnet.
  const alternatives = getTargetNetworks().filter(network => network.id !== chain?.id);
  if (hidden) return null;
  return (
    <>
      {alternatives.length === 0 && (
        <li>
          <span className="text-sm">No other networks available for this wallet.</span>
        </li>
      )}
      {alternatives.map(network => (
        <li key={network.id}>
          <button
            className="btn btn-ghost btn-sm justify-start text-base-content"
            disabled={isPending}
            onClick={() => switchChain({ chainId: network.id }, { onSuccess: onSwitched })}
          >
            <ArrowsRightLeftIcon className="h-4 w-4" />
            {isPending ? "Switching..." : `Switch to ${network.name}`}
          </button>
        </li>
      ))}
      {error && (
        <li>
          <span role="alert" className="text-error text-sm">
            Switch was not completed. Select Hedera Testnet in your wallet and reconnect.
          </span>
        </li>
      )}
    </>
  );
};
