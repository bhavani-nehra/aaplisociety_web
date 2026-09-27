// "Money (all in one)" was retired — Overview is the one entry point and each
// card links to the page that owns its numbers.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function Page() {
  redirect("/admin/money-overview");
}
