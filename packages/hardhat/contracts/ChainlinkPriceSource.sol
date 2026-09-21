// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IPriceSource } from "./IPriceSource.sol";
import { IAggregatorV3 } from "./interfaces/IAggregatorV3.sol";

/// @title ChainlinkPriceSource
/// @author Opeyemi Ayeni (da-b0s)
/// @notice One IPriceSource implementation, done properly, with a staleness
///         bound that belongs to the feed rather than to the system.
///
/// @dev WHY PER-FEED BOUNDS, MEASURED RATHER THAN ASSUMED
///
///      All seven Chainlink feeds on Hedera testnet declare the same
///      86,400-second heartbeat. Read live on 21 September 2026, their actual
///      ages spanned more than a hundredfold — LINK at 12 minutes, DAI at
///      23.1 hours — and every single one was inside spec.
///
///      A single global maxAge fails in both directions against that:
///
///        Tight (1h):  rejects USDC, USDT and DAI, all three healthy.
///        Loose (24h): accepts an HBAR/USD price twenty-three hours old,
///                     roughly a hundred updates behind, and settles on it.
///
///      The second failure is the dangerous one, because nothing looks wrong.
///      The feed is inside its declared heartbeat, the call succeeds, and the
///      money moves on yesterday's price.
///
///      So maxAge is stored per asset and there is deliberately no global
///      default. Registering a feed without a bound is impossible.
contract ChainlinkPriceSource is IPriceSource {
    /// @notice EVM amounts are composed at 18 decimals.
    uint8 public constant TARGET_DECIMALS = 18;

    /// @notice An upper limit on any configured bound, so a careless call
    ///         cannot disable staleness checking entirely by passing a huge
    ///         number. Two days: longer than any declared heartbeat here.
    uint64 public constant MAX_CONFIGURABLE_AGE = 172_800;

    struct Feed {
        IAggregatorV3 aggregator;
        uint64 maxAge;
        uint8 decimals;
        bool registered;
    }

    address public owner;
    mapping(bytes32 => Feed) private _feeds;

    event FeedRegistered(bytes32 indexed asset, address indexed aggregator, uint64 maxAge, uint8 decimals);
    event FeedRemoved(bytes32 indexed asset);
    event OwnerChanged(address indexed from, address indexed to);

    error NotOwner();
    error ZeroAddress();
    error FeedNotRegistered(bytes32 asset);
    error MaxAgeRequired();
    error MaxAgeTooLarge(uint64 given, uint64 limit);
    /// @dev Carries the numbers so a caller can see how stale, against what.
    error ObservationStale(bytes32 asset, uint256 updatedAt, uint256 nowTs, uint64 maxAge);
    error NegativePrice(bytes32 asset, int256 answer);
    error IncompleteRound(bytes32 asset, uint80 roundId, uint80 answeredInRound);
    error DecimalsTooLarge(uint8 reported, uint8 target);
    error DecimalsChanged(bytes32 asset, uint8 registered, uint8 nowReported);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnerChanged(address(0), msg.sender);
    }

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        emit OwnerChanged(owner, to);
        owner = to;
    }

    /// @notice Register a feed with its own staleness bound.
    /// @dev maxAge has no default. Passing zero reverts, because the most
    ///      likely reason a caller omits it is that they have not thought
    ///      about it — and a silent global default is the bug this contract
    ///      exists to prevent.
    /// @param asset  Asset key, e.g. keccak256("HBAR/USD").
    /// @param aggregator The Chainlink proxy address.
    /// @param maxAge Seconds after which a reading for THIS asset is stale.
    function registerFeed(bytes32 asset, address aggregator, uint64 maxAge) external onlyOwner {
        if (aggregator == address(0)) revert ZeroAddress();
        if (maxAge == 0) revert MaxAgeRequired();
        if (maxAge > MAX_CONFIGURABLE_AGE) revert MaxAgeTooLarge(maxAge, MAX_CONFIGURABLE_AGE);

        // Read decimals at registration and pin them. A feed that changes its
        // decimals later would otherwise silently rescale every price.
        uint8 dec = IAggregatorV3(aggregator).decimals();
        if (dec > TARGET_DECIMALS) revert DecimalsTooLarge(dec, TARGET_DECIMALS);

        _feeds[asset] = Feed({
            aggregator: IAggregatorV3(aggregator),
            maxAge: maxAge,
            decimals: dec,
            registered: true
        });
        emit FeedRegistered(asset, aggregator, maxAge, dec);
    }

    function removeFeed(bytes32 asset) external onlyOwner {
        if (!_feeds[asset].registered) revert FeedNotRegistered(asset);
        delete _feeds[asset];
        emit FeedRemoved(asset);
    }

    /// @inheritdoc IPriceSource
    function supportsAsset(bytes32 asset) external view returns (bool) {
        return _feeds[asset].registered;
    }

    /// @inheritdoc IPriceSource
    function maxAgeOf(bytes32 asset) external view returns (uint64) {
        Feed storage f = _feeds[asset];
        if (!f.registered) revert FeedNotRegistered(asset);
        return f.maxAge;
    }

    /// @inheritdoc IPriceSource
    /// @dev Reverts on every condition a caller must not settle against. It
    ///      never returns a flag alongside a usable-looking number, because a
    ///      caller that ignores the flag is the failure mode this guards.
    function latest(bytes32 asset) external view returns (Observation memory) {
        Feed storage f = _feeds[asset];
        if (!f.registered) revert FeedNotRegistered(asset);

        (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = f.aggregator.latestRoundData();

        // A carried-over answer from an older round is not a fresh reading,
        // however recent updatedAt looks.
        if (answeredInRound < roundId) revert IncompleteRound(asset, roundId, answeredInRound);
        if (answer <= 0) revert NegativePrice(asset, answer);

        // The decimals pinned at registration must still hold.
        uint8 nowDec = f.aggregator.decimals();
        if (nowDec != f.decimals) revert DecimalsChanged(asset, f.decimals, nowDec);

        // THE CHECK THIS CONTRACT EXISTS FOR.
        if (block.timestamp > updatedAt + f.maxAge) {
            revert ObservationStale(asset, updatedAt, block.timestamp, f.maxAge);
        }

        // Widening 8 -> 18 is exact. Doing it implicitly elsewhere is how a
        // price lands 10^10 out, which is the same class of error as
        // confusing tinybar with weibar.
        uint256 scaled = uint256(answer) * (10 ** uint256(TARGET_DECIMALS - f.decimals));

        return Observation({ value: scaled, observedAt: uint64(updatedAt), feedId: asset });
    }
}
