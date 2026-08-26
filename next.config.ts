import type { NextConfig } from "next";
const config: NextConfig = {
  // Silence the workspace-root guess; a stray lockfile in $HOME misleads it.
  outputFileTracingRoot: import.meta.dirname,
  // The SDK opens a WebSocket and pulls in node built-ins; keep it external so
  // Next doesn't try to bundle it for the server runtime.
  serverExternalPackages: ["@somnia-chain/markets-sdk", "@prisma/client"],
};
export default config;
