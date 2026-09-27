import { requirePagePermission } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermission("visitor.admin.view");
  return <PageClient />;
}
