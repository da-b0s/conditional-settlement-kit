// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IPriceSource } from "./IPriceSource.sol";
import { PolicyRegistry } from "./PolicyRegistry.sol";

/// @title Settlement
/// @author Opeyemi Ayeni (da-b0s)
/// @notice Validates a trigger against a price source and asks the registry
///         to pay. Holds no value of its own.
///
/// @dev WHY THIS CONTRACT HOLDS NOTHING
///
///      Settlement decides; PolicyRegistry pays. The escrow never sits here,
///      so a mistake in trigger validation cannot drain it directly — the
///      worst it can do is ask the registry for a transition the registry
///      will refuse. Two contracts, two different ways to be wrong, and both
///      have to be wrong at once for money to move incorrectly.
///
///      The price source is swappable (IPriceSource). This contract never
///      mentions Chainlink, which is what makes the template reusable rather
///      than a single application. See IPriceSource for why that seam exists
///      and why the official `oracles` adapter layer is not rebuilt here.
contract Settlement {
    PolicyRegistry public immutable registry;

    address public owner;
    /// @notice Price source per asset. The extension point named in the README.
    mapping(bytes32 => IPriceSource) public priceSourceOf;

    event PriceSourceSet(bytes32 indexed asset, address indexed source);
    event OwnerChanged(address indexed from, address indexed to);
    /// @dev Emitted before the registry is touched, so the evidence trail
    ///      records what was observed even if the transition then fails.
    event TriggerAccepted(uint256 indexed policyId, bytes32 indexed asset, uint256 price, uint64 observedAt);

    error NotOwner();
    error ZeroAddress();
    error NoPriceSource(bytes32 asset);
    error SourceDoesNotSupport(bytes32 asset, address source);
    /// @dev Carries both sides so a caller can see how far off the condition was.
    error ConditionNotMet(uint256 policyId, uint256 price, uint256 threshold, bool triggerAbove);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address registry_) {
        if (registry_ == address(0)) revert ZeroAddress();
        registry = PolicyRegistry(payable(registry_));
        owner = msg.sender;
        emit OwnerChanged(address(0), msg.sender);
    }

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        emit OwnerChanged(owner, to);
        owner = to;
    }

    /// @notice Point an asset at a price source.
    /// @dev Checks the source actually supports the asset at registration
    ///      rather than discovering it at settlement time, when a beneficiary
    ///      is waiting.
    function setPriceSource(bytes32 asset, address source) external onlyOwner {
        if (source == address(0)) revert ZeroAddress();
        if (!IPriceSource(source).supportsAsset(asset)) revert SourceDoesNotSupport(asset, source);
        priceSourceOf[asset] = IPriceSource(source);
        emit PriceSourceSet(asset, source);
    }

    /// @notice Read the price, check the condition, and settle if it holds.
    ///
    /// @dev Permissionless by design. Anyone may push a settlement, because
    ///      the decision rests entirely on what the price source says — not on
    ///      who is asking. A beneficiary should never depend on the creator's
    ///      goodwill to get paid. I4 is upheld by the registry restricting
    ///      `settle` to this contract, not by this contract restricting
    ///      callers.
    ///
    ///      Every reason to refuse comes from the source reverting (stale,
    ///      unregistered, negative, carried-over round) or from the registry
    ///      rejecting the transition (already settled, expired, not active).
    ///      This function adds exactly one check of its own: the threshold.
    function trigger(uint256 policyId) external returns (uint256 paid) {
        PolicyRegistry.Policy memory p = registry.getPolicy(policyId);

        IPriceSource source = priceSourceOf[p.asset];
        if (address(source) == address(0)) revert NoPriceSource(p.asset);

        // Reverts on stale, unregistered, negative or carried-over readings.
        // I2 lives inside this call, in the source, where the per-feed bound is.
        IPriceSource.Observation memory obs = source.latest(p.asset);

        bool met = p.triggerAbove ? obs.value >= p.threshold : obs.value <= p.threshold;
        if (!met) revert ConditionNotMet(policyId, obs.value, p.threshold, p.triggerAbove);

        emit TriggerAccepted(policyId, p.asset, obs.value, obs.observedAt);

        // I1: a second call finds the policy in Settled and the registry
        // refuses the Active -> Triggered move. No flag to forget here.
        registry.markTriggered(policyId, obs.value, obs.observedAt);
        paid = registry.settle(policyId);
    }

    /// @notice What would happen if trigger() were called right now.
    /// @dev A UI should call this before offering the button. It reverts for
    ///      exactly the same reasons trigger() would, so a caller cannot see
    ///      "ready" here and a failure there.
    function preview(uint256 policyId) external view returns (uint256 price, uint64 observedAt, bool conditionMet) {
        PolicyRegistry.Policy memory p = registry.getPolicy(policyId);
        IPriceSource source = priceSourceOf[p.asset];
        if (address(source) == address(0)) revert NoPriceSource(p.asset);

        IPriceSource.Observation memory obs = source.latest(p.asset);
        price = obs.value;
        observedAt = obs.observedAt;
        conditionMet = p.triggerAbove ? obs.value >= p.threshold : obs.value <= p.threshold;
    }
}
