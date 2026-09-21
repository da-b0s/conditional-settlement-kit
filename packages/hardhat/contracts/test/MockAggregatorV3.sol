// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";

/// @title MockAggregatorV3
/// @notice A Chainlink aggregator whose answer, age and decimals are settable.
///
/// @dev TEST ONLY. Never deployed to a live network.
///
///      The freshness invariant (I2) cannot be tested against real feeds:
///      you cannot make Chainlink go stale on demand, and waiting 23 hours
///      for DAI is not a test. This mock exists so every branch of
///      ChainlinkPriceSource.latest() — stale, negative, carried-over round,
///      changed decimals — can be exercised deterministically in under a
///      second.
///
///      It deliberately allows states a real feed should never produce
///      (negative answers, answeredInRound behind roundId, decimals changing
///      after deployment) because those are precisely the conditions the
///      source must refuse.
contract MockAggregatorV3 is IAggregatorV3 {
    uint8 private _decimals;
    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _roundId;
    uint80 private _answeredInRound;
    string private _description;

    constructor(uint8 decimals_, int256 answer_, uint256 updatedAt_) {
        _decimals = decimals_;
        _answer = answer_;
        _updatedAt = updatedAt_;
        _roundId = 1;
        _answeredInRound = 1;
        _description = "mock";
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, _updatedAt, _updatedAt, _answeredInRound);
    }

    // --- test controls -------------------------------------------------

    function setAnswer(int256 answer_) external {
        _answer = answer_;
    }

    function setUpdatedAt(uint256 updatedAt_) external {
        _updatedAt = updatedAt_;
    }

    /// @dev Lets a test make a reading exactly N seconds old relative to the
    ///      chain's own clock, rather than guessing at wall time.
    function setAgeSeconds(uint256 age) external {
        _updatedAt = block.timestamp - age;
    }

    function setDecimals(uint8 decimals_) external {
        _decimals = decimals_;
    }

    /// @dev A carried-over answer: the round advanced but the answer did not.
    function setRounds(uint80 roundId_, uint80 answeredInRound_) external {
        _roundId = roundId_;
        _answeredInRound = answeredInRound_;
    }
}
