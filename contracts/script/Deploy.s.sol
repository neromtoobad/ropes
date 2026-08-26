// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ArenaRegistry} from "../src/ArenaRegistry.sol";

/// forge script contracts/script/Deploy.s.sol --rpc-url somnia_testnet --broadcast
contract Deploy is Script {
    /// Somnia's reactivity precompile — fixed on every Somnia network.
    address constant PRECOMPILE = 0x0000000000000000000000000000000000000100;
    /// BinarySettlement. CREATE3, so identical on testnet and mainnet.
    address constant SETTLEMENT = 0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23;

    function run() external {
        vm.startBroadcast(vm.envUint("DEPLOY_PK"));
        ArenaRegistry reg = new ArenaRegistry(PRECOMPILE, SETTLEMENT);
        vm.stopBroadcast();
        console.log("ArenaRegistry:", address(reg));
    }
}
