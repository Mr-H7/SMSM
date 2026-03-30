const crypto = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function hashPassword(password) {
  const iterations = 120000;
  const salt = crypto.randomBytes(16).toString("hex");
  const keylen = 32; // 32 bytes
  const digest = "sha256";

  const derived = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString("hex");
  return `pbkdf2$${iterations}$${salt}$${derived}`;
}

async function main() {
  const username = "owner";
  const newPassword = "Owner@1234";

  const passwordHash = hashPassword(newPassword);

  const existing = await prisma.user.findFirst({
    where: { username },
    select: { id: true },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        role: "OWNER",
        isActive: true,
      },
    });
    console.log("✅ Updated existing owner");
  } else {
    await prisma.user.create({
      data: {
        username,
        fullName: "Owner",
        role: "OWNER",
        isActive: true,
        passwordHash,
      },
    });
    console.log("✅ Created owner");
  }

  console.log("✅ Login now with: owner / Owner@1234");
}

main()
  .catch((e) => {
    console.error("❌ reset-owner failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });