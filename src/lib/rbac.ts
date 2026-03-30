import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireOwner() {
  const user = await requireUser();
  if (user.role !== "OWNER") redirect("/dashboard");
  return user;
}

/**
 * Server Actions guard (owner only)
 * - throw Error instead of redirect is also OK, but redirect is cleaner UX.
 */
export async function requireOwnerAction() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "OWNER") redirect("/dashboard");
  return user;
}

/**
 * Seller is allowed (owner also allowed)
 */
export async function requireSellerOrOwner() {
  const user = await requireUser();
  if (user.role !== "OWNER" && user.role !== "SELLER") redirect("/dashboard");
  return user;
}