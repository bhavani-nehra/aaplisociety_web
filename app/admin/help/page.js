import { Suspense } from "react";
import { requirePagePermission } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermission("dashboard.admin.view");
  // FaqHub calls useSearchParams() — needs a Suspense boundary or
  // client-side navigation here throws Next's missing-suspense error.
  return (
    <Suspense fallback={null}>
      <PageClient />
    </Suspense>
  );
}
