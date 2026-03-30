// prisma/seed.cjs
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient({
  datasourceUrl: "file:./dev.db",
});

async function main() {
  const username = "owner";
  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) {
    console.log("Owner already exists.");
    return;
  }

  const passwordHash = await bcrypt.hash("Owner@1234", 12);

  await prisma.user.create({
    data: {
      username,
      fullName: "المالك",
      role: "OWNER",
      passwordHash,
    },
  });

  console.log("Seeded owner: owner / Owner@1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });