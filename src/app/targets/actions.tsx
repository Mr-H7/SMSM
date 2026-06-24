"use server";

import { prisma } from "@/lib/prisma";
import { requireOwnerAction } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const moneyInput = z.preprocess(
  (value) => String(value ?? "").replace(/[^\d-]/g, ""),
  z.coerce.number().int().min(0).max(100_000_000)
);

const globalTargetsSchema = z.object({
  dailyTarget: moneyInput,
  monthlyTarget: moneyInput,
});

const sellerTargetsSchema = globalTargetsSchema.extend({
  sellerId: z.string().trim().min(1).max(128),
});

const sellerIdSchema = z.object({
  sellerId: z.string().trim().min(1).max(128),
});

function formObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

async function ensureTargetTables() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS target_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      daily_target INTEGER NOT NULL DEFAULT 15000,
      monthly_target INTEGER NOT NULL DEFAULT 50000,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS seller_targets (
      seller_id TEXT PRIMARY KEY,
      daily_target INTEGER NOT NULL DEFAULT 0,
      monthly_target INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await prisma.$executeRaw`
    INSERT INTO target_settings (id, daily_target, monthly_target)
    VALUES (1, 15000, 50000)
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function updateGlobalTargets(formData: FormData) {
  await requireOwnerAction();
  await ensureTargetTables();

  const { dailyTarget, monthlyTarget } = globalTargetsSchema.parse(formObject(formData));

  await prisma.$executeRaw`
    UPDATE target_settings
    SET daily_target = ${dailyTarget}, monthly_target = ${monthlyTarget}, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `;

  revalidatePath("/targets");
  return { ok: true };
}

export async function updateSellerTargets(formData: FormData) {
  await requireOwnerAction();
  await ensureTargetTables();

  const { sellerId, dailyTarget, monthlyTarget } = sellerTargetsSchema.parse(formObject(formData));

  await prisma.$executeRaw`
    INSERT INTO seller_targets (seller_id, daily_target, monthly_target, updated_at)
    VALUES (${sellerId}, ${dailyTarget}, ${monthlyTarget}, CURRENT_TIMESTAMP)
    ON CONFLICT (seller_id) DO UPDATE SET
      daily_target = excluded.daily_target,
      monthly_target = excluded.monthly_target,
      updated_at = CURRENT_TIMESTAMP
  `;

  revalidatePath("/targets");
  return { ok: true };
}

export async function clearSellerTargets(formData: FormData) {
  await requireOwnerAction();
  await ensureTargetTables();

  const { sellerId } = sellerIdSchema.parse(formObject(formData));

  await prisma.$executeRaw`DELETE FROM seller_targets WHERE seller_id = ${sellerId}`;

  revalidatePath("/targets");
  return { ok: true };
}
