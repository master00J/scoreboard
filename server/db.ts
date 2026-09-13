import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Database-handle voor handlers: de gewone client óf de transactieclient uit `prisma.$transaction`.
 * Handlers krijgen altijd expliciet een `Db` mee zodat een transactie nooit per ongeluk een tweede
 * connectie opent (met `connection_limit=1` zou dat tot een pool-timeout leiden).
 */
export type Db = PrismaClient | Prisma.TransactionClient;
