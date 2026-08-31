/**
 * One Prisma client per process.
 *
 * Two processes write this database — the executor and the Next server — so it
 * runs in WAL mode. Next's dev server hot-reloads modules, which would otherwise
 * leak a new client (and a new connection) on every edit.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The URL is passed EXPLICITLY, not left to the schema's env() lookup.
 *
 * Those two are supposed to be the same string and are not: with the pooler
 * URL carrying `sslmode=require`, the env-resolved client could not reach the
 * server at all while a client handed the identical string connected first
 * try. That cost a stalled game and a long hunt, so the process now states
 * plainly which database it is talking to.
 */
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
