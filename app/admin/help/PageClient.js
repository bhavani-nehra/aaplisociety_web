"use client";
import FaqHub from "@/components/global/FaqHub";
import { ADMIN_FAQ } from "@/lib/help/faq.admin";

export default function PageClient() {
  return <FaqHub area="admin" data={ADMIN_FAQ} />;
}
