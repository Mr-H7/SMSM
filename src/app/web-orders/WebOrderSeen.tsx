"use client";

import { useEffect } from "react";
import { markOrderSeenAction } from "./actions";

export default function WebOrderSeen({ orderId }: { orderId: string }) {
  useEffect(() => {
    void markOrderSeenAction(orderId);
  }, [orderId]);

  return null;
}