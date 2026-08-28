import { PrismaClient } from "@prisma/client";

const p = new PrismaClient({
  datasources: {
    db: { url: "file:C:/Users/RTX40/AppData/Roaming/stadium-scoreboard/data/stadium.db" },
  },
});

try {
  const teams = await p.team.findMany({ include: { players: true } });
  console.log("TEAMS:", JSON.stringify(teams, null, 2));
  const settings = await p.$queryRawUnsafe('SELECT * FROM "AppSettings"');
  console.log("SETTINGS:", settings);
  const matches = await p.match.findMany();
  console.log("MATCHES:", JSON.stringify(matches, null, 2));
} finally {
  await p.$disconnect();
}
