// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ArenaRegistry} from "../src/ArenaRegistry.sol";

contract ArenaRegistryTest is Test {
    ArenaRegistry reg;

    address constant PRECOMPILE = address(0x100);
    address constant SETTLEMENT = address(0xBEEF);
    address constant POOL = address(0xCAFE);
    address constant STRANGER = address(0xDEAD);

    uint64 constant NONCE = 63;

    bytes32 constant ADA = keccak256("ada");
    bytes32 constant BRAM = keccak256("bram");
    bytes32 constant MARKET = bytes32(uint256(0xA429));

    uint8 constant UP = 0;
    uint8 constant DOWN = 1;

    event RunAdvanced(bytes32 indexed runId, bytes32 indexed roundKey, uint128 from, uint128 to);
    event RunEliminated(bytes32 indexed runId, bytes32 indexed roundKey, uint128 lost);
    event RoundSettled(bytes32 indexed roundKey, uint8 winner, bool voided, uint16 survivors, uint16 killed);
    event UnknownRound(bytes32 indexed roundKey);

    function setUp() public {
        reg = new ArenaRegistry(PRECOMPILE, SETTLEMENT);
    }

    /// The exact shape BinarySettlement emits: [sig, marketKey, pool] + tail.
    function _fire(address pool, uint64 nonce, bool voided, uint8 winner) internal {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = keccak256("MarketFinalized(uint256,address,uint64,address,uint256,bool,uint256[])");
        topics[1] = bytes32(uint256(1234)); // marketKey, unused by us
        topics[2] = bytes32(uint256(uint160(pool)));
        // The deployed event carries payout numerators, not a winner flag:
        // a win is [full, 0]; a void is [half, half].
        uint256[] memory payouts = new uint256[](2);
        if (voided) { payouts[0] = 5e6; payouts[1] = 5e6; }
        else if (winner == UP) { payouts[0] = 10e6; }
        else { payouts[1] = 10e6; }
        bytes memory data = abi.encode(nonce, address(0x1111), uint256(20e6), voided, payouts);
        vm.prank(PRECOMPILE);
        reg.onEvent(SETTLEMENT, topics, data);
    }

    function _openWithTwo() internal returns (bytes32 key) {
        key = reg.roundKey(POOL, NONCE);
        reg.openRound(POOL, NONCE, MARKET);
        // ada UP: 10.00 staked, filled 16.23 contracts, nothing left over.
        reg.enter(POOL, NONCE, ADA, UP, 16_233_700, 0, 10_000_000);
        // bram DOWN: 10.00 staked, 9.9751 deployed, 0.0249 the book refused.
        reg.enter(POOL, NONCE, BRAM, DOWN, 19_455_000, 24_900, 10_000_000);
    }

    /* --------------------------------------------------------- the happy path */

    function test_settle_advances_winners_and_eliminates_losers() public {
        bytes32 key = _openWithTwo();

        vm.expectEmit(true, true, true, true);
        emit RunAdvanced(ADA, key, 10_000_000, 16_233_700);
        vm.expectEmit(true, true, true, true);
        emit RunEliminated(BRAM, key, 9_975_100);
        vm.expectEmit(true, true, true, true);
        emit RoundSettled(key, UP, false, 1, 1);

        _fire(POOL, NONCE, false, UP);

        // A winning contract redeems for exactly 1 — that IS the 1/p growth.
        assertEq(reg.stackOf(ADA), 16_233_700, "winner compounds to its contracts");
        assertEq(reg.statusOf(ADA), 0, "winner still alive");
        assertEq(reg.statusOf(BRAM), 2, "loser eliminated");
    }

    /// The bug that cost us a run in phase 1: elimination must not confiscate
    /// collateral the book never absorbed.
    function test_elimination_returns_the_undeployed_remainder() public {
        _openWithTwo();
        _fire(POOL, NONCE, false, UP);
        assertEq(reg.stackOf(BRAM), 24_900, "remainder was never at risk");
    }

    function test_void_pays_both_sides_half_and_kills_nobody() public {
        bytes32 key = _openWithTwo();

        vm.expectEmit(true, true, true, true);
        emit RoundSettled(key, 0, true, 2, 0);
        _fire(POOL, NONCE, true, 0);

        assertEq(reg.stackOf(ADA), 16_233_700 / 2);
        assertEq(reg.stackOf(BRAM), 19_455_000 / 2 + 24_900);
        assertEq(reg.statusOf(ADA), 0, "void eliminates nobody");
        assertEq(reg.statusOf(BRAM), 0, "void eliminates nobody");
    }

    /* -------------------------------------------------------------- access */

    function test_only_precompile_may_settle() public {
        _openWithTwo();
        bytes32[] memory topics = new bytes32[](3);
        topics[2] = bytes32(uint256(uint160(POOL)));
        uint256[] memory p = new uint256[](2); p[0] = 10e6;
        bytes memory data = abi.encode(NONCE, address(0), uint256(0), false, p);

        vm.prank(STRANGER);
        vm.expectRevert(ArenaRegistry.NotPrecompile.selector);
        reg.onEvent(SETTLEMENT, topics, data);
    }

    /// A forged callback claiming to be from some other contract must not settle.
    function test_rejects_a_foreign_emitter() public {
        _openWithTwo();
        bytes32[] memory topics = new bytes32[](3);
        topics[2] = bytes32(uint256(uint160(POOL)));
        uint256[] memory p = new uint256[](2); p[0] = 10e6;
        bytes memory data = abi.encode(NONCE, address(0), uint256(0), false, p);

        vm.prank(PRECOMPILE);
        vm.expectRevert(abi.encodeWithSelector(ArenaRegistry.WrongEmitter.selector, STRANGER));
        reg.onEvent(STRANGER, topics, data);
    }

    function test_only_owner_may_enter() public {
        reg.openRound(POOL, NONCE, MARKET);
        vm.prank(STRANGER);
        vm.expectRevert(ArenaRegistry.NotOwner.selector);
        reg.enter(POOL, NONCE, ADA, UP, 1, 0, 1);
    }

    /* ------------------------------------------------------------ idempotence */

    /// The callback and the manual backstop must never both apply.
    function test_settling_twice_does_not_double_apply() public {
        _openWithTwo();
        _fire(POOL, NONCE, false, UP);
        uint128 after1 = reg.stackOf(ADA);

        _fire(POOL, NONCE, false, DOWN); // a second, contradictory callback
        reg.pokeSettle(POOL, NONCE, false, DOWN); // and the backstop too

        assertEq(reg.stackOf(ADA), after1, "first settlement is final");
        assertEq(reg.statusOf(ADA), 0, "a re-settle cannot kill a survivor");
    }

    function test_reopening_a_settled_round_is_a_noop() public {
        _openWithTwo();
        _fire(POOL, NONCE, false, UP);
        reg.openRound(POOL, NONCE, MARKET);
        (,, bool open, bool settled,,) = reg.rounds(reg.roundKey(POOL, NONCE));
        assertFalse(open);
        assertTrue(settled);
    }

    function test_cannot_enter_a_settled_round() public {
        _openWithTwo();
        _fire(POOL, NONCE, false, UP);
        vm.expectRevert(ArenaRegistry.RoundAlreadySettled.selector);
        reg.enter(POOL, NONCE, keccak256("cyd"), UP, 1, 0, 1);
    }

    function test_eliminated_run_cannot_re_enter() public {
        _openWithTwo();
        _fire(POOL, NONCE, false, UP); // bram dies
        reg.openRound(POOL, NONCE + 1, MARKET);
        vm.expectRevert(ArenaRegistry.RunNotAlive.selector);
        reg.enter(POOL, NONCE + 1, BRAM, UP, 1, 0, 1);
    }

    /* ----------------------------------------------------- the venue's noise */

    /// The venue finalises markets we are not playing. That must be silent, not
    /// a revert — a reverting callback under a gas limit is invisible.
    function test_unknown_round_is_reported_not_reverted() public {
        bytes32 key = reg.roundKey(POOL, 999);
        vm.expectEmit(true, true, true, true);
        emit UnknownRound(key);
        _fire(POOL, 999, false, UP);
    }

    /// A pool is recycled across windows, so (pool, nonce) must disambiguate.
    function test_same_pool_different_nonce_is_a_different_round() public {
        _openWithTwo();
        reg.openRound(POOL, NONCE + 1, MARKET);
        reg.enter(POOL, NONCE + 1, keccak256("cyd"), UP, 5_000_000, 0, 5_000_000);

        _fire(POOL, NONCE, false, UP); // settles only the first window

        (,,, bool settledA,,) = reg.rounds(reg.roundKey(POOL, NONCE));
        (,, bool openB,,,) = reg.rounds(reg.roundKey(POOL, NONCE + 1));
        assertTrue(settledA, "first window settled");
        assertTrue(openB, "successor untouched");
    }

    function test_bank_ends_the_run() public {
        _openWithTwo();
        reg.bankRun(ADA, 24_000_000);
        assertEq(reg.statusOf(ADA), 1);
        assertEq(reg.stackOf(ADA), 24_000_000);

        // A banked run must not then be settled by the round it was in.
        _fire(POOL, NONCE, false, UP);
        assertEq(reg.stackOf(ADA), 24_000_000, "banking is final");
    }

    /* ------------------------------------------------------------------ fuzz */

    function testFuzz_winner_never_loses_value(uint128 contracts, uint128 remainder, uint128 stake) public {
        contracts = uint128(bound(contracts, 1, type(uint96).max));
        remainder = uint128(bound(remainder, 0, type(uint96).max));
        stake = uint128(bound(stake, 1, type(uint96).max));

        reg.openRound(POOL, NONCE, MARKET);
        reg.enter(POOL, NONCE, ADA, UP, contracts, remainder, stake);
        _fire(POOL, NONCE, false, UP);

        assertEq(reg.stackOf(ADA), uint256(contracts) + uint256(remainder));
        assertEq(reg.statusOf(ADA), 0);
    }

    /* ---------------------------------------------------------- enterMany */

    function test_enterMany_seats_a_whole_side_at_one_price() public {
        reg.openRound(POOL, NONCE, MARKET);

        bytes32[] memory ids = new bytes32[](2);
        uint128[] memory con = new uint128[](2);
        uint128[] memory rem = new uint128[](2);
        uint128[] memory pre = new uint128[](2);
        ids[0] = ADA; ids[1] = BRAM;
        con[0] = 16_000_000; con[1] = 8_000_000;
        rem[0] = 0; rem[1] = 100;
        pre[0] = 10_000_000; pre[1] = 5_000_000;

        reg.enterMany(POOL, NONCE, UP, ids, con, rem, pre);
        assertEq(reg.entryCount(POOL, NONCE), 2);

        _fire(POOL, NONCE, false, UP);
        assertEq(reg.stackOf(ADA), 16_000_000);
        assertEq(reg.stackOf(BRAM), 8_000_100);
    }

    /// A dead run in the batch must not cost the rest of the side its entry.
    function test_enterMany_skips_a_dead_run_without_reverting() public {
        _openWithTwo();
        _fire(POOL, NONCE, false, UP); // bram dies

        reg.openRound(POOL, NONCE + 1, MARKET);
        bytes32[] memory ids = new bytes32[](2);
        uint128[] memory con = new uint128[](2);
        uint128[] memory rem = new uint128[](2);
        uint128[] memory pre = new uint128[](2);
        ids[0] = BRAM; ids[1] = ADA; // BRAM is eliminated
        con[0] = 1; con[1] = 9_000_000;
        pre[0] = 1; pre[1] = 5_000_000;

        reg.enterMany(POOL, NONCE + 1, UP, ids, con, rem, pre);
        assertEq(reg.entryCount(POOL, NONCE + 1), 1, "only the live run seated");
    }

    function test_enterMany_rejects_ragged_arrays() public {
        reg.openRound(POOL, NONCE, MARKET);
        bytes32[] memory ids = new bytes32[](2);
        uint128[] memory one = new uint128[](1);
        uint128[] memory two = new uint128[](2);
        vm.expectRevert(ArenaRegistry.LengthMismatch.selector);
        reg.enterMany(POOL, NONCE, UP, ids, one, two, two);
    }
}
