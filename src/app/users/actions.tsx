"use server";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { requireOwnerAction } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

function normalizeText(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

function requireStrongPassword(pw: string) {
  if (pw.length < 6) throw new Error("كلمة المرور لازم تكون 6 أحرف على الأقل");
}

export async function createUser(formData: FormData) {
  await requireOwnerAction();

  const username = normalizeText(formData.get("username"));
  const fullName = normalizeText(formData.get("fullName")) || null;
  const role = normalizeText(formData.get("role")) || "SELLER";
  const password = normalizeText(formData.get("password"));

  if (!username) throw new Error("اسم المستخدم مطلوب");
  if (role !== "OWNER" && role !== "SELLER") throw new Error("Role غير صحيح");
  requireStrongPassword(password);

  const exists = await prisma.user.findFirst({
    where: { username },
    select: { id: true },
  });
  if (exists) throw new Error("اسم المستخدم موجود بالفعل");

  await prisma.user.create({
    data: {
      username,
      fullName,
      role: role as any,
      passwordHash: hashPassword(password),
      isActive: true,
    },
  });

  revalidatePath("/users");
  return { ok: true };
}

export async function resetUserPassword(formData: FormData) {
  await requireOwnerAction();

  const id = normalizeText(formData.get("id"));
  const newPassword = normalizeText(formData.get("newPassword"));

  if (!id) throw new Error("Missing id");
  requireStrongPassword(newPassword);

  await prisma.user.update({
    where: { id },
    data: { passwordHash: hashPassword(newPassword) },
  });

  revalidatePath("/users");
  return { ok: true };
}

export async function toggleUserActive(formData: FormData) {
  await requireOwnerAction();

  const id = normalizeText(formData.get("id"));
  const next = normalizeText(formData.get("next"));

  if (!id) throw new Error("Missing id");

  const target = await prisma.user.findUnique({
    where: { id },
    select: { role: true },
  });

  if (!target) throw new Error("User not found");
  if (target.role === "OWNER") throw new Error("مينفعش تعطّل OWNER");

  await prisma.user.update({
    where: { id },
    data: { isActive: next === "1" },
  });

  revalidatePath("/users");
  return { ok: true };
}

export async function setUserRole(formData: FormData) {
  await requireOwnerAction();

  const id = normalizeText(formData.get("id"));
  const role = normalizeText(formData.get("role"));

  if (!id) throw new Error("Missing id");
  if (role !== "OWNER" && role !== "SELLER") throw new Error("Role غير صحيح");

  await prisma.user.update({
    where: { id },
    data: { role: role as any },
  });

  revalidatePath("/users");
  return { ok: true };
}