// Shared full-rollback for one bulk-import run. Deletes everything tagged
// with importRunId — Society, Members, Users, BillingHeads, Bills (history
// AND live, both tagged importBatchId:importRunId), Transactions, and any
// queued-but-unsent EmailOutbox rows. Extracted out of
// app/api/admin/bulk-import/route.js so /api/superadmin/bill-history-v2/*
// can call the identical rollback when the Bill History step fails or is
// explicitly cancelled (final_audit_fix_plan/bill-history-upgrade.md §40).
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import BillingHead from "@/models/BillingHead";
import Member from "@/models/Member";
import User from "@/models/User";
import Society from "@/models/Society";
import EmailOutbox from "@/models/EmailOutbox";

export async function compensateImportRun(importRunId) {
  if (!importRunId) return;
  try {
    await Promise.all([
      Bill.deleteMany({ importBatchId: importRunId }),
      Transaction.deleteMany({ importRunId }),
      BillingHead.deleteMany({ importRunId }),
      Member.deleteMany({ importRunId }),
      User.deleteMany({ importRunId }),
      Society.deleteMany({ importRunId }),
      EmailOutbox.deleteMany({ importRunId }),
    ]);
  } catch (cleanupErr) {
    console.error(`[onboarding-rollback] compensation cleanup failed for run ${importRunId}:`, cleanupErr.message);
  }
}
