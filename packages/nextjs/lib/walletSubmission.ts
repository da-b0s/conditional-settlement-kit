import { type Address, type Hash, type Hex, numberToHex } from "viem";

/** Send exactly once using the EIP-1193 method supported by EVM wallets.
 * Do not probe wallet_sendTransaction after a failed payment request: it can
 * mask the original error and a second submission is unsafe after ambiguity.
 */
export async function submitEvmTransaction(
  request: (args: {
    method: "eth_sendTransaction";
    params: [{ from: Address; to: Address; data: Hex; value: Hex; gas: Hex }];
  }) => Promise<Hash>,
  tx: { from: Address; to: Address; data: Hex; value?: bigint; gas: bigint },
): Promise<Hash> {
  return request({
    method: "eth_sendTransaction",
    params: [
      {
        from: tx.from,
        to: tx.to,
        data: tx.data,
        value: numberToHex(tx.value ?? 0n),
        gas: numberToHex(tx.gas),
      },
    ],
  });
}
