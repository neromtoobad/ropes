/**
 * The exact text a depositor signs to claim a deposit for a player key.
 * Shared by the browser (signs it) and the server (verifies it) so the two can
 * never drift apart. Binding the tx hash AND the player key means a signature
 * proves "the wallet that sent this transfer wants it credited to this key" —
 * nothing else, and not reusable for any other deposit.
 */
export const depositMessage = (txHash: string, playerKey: string) =>
  `THE CLIMB · credit deposit ${txHash.toLowerCase()} to ${playerKey.toLowerCase()}`;
