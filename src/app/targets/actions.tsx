"use server";

import { prisma } from "@/lib/prisma";
import { requireOwnerAction } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

function toStr(v: FormDataEntryValue | null) {
  return String(v ?? "").trim();
}

function toInt(v: FormDataEntryValue | null, fallback = 0) {
  const raw = toStr(v).replace(/[^\d-]/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

async function ensureTargetTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS target_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      daily_target INTEGER NOT NULL DEFAULT 15000,
      monthly_target INTEGER NOT NULL DEFAULT 50000,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS seller_targets (
      seller_id TEXT PRIMARY KEY,
      daily_target INTEGER NOT NULL DEFAULT 0,
      monthly_target INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    INSERT OR IGNORE INTO target_settings (id, daily_target, monthly_target)
    VALUES (1, 15000, 50000)
  `);
}

export async function updateGlobalTargets(formData: FormData) {
  await requireOwnerAction();
  await ensureTargetTables();

  const dailyTarget = Math.max(0, toInt(formData.get("dailyTarget"), 0));
  const monthlyTarget = Math.max(0, toInt(formData.get("monthlyTarget"), 0));

  await prisma.$executeRawUnsafe(
    `
      UPDATE target_settings
      SET daily_target = ?, monthly_target = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `,
    dailyTarget,
    monthlyTarget
  );

  revalidatePath("/targets");
  return { ok: true };
}

export async function updateSellerTargets(formData: FormData) {
  await requireOwnerAction();
  await ensureTargetTables();

  const sellerId = toStr(formData.get("sellerId"));
  const dailyTarget = Math.max(0, toInt(formData.get("dailyTarget"), 0));
  const monthlyTarget = Math.max(0, toInt(formData.get("monthlyTarget"), 0));

  if (!sellerId) {
    throw new Error("البائع غير موجود");
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO seller_targets (seller_id, daily_target, monthly_target, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(seller_id) DO UPDATE SET
        daily_target = excluded.daily_target,
        monthly_target = excluded.monthly_target,
        updated_at = CURRENT_TIMESTAMP
    `,
    sellerId,
    dailyTarget,
    monthlyTarget
  );

  revalidatePath("/targets");
  return { ok: true };
}

export async function clearSellerTargets(formData: FormData) {
  await requireOwnerAction();
  await ensureTargetTables();

  const sellerId = toStr(formData.get("sellerId"));
  if (!sellerId) {
    throw new Error("البائع غير موجود");
  }

  await prisma.$executeRawUnsafe(
    `DELETE FROM seller_targets WHERE seller_id = ?`,
    sellerId
  );

  revalidatePath("/targets");
  return { ok: true };
}