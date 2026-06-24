export async function notifyStorefrontRevalidation() {
  const website = process.env.STOREFRONT_WEB_URL?.trim().replace(/\/$/, "");
  const secret = process.env.STOREFRONT_REVALIDATE_SECRET?.trim();
  if (!website || !secret) return;

  try {
    const response = await fetch(website + "/api/revalidate", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags: ["storefront-products", "storefront-categories"] }),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("[storefront-revalidate]", response.status, await response.text());
    }
  } catch (error) {
    console.error("[storefront-revalidate]", error);
  }
}