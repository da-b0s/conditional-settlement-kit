// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IPriceSource
/// @author Opeyemi Ayeni (da-b0s)
/// @notice The seam. Settlement depends on this and never on Chainlink.
///
/// @dev This interface is the reason this repository is a template rather than
///      one application. `setPriceSource(asset, source)` lets a developer swap
///      Chainlink for Supra or Pyth without touching a line of settlement
///      logic, because settlement only ever sees an Observation.
///
///      NOT A REIMPLEMENTATION OF THE OFFICIAL ORACLES TEMPLATE.
///      Hedera already ships `oracles`, which normalises Chainlink, Supra and
///      Pyth behind one interface and reads prices. It is good, and rebuilding
///      it would invite exactly the comparison this template should not invite.
///      The original contribution here starts AFTER the read: the policy state
///      machine, the settlement guarantees, the evidence trail, and the
///      per-feed freshness bound this interface insists on.
interface IPriceSource {
    /// @notice A single price reading, already normalised and already judged.
    /// @param value     The price, normalised to 18 decimals.
    /// @param observedAt The feed's own updatedAt, in seconds.
    /// @param feedId    Opaque identifier of the feed that produced it.
    struct Observation {
        uint256 value;
        uint64 observedAt;
        bytes32 feedId;
    }

    /// @notice Read the current price for an asset.
    /// @dev MUST revert rather than return a stale or unregistered reading.
    ///      Returning a flag instead of reverting is how a caller ends up
    ///      settling on a price it was warned about — the same mistake as
    ///      ignoring an HTS int64 response code.
    /// @param asset The asset key, e.g. keccak256("HBAR/USD").
    /// @return observation A reading that has already passed the source's
    ///         freshness and decimal checks.
    function latest(bytes32 asset) external view returns (Observation memory observation);

    /// @notice The staleness bound this source applies to one asset, in seconds.
    /// @dev Exposed so a UI can state the bound it is trusting, and so a test
    ///      can assert the bound is per-asset rather than global. A source that
    ///      returns the same number for every asset is a source that has not
    ///      understood the problem — see feeds.ts for the measurement.
    function maxAgeOf(bytes32 asset) external view returns (uint64 seconds_);

    /// @notice Whether this source can price the asset at all.
    /// @dev Named supportsAsset rather than supports: the latter is reserved
    ///      in Solidity and will not compile.
    function supportsAsset(bytes32 asset) external view returns (bool);
}
