// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IAggregatorV3
/// @notice The subset of Chainlink's AggregatorV3Interface this template uses.
///
/// @dev Declared locally rather than pulled from @chainlink/contracts on
///      purpose: this template needs four functions, and adding the package
///      drags in a dependency tree that has caused peer-conflict trouble on
///      Hedera builds. The ABI is stable and public.
///
///      `answer` is signed. A negative price is nonsense for the feeds here
///      but the interface permits it, so ChainlinkPriceSource rejects it
///      explicitly rather than casting and hoping.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    /// @return roundId        The round the answer belongs to.
    /// @return answer         The price, at `decimals()` precision. SIGNED.
    /// @return startedAt      When the round opened.
    /// @return updatedAt      When the answer was last written. The value that
    ///                        actually matters for staleness.
    /// @return answeredInRound The round the answer was computed in. Older than
    ///                        roundId means a carried-over answer.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
