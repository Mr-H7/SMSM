"use server";

import { PaymentMethod } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/rbac";
import { notifyStorefrontRevalidation } from "@/lib/storefront-revalidation";
import { logSecurityEvent } from "@/lib/security";
import {
  cancelWebOrder,
  confirmWebOrder,
  fulfillWebOrder,
  markWebOrderContacted,
  markWebOrderSeen,
} from "@/lib/web-orders";

function id(formData: FormData) {
  const value = String(formData.get("id") ?? "").trim();
  if (!value) throw new Error("معرّف الطلب مطلوب.");
  return value;
}

function refresh(orderId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/web-orders");
  revalidatePath("/web-orders/" + orderId);
  revalidatePath("/products");
  revalidatePath("/invoices");
  revalidatePath("/reports");
}

export async function markContactedAction(formData: FormData) {
  const user = await requireUser();
  const orderId = id(formData);
  await markWebOrderContacted(orderId);
  logSecurityEvent("admin_action", { action: "web_order_contacted", userId: user.id, orderId });
  refresh(orderId);
}

export async function confirmOrderAction(formData: FormData) {
  const user = await requireUser();
  const orderId = id(formData);
  await confirmWebOrder(orderId);
  logSecurityEvent("admin_action", { action: "web_order_confirmed", userId: user.id, orderId });
  await notifyStorefrontRevalidation();
  refresh(orderId);
}

export async function cancelOrderAction(formData: FormData) {
  const user = await requireUser();
  const orderId = id(formData);
  await cancelWebOrder(orderId);
  logSecurityEvent("admin_action", { action: "web_order_cancelled", userId: user.id, orderId });
  await notifyStorefrontRevalidation();
  refresh(orderId);
}

export async function fulfillOrderAction(formData: FormData) {
  const user = await requireUser();
  const orderId = id(formData);
  const paymentMethod =
    String(formData.get("paymentMethod") ?? "CASH").toUpperCase() === "TRANSFER"
      ? PaymentMethod.TRANSFER
      : PaymentMethod.CASH;
  const paymentDescription = String(formData.get("paymentDescription") ?? "").trim();

  if (paymentMethod === PaymentMethod.TRANSFER && !paymentDescription) {
    throw new Error("تفاصيل التحويل مطلوبة.");
  }

  await fulfillWebOrder(orderId, user.id, paymentMethod, paymentDescription);
  logSecurityEvent("admin_action", { action: "web_order_fulfilled", userId: user.id, orderId, paymentMethod });
  refresh(orderId);
}

export async function markOrderSeenAction(orderId: string) {
  const user = await requireUser();
  await markWebOrderSeen(orderId);
  logSecurityEvent("admin_action", { action: "web_order_seen", userId: user.id, orderId });
  revalidatePath("/web-orders");
  revalidatePath("/dashboard");
}