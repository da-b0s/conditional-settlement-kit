import { useEffect, useRef, useState } from "react";
import { MutateOptions } from "@tanstack/react-query";
import { Abi, ExtractAbiFunctionNames } from "abitype";
import { encodeFunctionData } from "viem";
import { Config, UseWriteContractParameters, useAccount, useConfig, useWriteContract } from "wagmi";
import { WriteContractErrorType, WriteContractReturnType, getWalletClient, getPublicClient } from "wagmi/actions";
import { WriteContractVariables } from "wagmi/query";
import { useSelectedNetwork } from "~~/hooks/scaffold-hbar";
import { useDeployedContractInfo, useTransactor } from "~~/hooks/scaffold-hbar";
import { AllowedChainIds, notification } from "~~/utils/scaffold-hbar";
import { submitEvmTransaction } from "~~/lib/walletSubmission";
import {
  ContractAbi,
  ContractName,
  ScaffoldWriteContractOptions,
  ScaffoldWriteContractVariables,
  UseScaffoldWriteConfig,
  simulateContractWriteAndNotifyError,
} from "~~/utils/scaffold-hbar/contract";

type ScaffoldWriteContractReturnType<TContractName extends ContractName> = Omit<
  ReturnType<typeof useWriteContract>,
  "writeContract" | "writeContractAsync"
> & {
  isMining: boolean;
  writeContractAsync: <
    TFunctionName extends ExtractAbiFunctionNames<ContractAbi<TContractName>, "nonpayable" | "payable">,
  >(
    variables: ScaffoldWriteContractVariables<TContractName, TFunctionName>,
    options?: ScaffoldWriteContractOptions,
  ) => Promise<WriteContractReturnType | undefined>;
  writeContract: <TFunctionName extends ExtractAbiFunctionNames<ContractAbi<TContractName>, "nonpayable" | "payable">>(
    variables: ScaffoldWriteContractVariables<TContractName, TFunctionName>,
    options?: Omit<ScaffoldWriteContractOptions, "onBlockConfirmation" | "blockConfirmations">,
  ) => void;
};

export function useScaffoldWriteContract<TContractName extends ContractName>(
  config: UseScaffoldWriteConfig<TContractName>,
): ScaffoldWriteContractReturnType<TContractName>;
/**
 * @deprecated Use object parameter version instead: useScaffoldWriteContract({ contractName: "YourContract" })
 */
export function useScaffoldWriteContract<TContractName extends ContractName>(
  contractName: TContractName,
  writeContractParams?: UseWriteContractParameters,
): ScaffoldWriteContractReturnType<TContractName>;

/**
 * Wrapper around wagmi's useWriteContract hook which automatically loads (by name) the contract ABI and address from
 * the contracts present in deployedContracts.ts & externalContracts.ts corresponding to targetNetworks configured in scaffold.config.ts
 * @param contractName - name of the contract to be written to
 * @param config.chainId - optional chainId that is configured with the scaffold project to make use for multi-chain interactions.
 * @param writeContractParams - wagmi's useWriteContract parameters
 */
