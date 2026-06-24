"use server";

import { ContactMessageStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwnerAction, requireUser } from "@/lib/rbac";
import { logSecurityEvent } from "@/lib/security";

function messageId(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("معرّف الرسالة مطلوب.");
  return id;
}

export async function updateMessageStatusAction(formData: FormData) {
  const user = await requireUser();
  const id = messageId(formData);
  const raw = String(formData.get("status") ?? "").toUpperCase();
  if (!["UNREAD", "READ", "ARCHIVED"].includes(raw)) {
    throw new Error("حالة الرسالة غير صحيحة.");
  }
  await prisma.contactMessage.update({
    where: { id },
    data: { status: raw as ContactMessageStatus },
  });
  logSecurityEvent("admin_action", { action: "contact_message_status_updated", userId: user.id, messageId: id, status: raw });
  revalidatePath("/contact-messages");
  revalidatePath("/dashboard");
}

export async function deleteMessageAction(formData: FormData) {
  const user = await requireOwnerAction();
  const id = messageId(formData);
  await prisma.contactMessage.delete({ where: { id } });
  logSecurityEvent("admin_action", { action: "contact_message_deleted", userId: user.id, messageId: id });
  revalidatePath("/contact-messages");
  revalidatePath("/dashboard");
}