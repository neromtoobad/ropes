/**
 * One Prisma client per process.
 *
 * Two processes write this database — the executor and the Next server — so it
 * runs in WAL mode. Next's dev server hot-reloads modules, which would otherwise
 * leak a new client (and a new connection) on every edit.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
