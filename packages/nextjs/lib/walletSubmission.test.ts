import { submitEvmTransaction } from "./walletSubmission";
import { describe, expect, it, vi } from "vitest";

const tx = {
  from: "0x0000000000000000000000000000000000000001",
  to: "0x0000000000000000000000000000000000000002",
  data: "0x12345678",
  gas: 100_000n,
  value: 10n ** 18n,
} as const;
const hash = `0x${"a".repeat(64)}` as const;
describe("EVM wallet submission", () => {
  it("sends one standard wallet request with exact weibar value and gas", async () => {
    const request = vi.fn().mockResolvedValue(hash);
    expect(await submitEvmTransaction(request, tx)).toBe(hash);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      method: "eth_sendTransaction",
      params: [{ from: tx.from, to: tx.to, data: tx.data, value: "0xde0b6b3a7640000", gas: "0x186a0" }],
    });
  });
  it.each([4001, 4200, -32601, -32602])("does not resubmit or replace the original error (%s)", async code => {
    const error = Object.assign(new Error("Original wallet failure"), { code });
    const request = vi.fn().mockRejectedValue(error);
    await expect(submitEvmTransaction(request, tx)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("sends zero value for non-payable actions", async () => {
    const request = vi.fn().mockResolvedValue(hash);
    await submitEvmTransaction(request, { ...tx, value: undefined });
    expect(request.mock.calls[0][0].params[0].value).toBe("0x0");
  });
});
