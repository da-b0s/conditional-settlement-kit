// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { PolicyRegistry } from "../PolicyRegistry.sol";

/// @title RejectingCreator
/// @notice TEST ONLY. A policy creator that can refuse HBAR on demand.
/// @dev Models the griefing creator: overfund a policy, refuse the surplus at
///      settlement time so settle() reverts, then accept again once the
///      deadline passes and take the whole escrow back as a refund.
contract RejectingCreator {
    PolicyRegistry public immutable registry;
    bool public rejecting;

    constructor(address registry_) {
        registry = PolicyRegistry(registry_);
    }

    function setRejecting(bool on) external {
        rejecting = on;
    }

    function createAndFund(
        address beneficiary,
        bytes32 asset,
        uint256 threshold,
        bool triggerAbove,
        uint256 maxPayout,
        uint64 expiry
    ) external payable returns (uint256 policyId) {
        policyId = registry.createPolicy(beneficiary, asset, threshold, triggerAbove, maxPayout, expiry);
        registry.fund{ value: msg.value }(policyId);
    }

    function withdraw() external returns (uint256) {
        return registry.withdraw();
    }

    receive() external payable {
        require(!rejecting, "RejectingCreator: refusing HBAR");
    }
}