export function useScaffoldWriteContract<TContractName extends ContractName>(
  configOrName: UseScaffoldWriteConfig<TContractName> | TContractName,
  writeContractParams?: UseWriteContractParameters,
): ScaffoldWriteContractReturnType<TContractName> {
  const finalConfig =
    typeof configOrName === "string"
      ? { contractName: configOrName, writeContractParams, chainId: undefined }
      : (configOrName as UseScaffoldWriteConfig<TContractName>);
  const { contractName, chainId, writeContractParams: finalWriteContractParams } = finalConfig;

  const wagmiConfig = useConfig();

  useEffect(() => {
    if (typeof configOrName === "string") {
      console.warn(
        "Using `useScaffoldWriteContract` with a string parameter is deprecated. Please use the object parameter version instead.",
      );
    }
  }, [configOrName]);

  const { chain: accountChain } = useAccount();
  const writeTx = useTransactor();
  const [isMining, setIsMining] = useState(false);
  const submitting = useRef(false);

  const wagmiContractWrite = useWriteContract(finalWriteContractParams);

  const selectedNetwork = useSelectedNetwork(chainId);

  const { data: deployedContractData } = useDeployedContractInfo({
    contractName,
    chainId: selectedNetwork.id as AllowedChainIds,
  });

  const sendContractWriteAsyncTx = async <
    TFunctionName extends ExtractAbiFunctionNames<ContractAbi<TContractName>, "nonpayable" | "payable">,
  >(
    variables: ScaffoldWriteContractVariables<TContractName, TFunctionName>,
    options?: ScaffoldWriteContractOptions,
  ) => {
    if (submitting.current) throw new Error("A transaction is already awaiting confirmation.");
    if (!deployedContractData) {
      notification.error(
        "Target Contract is not deployed. Deploy with `yarn hardhat:deploy --network hederaTestnet`.",
      );
      throw new Error("The contract is not available on this network.");
    }

    if (!accountChain?.id) {
      notification.error("Please connect your wallet");
      throw new Error("Please connect your wallet.");
    }

    if (accountChain?.id !== selectedNetwork.id) {
      notification.error(`Wallet is connected to the wrong network. Please switch to ${selectedNetwork.name}`);
      throw new Error(`Please switch to ${selectedNetwork.name}.`);
    }

    try {
      submitting.current = true;
      setIsMining(true);
      const { blockConfirmations, onBlockConfirmation, onSubmitted, ...mutateOptions } = options || {};

      const writeContractObject = {
        abi: deployedContractData.abi as Abi,
        address: deployedContractData.address,
        ...variables,
        chainId: selectedNetwork.id,
      } as WriteContractVariables<Abi, string, any[], Config, number>;

      if (!finalConfig?.disableSimulate) {
        await simulateContractWriteAndNotifyError({
          wagmiConfig,
          writeContractParams: writeContractObject,
          chainId: selectedNetwork.id as AllowedChainIds,
        });
      }

      const makeWriteWithParams = async () => {
        const client = await getWalletClient(wagmiConfig, { chainId: selectedNetwork.id });
        if (selectedNetwork.id === 296 && client.account.type === "json-rpc") {
          if (await client.getChainId() !== selectedNetwork.id) throw new Error("Wallet network changed. Reconnect on Hedera Testnet.");
          const publicClient = getPublicClient(wagmiConfig, { chainId: selectedNetwork.id });
          if (!publicClient) throw new Error("Network connection unavailable.");
          const data = encodeFunctionData({ abi: deployedContractData.abi, functionName: variables.functionName, args: variables.args } as any);
          // Estimate through the public RPC, not through HashPack's signing provider.
          const estimate = variables.gas ?? await publicClient.estimateGas({ account: client.account.address, to: deployedContractData.address, data, value: variables.value });
          return submitEvmTransaction(args => client.request(args), {
            from: client.account.address, to: deployedContractData.address, data,
            value: variables.value, gas: variables.gas ?? (estimate * 120n / 100n),
          });
        }
        return wagmiContractWrite.writeContractAsync(
          writeContractObject,
          mutateOptions as
            | MutateOptions<
                WriteContractReturnType,
                WriteContractErrorType,
                WriteContractVariables<Abi, string, any[], Config, number>,
                unknown
              >
            | undefined,
        );
      };
      const writeTxResult = await writeTx(makeWriteWithParams, { blockConfirmations, onBlockConfirmation, onSubmitted });

      return writeTxResult;
    } catch (e: any) {
      throw e;
    } finally {
      submitting.current = false;
      setIsMining(false);
    }
  };

  const sendContractWriteTx = <
    TContractName extends ContractName,
    TFunctionName extends ExtractAbiFunctionNames<ContractAbi<TContractName>, "nonpayable" | "payable">,
  >(
    variables: ScaffoldWriteContractVariables<TContractName, TFunctionName>,
    options?: Omit<ScaffoldWriteContractOptions, "onBlockConfirmation" | "blockConfirmations">,
  ) => {
    if (!deployedContractData) {
      notification.error(
        "Target Contract is not deployed. Deploy with `yarn hardhat:deploy --network hederaTestnet`.",
      );
      return;
    }
    if (!accountChain?.id) {
      notification.error("Please connect your wallet");
      return;
    }

    if (accountChain?.id !== selectedNetwork.id) {
      notification.error(`Wallet is connected to the wrong network. Please switch to ${selectedNetwork.name}`);
      return;
    }

    wagmiContractWrite.writeContract(
      {
        abi: deployedContractData.abi as Abi,
        address: deployedContractData.address,
        ...variables,
        chainId: selectedNetwork.id,
      } as WriteContractVariables<Abi, string, any[], Config, number>,
      options as
        | MutateOptions<
            WriteContractReturnType,
            WriteContractErrorType,
            WriteContractVariables<Abi, string, any[], Config, number>,
            unknown
          >
        | undefined,
    );
  };

  return {
    ...wagmiContractWrite,
    isMining,
    // Overwrite wagmi's writeContactAsync
    writeContractAsync: sendContractWriteAsyncTx,
    // Overwrite wagmi's writeContract
    writeContract: sendContractWriteTx,
  };
}
