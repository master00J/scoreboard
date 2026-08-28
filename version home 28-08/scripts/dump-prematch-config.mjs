import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "dist", "stadium-portable-data", "data", "stadium.db").replace(/\\/g, "/");
process.env.DATABASE_URL = `file:${dbPath}`;

const p = new PrismaClient();
const sponsors = await p.sponsor.findMany({
  select: {
    name: true,
    prematchSeconds: true,
    matchSeconds: true,
    active: true,
  },
});
const match = await p.match.findUnique({
  where: { id: "cmoyl8dhc0008m48grpzttiaz" },
  select: {
    status: true,
    prematchSpreadWindowSec: true,
    kickoffAt: true,
  },
});
console.log(JSON.stringify({ sponsors, match }, null, 2));
await p.$disconnect();
