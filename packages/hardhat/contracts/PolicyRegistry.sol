// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title PolicyRegistry
/// @author Opeyemi Ayeni (da-b0s)
/// @notice Policy creation, funding, and the state machine. Holds the escrow.
///
/// @dev THE STATE MACHINE IS THE SAFETY ARGUMENT
///
///        draft --fund--> active --threshold crossed--> triggered --settle--> settled
///                          |                                                   (terminal)
///                          +-- expiry reached --> expired --refund--> refunded
///                                                                     (terminal)
///
///      `settled` and `refunded` are both terminal and there is no path
///      between them. That is invariant I5, and it is enforced here by the
///      transition guard rather than by callers remembering to check.
///
///      Escrow lives in THIS contract, not in Settlement. Settlement decides
///      whether a payout is owed; the registry is the only thing that can move
///      value, and only along a legal transition. Splitting it that way means
///      a bug in trigger validation cannot drain an escrow on its own.
contract PolicyRegistry {
    enum State {
        None,
        Draft,
        Active,
        Triggered,
        Settled,
        Expired,
        Refunded
    }

    struct Policy {
        address creator;
        address beneficiary;
        bytes32 asset;
        /// @dev Payout owed if the condition is met. Never exceeds escrow (I3).
        uint256 maxPayout;
        /// @dev Value actually held for this policy.
        uint256 escrow;
        /// @dev Price, 18dp, at or beyond which the condition is met.
        uint256 threshold;
        /// @dev True: trigger when price >= threshold. False: price <= threshold.
        bool triggerAbove;
        uint64 expiry;
        State state;
        /// @dev The observation that triggered it, kept for the evidence trail.
        uint64 triggeredAt;
        uint256 triggerPrice;
    }

    address public owner;
    /// @notice The only address allowed to move a policy into Triggered.
    address public settlement;

    uint256 public nextPolicyId = 1;
    mapping(uint256 => Policy) private _policies;

    /// @notice Total value this contract is holding on behalf of policies.
    /// @dev Tracked explicitly so a test can assert the contract is never
    ///      holding less than it owes. Comparing against address(this).balance
    ///      alone would be fooled by a forced send.
    uint256 public totalEscrowed;

    event PolicyCreated(
        uint256 indexed policyId,
        address indexed creator,
        address indexed beneficiary,
        bytes32 asset,
        uint256 threshold,
        bool triggerAbove,
        uint256 maxPayout,
        uint64 expiry
    );
    event PolicyFunded(uint256 indexed policyId, uint256 amount, uint256 escrow);
    event PolicyTriggered(uint256 indexed policyId, uint256 price, uint64 observedAt);
    event PolicySettled(uint256 indexed policyId, address indexed beneficiary, uint256 amount);
    event PolicyExpired(uint256 indexed policyId);
    event PolicyRefunded(uint256 indexed policyId, address indexed creator, uint256 amount);
    event SettlementChanged(address indexed from, address indexed to);
    event OwnerChanged(address indexed from, address indexed to);

    error NotOwner();
    error NotSettlement();
    error NotCreator();
    error ZeroAddress();
    error UnknownPolicy(uint256 policyId);
    /// @dev Names both states so a caller can see exactly which move was refused.
    error IllegalTransition(uint256 policyId, State from, State to);
    error PayoutExceedsEscrow(uint256 policyId, uint256 maxPayout, uint256 escrow);
    error ExpiryInPast(uint64 expiry, uint256 nowTs);
    error NotYetExpired(uint256 policyId, uint64 expiry, uint256 nowTs);
    error AlreadyExpired(uint256 policyId, uint64 expiry, uint256 nowTs);
    error NothingToFund();
    error TransferFailed(address to, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlySettlement() {
        if (msg.sender != settlement) revert NotSettlement();
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

    function setSettlement(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        emit SettlementChanged(settlement, to);
        settlement = to;
    }

    // ---------------------------------------------------------------------
    // The transition guard. Every state change goes through here.
    // ---------------------------------------------------------------------

    /// @dev The single place a State may change. Mirrors ALLOWED_TRANSITIONS
    ///      in lib/settlement/invariants.ts — the two are kept in step
    ///      deliberately so the UI and the chain agree about what is legal.
    function _transition(uint256 policyId, State from, State to) private {
        Policy storage p = _policies[policyId];
        if (p.state != from) revert IllegalTransition(policyId, p.state, to);

        bool legal = (from == State.Draft && to == State.Active) ||
            // So every policy can reach a terminal state. See expire().
            (from == State.Draft && to == State.Expired) ||
            (from == State.Active && to == State.Triggered) ||
            (from == State.Active && to == State.Expired) ||
            (from == State.Triggered && to == State.Settled) ||
            (from == State.Expired && to == State.Refunded);

        // Settled and Refunded appear on no left-hand side above. That is I5:
        // both are terminal, and neither can reach the other.
        if (!legal) revert IllegalTransition(policyId, from, to);
        p.state = to;
    }

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------

    function createPolicy(
        address beneficiary,
        bytes32 asset,
        uint256 threshold,
        bool triggerAbove,
        uint256 maxPayout,
        uint64 expiry
    ) external returns (uint256 policyId) {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (expiry <= block.timestamp) revert ExpiryInPast(expiry, block.timestamp);

        policyId = nextPolicyId++;
        _policies[policyId] = Policy({
            creator: msg.sender,
            beneficiary: beneficiary,
            asset: asset,
            maxPayout: maxPayout,
            escrow: 0,
            threshold: threshold,
            triggerAbove: triggerAbove,
            expiry: expiry,
            state: State.Draft,
            triggeredAt: 0,
            triggerPrice: 0
        });

        emit PolicyCreated(policyId, msg.sender, beneficiary, asset, threshold, triggerAbove, maxPayout, expiry);
    }

    /// @notice Fund the escrow and activate. I3 is enforced at this boundary.
    /// @dev A policy cannot become Active while it promises more than it holds.
    ///      Checking here rather than at settlement means the beneficiary can
    ///      read `state == Active` and know the money is actually present.
    function fund(uint256 policyId) external payable {
        Policy storage p = _policies[policyId];
        if (p.state == State.None) revert UnknownPolicy(policyId);
        if (msg.value == 0) revert NothingToFund();

        p.escrow += msg.value;
        totalEscrowed += msg.value;
        emit PolicyFunded(policyId, msg.value, p.escrow);

        if (p.state == State.Draft) {
            if (p.maxPayout > p.escrow) revert PayoutExceedsEscrow(policyId, p.maxPayout, p.escrow);
            _transition(policyId, State.Draft, State.Active);
        }
    }

    /// @notice Record that the condition was met. Settlement only.
    /// @dev Deliberately split from payout. Triggering records a fact;
    ///      settling moves money. Keeping them apart is what lets I1 be a
    ///      state check rather than a bookkeeping flag.
    function markTriggered(uint256 policyId, uint256 price, uint64 observedAt) external onlySettlement {
        Policy storage p = _policies[policyId];
        if (p.state == State.None) revert UnknownPolicy(policyId);
        // An expired policy must not trigger, even if the price qualifies.
        if (block.timestamp >= p.expiry) revert AlreadyExpired(policyId, p.expiry, block.timestamp);

        _transition(policyId, State.Active, State.Triggered);
        p.triggeredAt = observedAt;
        p.triggerPrice = price;
        emit PolicyTriggered(policyId, price, observedAt);
    }

    /// @notice Pay the beneficiary. Settlement only, and only once.
    /// @dev I1 holds because Triggered -> Settled is the only legal move out
    ///      of Triggered, and _transition rejects a second attempt with
    ///      IllegalTransition. No separate "paid" boolean to forget to set.
    function settle(uint256 policyId) external onlySettlement returns (uint256 amount) {
        Policy storage p = _policies[policyId];
        if (p.state == State.None) revert UnknownPolicy(policyId);

        _transition(policyId, State.Triggered, State.Settled);

        // I3: never more than is held, even if maxPayout were somehow larger.
        amount = p.maxPayout > p.escrow ? p.escrow : p.maxPayout;

        // Effects before interaction.
        p.escrow -= amount;
        totalEscrowed -= amount;

        uint256 remainder = p.escrow;
        if (remainder > 0) {
            p.escrow = 0;
            totalEscrowed -= remainder;
        }

        emit PolicySettled(policyId, p.beneficiary, amount);

        _send(p.beneficiary, amount);
        // Anything over the payout goes back to whoever funded it.
        if (remainder > 0) _send(p.creator, remainder);
    }

    /// @notice Move a policy to Expired once its deadline has passed.
    /// @dev Permissionless on purpose: expiry is a fact about the clock, not a
    ///      privilege. HSS schedules a call to this, but anyone may push it so
    ///      a beneficiary is never stuck waiting on a scheduler.
    /// @notice Expire a policy whose deadline has passed. Permissionless.
    /// @dev Accepts BOTH Draft and Active, so every policy can reach a
    ///      terminal state.
    ///
    ///      NO ESCROW IS AT RISK EITHER WAY, and it is worth being precise
    ///      about why, because the obvious worry here is wrong. fund()
    ///      reverts outright when a payment would leave a Draft policy still
    ///      short of maxPayout, and the revert rolls back the escrow
    ///      increment with it. A Draft policy therefore holds exactly zero,
    ///      always; partial funding is not a state this contract can be in.
    ///
    ///      What this edge is for is abandoned drafts: a policy created and
    ///      never funded would otherwise sit in Draft forever, with no
    ///      caller able to move it and no terminal state to reach.
    ///
    ///      I5 is unaffected: a Draft policy has never been settleable, so
    ///      expiring one cannot race a settlement.
    function expire(uint256 policyId) external {
        Policy storage p = _policies[policyId];
        if (p.state == State.None) revert UnknownPolicy(policyId);
        if (block.timestamp < p.expiry) revert NotYetExpired(policyId, p.expiry, block.timestamp);

        _transition(policyId, p.state == State.Draft ? State.Draft : State.Active, State.Expired);
        emit PolicyExpired(policyId);
    }

    /// @notice Return the escrow after expiry. Creator only.
    function refund(uint256 policyId) external returns (uint256 amount) {
        Policy storage p = _policies[policyId];
        if (p.state == State.None) revert UnknownPolicy(policyId);
        if (msg.sender != p.creator) revert NotCreator();

        _transition(policyId, State.Expired, State.Refunded);

        amount = p.escrow;
        p.escrow = 0;
        totalEscrowed -= amount;

        emit PolicyRefunded(policyId, p.creator, amount);
        _send(p.creator, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        Policy memory p = _policies[policyId];
        if (p.state == State.None) revert UnknownPolicy(policyId);
        return p;
    }

    function stateOf(uint256 policyId) external view returns (State) {
        return _policies[policyId].state;
    }

    /// @notice Does this price meet the policy's condition?
    /// @dev Pure and public so a UI can ask without simulating a transaction,
    ///      and so a test can prove the boundary is inclusive in both
    ///      directions rather than inferring it.
    function conditionMet(uint256 policyId, uint256 price) external view returns (bool) {
        Policy storage p = _policies[policyId];
        if (p.state == State.None) revert UnknownPolicy(policyId);
        return p.triggerAbove ? price >= p.threshold : price <= p.threshold;
    }

    function _send(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{ value: amount }("");
        if (!ok) revert TransferFailed(to, amount);
    }
}
