import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.displayState.upsert({
    where: { id: 1 },
    create: { id: 1, mode: "IDLE" },
    update: {},
  });

  const slots = [
    { slot: "IDLE", name: "Idle" },
    { slot: "PREMATCH", name: "Pre-match" },
    { slot: "HALFTIME", name: "Half-time" },
    { slot: "POSTMATCH", name: "Post-match" },
    { slot: "GOAL", name: "Goal celebrations" },
  ];
  for (const s of slots) {
    await prisma.playlist.upsert({
      where: { slot: s.slot },
      create: { slot: s.slot, name: s.name },
      update: { name: s.name },
    });
  }

  const homeCount = await prisma.team.count();
  if (homeCount === 0) {
    const home = await prisma.team.create({
      data: {
        name: "Home FC",
        shortName: "HOM",
        primaryColor: "#1e40af",
        secondaryColor: "#fbbf24",
      },
    });
    const away = await prisma.team.create({
      data: {
        name: "Away United",
        shortName: "AWY",
        primaryColor: "#b91c1c",
        secondaryColor: "#ffffff",
      },
    });

    const demoPlayers = (teamId: string, prefix: string) =>
      Array.from({ length: 11 }).map((_, i) => ({
        teamId,
        number: i + 1,
        firstName: `${prefix}${i + 1}`,
        lastName: "Demo",
        position: i === 0 ? "GK" : i < 5 ? "DEF" : i < 9 ? "MID" : "FWD",
      }));

    await prisma.player.createMany({ data: demoPlayers(home.id, "H") });
    await prisma.player.createMany({ data: demoPlayers(away.id, "A") });

    await prisma.match.create({
      data: {
        homeTeamId: home.id,
        awayTeamId: away.id,
        status: "SETUP",
      },
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
