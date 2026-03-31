import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";

async function main() {
  const username = "SMSM";
  const plainPassword = "SMsm1";

  const existingUser = await prisma.user.findUnique({
    where: { username },
  });

  const passwordHash = hashPassword(plainPassword);

  if (existingUser) {
    await prisma.user.update({
      where: { username },
      data: {
        fullName: "SMSM",
        role: "OWNER",
        isActive: true,
        passwordHash,
      },
    });

    console.log("Updated owner user: SMSM / SMsm1");
    return;
  }

  await prisma.user.create({
    data: {
      username,
      fullName: "SMSM",
      role: "OWNER",
      isActive: true,
      passwordHash,
    },
  });

  console.log("Seeded owner user: SMSM / SMsm1");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });