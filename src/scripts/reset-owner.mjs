import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hashPassword(password) {
  const iterations = 120_000;
  const salt = crypto.randomBytes(16).toString("hex");
  const keylen = 32;
  const digest = "sha256";
  const derived = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString("hex");
  return `pbkdf2$${iterations}$${salt}$${derived}`;
}

const USERNAME = "SMSM";        // ✅ owner username اللي انت عملته
const NEW_PASSWORD = "Owner@1234"; // ✅ باسورد جديد ثابت

async function main() {
  // 1) فعّل/أنشئ SMSM كـ OWNER
  const exists = await prisma.user.findFirst({ where: { username: USERNAME }, select: { id: true } });

  if (exists) {
    await prisma.user.update({
      where: { id: exists.id },
      data: {
        role: "OWNER",
        isActive: true,
        passwordHash: hashPassword(NEW_PASSWORD),
      },
    });
  } else {
    await prisma.user.create({
      data: {
        username: USERNAME,
        fullName: "Owner",
        role: "OWNER",
        isActive: true,
        passwordHash: hashPassword(NEW_PASSWORD),
      },
    });
  }

  // 2) (اختياري قوي) فعّل أي OWNER تاني متعطل علشان ما تتقفّلش تاني
  await prisma.user.updateMany({
    where: { role: "OWNER" },
    data: { isActive: true },
  });

  console.log("✅ Owner reset done.");
  console.log(`✅ Login: ${USERNAME} / ${NEW_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error("❌ Reset failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });