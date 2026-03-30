// prisma/seed.ts
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";

async function main() {
  const exists = await prisma.user.findUnique({ where: { username: "owner" } });
  if (exists) return;

  await prisma.user.create({
    data: {
      username: "owner",
      fullName: "المالك",
      role: "OWNER",
      passwordHash: await hashPassword("Owner@1234"),
    },
  });

  // أول فاتورة رقم 1 يبدأ من 1 تلقائيًا بإستراتيجية لاحقًا
  console.log("Seeded owner: owner / Owner@1234");
}

main().finally(async () => {
  await prisma.$disconnect();
});