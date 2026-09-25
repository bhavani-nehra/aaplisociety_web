"use client";
import { EmptyState } from "@/components/revamp";

export default function MakePaymentPage() {
  return (
    <div style={{ padding: "2rem 0" }}>
      <EmptyState
        icon="lock"
        title="Online Payments Coming Soon"
        sub="Online payment is not yet enabled. Please pay your maintenance bill directly to the society office and request a receipt."
      />
    </div>
  );
}
