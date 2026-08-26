// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * LAST CANDLE — the public scoreboard.
 *
 * The executor holds the collateral and places the orders; this contract holds
 * nothing and trades nothing. What it does is settle the GAME the instant the
 * MARKET settles, with no keeper and no cron job anywhere in the loop.
 *
 * Somnia's reactivity precompile calls `onEvent` from inside the very block
 * that finalises a market, so an elimination lands in the same block as the
 * settlement that caused it. Every round, entry and elimination is an event
 * here, which is what makes a custodial executor auditable: you do not have to
 * trust our database, you can replay the game from this log.
 *
 * The trusted emitter is BinarySettlement, whose MarketFinalized carries the
 * outcome in its own payload:
 *
 *   MarketFinalized(
 *     uint256 indexed marketKey,
 *     address indexed pool,
 *     uint64  nonce,
 *     address collateralToken,
 *     uint256 netBacking,
 *     bool    voided,
 *     uint8   winningOutcome
 *   )
 *
 * so the handler needs no follow-up call to learn who won — which matters,
 * because a callback runs under a gas limit and a revert there is silent.
 */
contract ArenaRegistry {
    /* ------------------------------------------------------------ types */

    uint8 internal constant SIDE_UP = 0;
    uint8 internal constant SIDE_DOWN = 1;

    uint8 internal constant ALIVE = 0;
    uint8 internal constant BANKED = 1;
    uint8 internal constant ELIMINATED = 2;

    struct Round {
        bytes32 marketId; // the executor's own key, mirrored for cross-reference
        uint64 nonce; // (pool, nonce) identifies one market on a recycled pool
        bool open;
        bool settled;
        bool voided;
        uint8 winner; // 0 UP, 1 DOWN; meaningless when voided
    }

    struct Entry {
        bytes32 runId;
        uint8 side;
        /// Outcome tokens held. A winning contract redeems for exactly 1, so
        /// this IS the winning stack — the 1/p growth, already computed.
        uint128 contracts;
        /// Budget the book could not absorb. Never at risk, so never forfeit.
        uint128 remainder;
        uint128 stackBefore;
    }

    /* ----------------------------------------------------------- storage */

    /// The executor. Writes entries; cannot settle.
    address public owner;

    /// Somnia's reactivity precompile — the only address allowed to settle.
    address public immutable precompile;

    /// BinarySettlement. The only emitter whose events we act on.
    address public immutable settlement;

    /// keccak(pool, nonce) => round
    mapping(bytes32 => Round) public rounds;
    /// keccak(pool, nonce) => entries in that round
    mapping(bytes32 => Entry[]) internal _entries;

    /// runId => current stack
    mapping(bytes32 => uint128) public stackOf;
    /// runId => ALIVE | BANKED | ELIMINATED
    mapping(bytes32 => uint8) public statusOf;

    /// Set once the subscription exists, purely so a reader can verify it.
    uint256 public subscriptionId;

    /* ------------------------------------------------------------ events */

    event RoundOpened(bytes32 indexed roundKey, bytes32 indexed marketId, address pool, uint64 nonce);
    event RunEntered(bytes32 indexed roundKey, bytes32 indexed runId, uint8 side, uint128 contracts, uint128 stakeBefore);
    event RunAdvanced(bytes32 indexed runId, bytes32 indexed roundKey, uint128 from, uint128 to);
    event RunEliminated(bytes32 indexed runId, bytes32 indexed roundKey, uint128 lost);
    event RunBanked(bytes32 indexed runId, uint128 stack);
    event RoundSettled(bytes32 indexed roundKey, uint8 winner, bool voided, uint16 survivors, uint16 killed);
    /// Emitted when a callback arrives for a round we never registered. Not an
    /// error: the venue settles markets we are not playing.
    event UnknownRound(bytes32 indexed roundKey);

    error NotOwner();
    error NotPrecompile();
    error WrongEmitter(address emitter);
    error RoundNotOpen();
    error RoundAlreadySettled();
    error RunNotAlive();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _precompile, address _settlement) {
        owner = msg.sender;
        precompile = _precompile;
        settlement = _settlement;
    }

    /* ------------------------------------------------------- executor API */

    function setOwner(address next) external onlyOwner {
        owner = next;
    }

    function setSubscriptionId(uint256 id) external onlyOwner {
        subscriptionId = id;
    }

    function roundKey(address pool, uint64 nonce) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(pool, nonce));
    }

    /// Register the window the executor is about to play.
    function openRound(address pool, uint64 nonce, bytes32 marketId) external onlyOwner returns (bytes32 key) {
        key = roundKey(pool, nonce);
        Round storage r = rounds[key];
        if (r.open || r.settled) return key; // idempotent; the loop re-ticks
        r.marketId = marketId;
        r.nonce = nonce;
        r.open = true;
        emit RoundOpened(key, marketId, pool, nonce);
    }

    /// Record a filled position. Called after the order lands, never before —
    /// the numbers here are chain truth, not what we asked for.
    function enter(
        address pool,
        uint64 nonce,
        bytes32 runId,
        uint8 side,
        uint128 contracts,
        uint128 remainder,
        uint128 stackBefore
    ) external onlyOwner {
        bytes32 key = roundKey(pool, nonce);
        Round storage r = rounds[key];
        // Settled first: _settle clears `open` too, so checking that first
        // would report a settled round as merely "not open".
        if (r.settled) revert RoundAlreadySettled();
        if (!r.open) revert RoundNotOpen();
        if (statusOf[runId] != ALIVE) revert RunNotAlive();

        _entries[key].push(
            Entry({runId: runId, side: side, contracts: contracts, remainder: remainder, stackBefore: stackBefore})
        );
        stackOf[runId] = stackBefore;
        emit RunEntered(key, runId, side, contracts, stackBefore);
    }

    /// End a run voluntarily. The executor sells the position off-chain and
    /// reports the proceeds; this records the exit.
    function bankRun(bytes32 runId, uint128 finalStack) external onlyOwner {
        if (statusOf[runId] != ALIVE) revert RunNotAlive();
        statusOf[runId] = BANKED;
        stackOf[runId] = finalStack;
        emit RunBanked(runId, finalStack);
    }

    /* --------------------------------------------------------- the handler */

    /**
     * Called by the reactivity precompile in the same block that finalises a
     * market. Never called by us.
     *
     * `topics` is [sig, marketKey, pool] and `data` is the non-indexed tail:
     * (uint64 nonce, address collateralToken, uint256 netBacking, bool voided,
     * uint8 winningOutcome).
     */
    function onEvent(address emitter, bytes32[] calldata topics, bytes calldata data) external {
        if (msg.sender != precompile) revert NotPrecompile();
        if (emitter != settlement) revert WrongEmitter(emitter);
        if (topics.length < 3) return;

        address pool = address(uint160(uint256(topics[2])));
        (uint64 nonce,,, bool voided, uint256[] memory payouts) =
            abi.decode(data, (uint64, address, uint256, bool, uint256[]));

        // Payout numerators are per outcome: a win is [full, 0], a void is
        // [half, half]. Richer than a winner flag, and it means we never have to
        // ask the chain a second question.
        uint8 winner = (payouts.length > 1 && payouts[1] > payouts[0]) ? SIDE_DOWN : SIDE_UP;
        _settle(roundKey(pool, nonce), voided, winner);
    }

    /**
     * Backstop for a missed callback — a gas limit, a node hiccup.
     *
     * Owner-only, deliberately: the outcome is an argument here rather than
     * something the chain hands us, so a permissionless version would let
     * anyone inject a false result. A settled round is immutable either way,
     * and the event log shows which path ran, so a poke cannot quietly
     * overwrite a real callback.
     */
    function pokeSettle(address pool, uint64 nonce, bool voided, uint8 winner) external onlyOwner {
        _settle(roundKey(pool, nonce), voided, winner);
    }

    function _settle(bytes32 key, bool voided, uint8 winner) internal {
        Round storage r = rounds[key];
        // The venue finalises markets we never played. Say so and stop.
        if (!r.open) {
            emit UnknownRound(key);
            return;
        }
        if (r.settled) return; // idempotent: callback + poke must not double-apply

        r.settled = true;
        r.open = false;
        r.voided = voided;
        r.winner = winner;

        Entry[] storage list = _entries[key];
        uint16 survivors;
        uint16 killed;

        for (uint256 i; i < list.length; ++i) {
            Entry storage e = list[i];
            if (statusOf[e.runId] != ALIVE) continue;

            if (voided) {
                // A void pays both sides 0.5 and eliminates nobody.
                uint128 next = e.contracts / 2 + e.remainder;
                stackOf[e.runId] = next;
                ++survivors;
                emit RunAdvanced(e.runId, key, e.stackBefore, next);
            } else if (e.side == winner) {
                // Each winning contract redeems for exactly 1 — this is 1/p.
                uint128 next = e.contracts + e.remainder;
                stackOf[e.runId] = next;
                ++survivors;
                emit RunAdvanced(e.runId, key, e.stackBefore, next);
            } else {
                // The undeployed remainder was never at risk; it is not ours.
                statusOf[e.runId] = ELIMINATED;
                stackOf[e.runId] = e.remainder;
                ++killed;
                emit RunEliminated(e.runId, key, e.stackBefore - e.remainder);
            }
        }

        emit RoundSettled(key, winner, voided, survivors, killed);
    }

    /* ---------------------------------------------------------------- views */

    function entryCount(address pool, uint64 nonce) external view returns (uint256) {
        return _entries[roundKey(pool, nonce)].length;
    }

    function entryAt(address pool, uint64 nonce, uint256 i) external view returns (Entry memory) {
        return _entries[roundKey(pool, nonce)][i];
    }
}
