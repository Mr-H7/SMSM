"use server";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { requireOwnerAction } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { z } from "zod";

const userRoleSchema = z.enum(["OWNER", "SELLER"]);
const passwordSchema = z.string().trim().min(6).max(128);
const idSchema = z.string().trim().min(1).max(128);

const createUserSchema = z.object({
  username: z.string().trim().min(1).max(80),
  fullName: z.string().trim().max(120).optional().transform((value) => value || null),
  role: userRoleSchema.default("SELLER"),
  password: passwordSchema,
});

const resetPasswordSchema = z.object({
  id: idSchema,
  newPassword: passwordSchema,
});

const toggleUserSchema = z.object({
  id: idSchema,
  next: z.enum(["0", "1"]),
});

const setRoleSchema = z.object({
  id: idSchema,
  role: userRoleSchema,
});

function formObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export async function createUser(formData: FormData) {
  await requireOwnerAction();

  const { username, fullName, role, password } = createUserSchema.parse(formObject(formData));

  const exists = await prisma.user.findFirst({
    where: { username },
    select: { id: true },
  });
  if (exists) throw new Error("Username already exists");

  await prisma.user.create({
    data: {
      username,
      fullName,
      role: role as Role,
      passwordHash: hashPassword(password),
      isActive: true,
    },
  });

  revalidatePath("/users");
  return { ok: true };
}

export async function resetUserPassword(formData: FormData) {
  await requireOwnerAction();

  const { id, newPassword } = resetPasswordSchema.parse(formObject(formData));

  await prisma.user.update({
    where: { id },
    data: { passwordHash: hashPassword(newPassword) },
  });

  revalidatePath("/users");
  return { ok: true };
}

export async function toggleUserActive(formData: FormData) {
  await requireOwnerAction();

  const { id, next } = toggleUserSchema.parse(formObject(formData));

  const target = await prisma.user.findUnique({
    where: { id },
    select: { role: true },
  });

  if (!target) throw new Error("User not found");
  if (target.role === "OWNER") throw new Error("OWNER users cannot be disabled");

  await prisma.user.update({
    where: { id },
    data: { isActive: next === "1" },
  });

  revalidatePath("/users");
  return { ok: true };
}

export async function setUserRole(formData: FormData) {
  await requireOwnerAction();

  const { id, role } = setRoleSchema.parse(formObject(formData));

  await prisma.user.update({
    where: { id },
    data: { role: role as Role },
  });

  revalidatePath("/users");
  return { ok: true };
}
