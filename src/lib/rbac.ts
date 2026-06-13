import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

function normalizeRole(role: unknown) {
  return String(role ?? "").trim().toUpperCase();
}

export async function requireUser() {
  console.info("[rbac] requireUser start", { called: true });
  const user = await getSessionUser();
  console.info("[rbac] requireUser user", { userExists: Boolean(user) });
  if (!user) redirect("/login");
  return user;
}

export async function requireOwner() {
  console.info("[rbac] requireOwner start", { called: true });
  const user = await requireUser();
  const role = normalizeRole(user.role);
  const allowed = role === "OWNER";
  console.info("[rbac] requireOwner result", { userRole: role, allowed });
  if (!allowed) redirect("/dashboard");
  return user;
}

/**
 * Server Actions guard (owner only)
 * - throw Error instead of redirect is also OK, but redirect is cleaner UX.
 */
export async function requireOwnerAction() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (normalizeRole(user.role) !== "OWNER") redirect("/dashboard");
  return user;
}

/**
 * Seller is allowed (owner also allowed)
 */
export async function requireSellerOrOwner() {
  const user = await requireUser();
  const role = normalizeRole(user.role);
  if (role !== "OWNER" && role !== "SELLER") redirect("/dashboard");
  return user;
}
