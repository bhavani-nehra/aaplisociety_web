// Page-level help content for the admin area — looked up by pathname from
// components/global/HelpPanel.jsx. Plain data + functions, no build step: a
// PR adding a new page's help only ever touches this object.
//
// Shape per entry:
//   title, body       — what the page is, one sentence.
//   flow              — 3-6 short node labels HelpPanel draws as connected
//                        boxes (an actual diagram, not text) — the page's
//                        shape at a glance.
//   steps             — the real numbered click-path: exact on-screen
//                        button/tab/field labels, from the page's own source.
//   checklist / watch — pre-click checks / the one sharp non-obvious risk.
//   liveCheck         — async () => [{label, tone}] — fetches THIS society's
//                        real data from the same API the page itself calls,
//                        so the dialog shows what's actually true right now
//                        (heads missing, bank accounts added, collection
//                        rate today), not a static description. Only set
//                        where a real, verified endpoint exists — omitted
//                        rather than guessed at. tone: "ok" | "warn" | "bad" | "info".
//   faqCategory       — links to a real category in lib/help/faq.admin.js,
//                        left unset where no genuine match exists.
// `tourId` stays unset everywhere — guided tours (sub-project 3) hasn't shipped.

async function getJSON(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

function memberCountFrom(json) {
  return (json?.members || json?.data || json?.results || []).length;
}

export const ADMIN_HELP_PAGES = {
  "/admin/accounting": {
    title: "Accounting Setup",
    body: "One-time setup that opens the books: six steps, each shows what it will do before it runs.",
    flow: ["Preview a step", "Run it", "It shows done", "Repeat × 6", "Books open"],
    // app/admin/accounting/setup/PageClient.js
    steps: [
      "Land here by default under Configuration → Guided Setup.",
      "Each step's icon shows its status: grey circle = to do, spinner = running, green check = done.",
      "Click “Preview” on a step to see what it will create — nothing is written yet.",
      "Inside that preview panel, click “Run this” to commit only that one step.",
      "Or click “Preview & run all six” (top right) to see every step's diff at once, then “Confirm & run all”.",
      "Watch the progress bar — it reaches 100% once every step shows done or already done.",
    ],
    checklist: [
      "A step marked “needs step above” stays disabled until the one before it is done — run top to bottom.",
      "Running a done step again is safe — it reports what already exists and only creates what's missing.",
    ],
    // GET /api/accounting/setup/run — the exact endpoint this page itself loads on mount.
    liveCheck: async () => {
      const json = await getJSON("/api/accounting/setup/run");
      const steps = json.steps || [];
      const states = json.states || {};
      const done = steps.filter((s) => states[s.key]?.done === true).length;
      const total = steps.length || 6;
      return [{
        label: `Right now: ${done} of ${total} setup steps done for this society`,
        tone: done >= total && total > 0 ? "ok" : done === 0 ? "bad" : "warn",
      }];
    },
    faqCategory: "Getting Started",
  },
  "/admin/accounting/chart-of-accounts": {
    title: "Account Heads",
    body: "The Asset/Liability/Funds/Income/Expense heads every transaction posts against — set this up before entering any voucher.",
    flow: ["Pick a type", "Create or find the head", "Set its Schedule", "Prints on the Balance Sheet"],
    // app/admin/accounting/chart-of-accounts/PageClient.js
    steps: [
      "If heads are missing, click “Create the standard set” (or “Create the N missing”), top right.",
      "Filter by type with the All / Assets / Liabilities / Funds / Income / Expenses bar.",
      "Click a head's name to rename it inline — Enter saves, Escape cancels.",
      "Open the Schedule dropdown on a head and pick A–J — leaving it on “Unassigned” breaks how it prints on the Balance Sheet.",
      "Click “View ledger” on a head to see its postings inline, without leaving this page.",
      "Tick checkboxes on several heads, then “Switch off selected” to bulk-deactivate ones you don't use.",
    ],
    checklist: [
      "Click “Only unassigned” to filter down to every head still missing a Schedule in one view.",
    ],
    watch: [
      "A head with posted entries can't be deleted — “Delete” refuses and says why; switch it off instead.",
    ],
    // Same two endpoints the page itself calls: template (missing heads) + the live chart (unassigned heads).
    liveCheck: async () => {
      const [tpl, acc] = await Promise.all([
        getJSON("/api/accounting/chart-of-accounts/template"),
        getJSON("/api/accounting/chart-of-accounts?includeInactive=true&withLock=1"),
      ]);
      const missing = (tpl.available || []).length;
      const accounts = acc.accounts || [];
      const unassigned = accounts.filter((a) => a.isActive !== false && !a.scheduleCode).length;
      return [
        { label: missing ? `${missing} standard head(s) not added yet` : "All standard heads are added", tone: missing ? "warn" : "ok" },
        { label: unassigned ? `${unassigned} active head(s) have no Schedule` : "Every active head has a Schedule", tone: unassigned ? "bad" : "ok" },
      ];
    },
  },
  "/admin/accounting/registers": {
    title: "Assets & Liabilities",
    body: "Three sections on one page — Fixed Assets, Funds, Liabilities — each posts a real ledger entry the moment you use it.",
    flow: ["Pick a section", "Fixed Assets / Funds / Liabilities", "Action posts to the ledger immediately"],
    // app/admin/accounting/registers/PageClient.js + assets/funds/liabilities PageClient.js
    steps: [
      "Click “Fixed Assets” to expand it, then register an asset — this posts Dr Fixed Assets / Cr Cash or Bank immediately.",
      "Click “Funds” to expand it — contribute to, withdraw from, or transfer between Reserve, Sinking, Repair, or Corpus funds; each posts its own entry.",
      "Click “Liabilities” to expand it — record what the society owes (vendor bill, loan, deposit, statutory tax) or mark one paid off.",
    ],
    checklist: [
      "Only one section needs to stay open at a time — the others collapse on their own.",
    ],
    watch: [
      "Every action here posts to the ledger right away — there's no draft or save-for-later.",
      "Bank accounts are not set up here — that's Cash Flow Setup.",
    ],
    faqCategory: "Registers",
  },
  "/admin/accounting/cash-flow": {
    title: "Cash Flow Setup",
    body: "Add the society's bank accounts, then reconcile each one against its statement.",
    flow: ["Add bank account", "Import statement", "Suggest matches", "Confirm each one"],
    // app/admin/accounting/bank-accounts/PageClient.js (rendered on this page)
    steps: [
      "Click “+ Add a bank account”, fill in Bank name, Account number, and Linked account (must be Bank subtype), then “Add”.",
      "Click a bank account card, then “Reconcile” to open its reconciliation panel.",
      "Upload the bank's Excel statement export to import its transaction lines.",
      "Click “Suggest” to let the system propose matches against your imported lines.",
      "Click “Confirm” on a suggested match, or preview then confirm several pending matches at once.",
      "Click “Undo” on a confirmed match if it was wrong.",
    ],
    checklist: [
      "Reconcile before trusting this period's cash figures on Cash Flow or the Trial Balance.",
    ],
    // GET /api/accounting/bank-accounts — same endpoint this page loads on mount.
    liveCheck: async () => {
      const json = await getJSON("/api/accounting/bank-accounts");
      const n = (json.bankAccounts || []).length;
      return [{ label: n ? `${n} bank account(s) added so far` : "No bank accounts added yet", tone: n ? "ok" : "warn" }];
    },
    faqCategory: "Statements & Cash",
  },
  "/admin/accounting/format": {
    title: "Balance Sheet Format",
    body: "Which Schedule (A–J) each account head prints under on the statutory Balance Sheet — and which heads print under nothing.",
    flow: ["Unassigned head", "Drag onto a Schedule", "Prints in the right place"],
    // app/admin/accounting/format/PageClient.js
    steps: [
      "Check “Heads with no heading” at the top — those won't print correctly until placed.",
      "Drag a head from the unassigned list straight onto a Schedule box — the drop is the assignment.",
      "Or tick several unassigned heads, click a Schedule chip, then “Confirm” to assign them all at once.",
      "Use the toggle next to a placed head to show or hide it from the statement without unassigning it.",
    ],
    checklist: [
      "The Schedule headings (A–J) are fixed and shared by every society — you place heads under them, you don't rename them here.",
    ],
    watch: [
      "An unassigned head is a blocking check — it stops “Generate Balance Sheet” from running until it's placed.",
    ],
    // GET /api/accounting/chart-of-accounts — same call the page itself makes for its own unassigned-count banner.
    liveCheck: async () => {
      const acc = await getJSON("/api/accounting/chart-of-accounts?includeInactive=true");
      const accounts = (acc.accounts || []).filter((a) => a.isActive !== false);
      const unassigned = accounts.filter((a) => !a.scheduleCode).length;
      return [{
        label: unassigned ? `${unassigned} head(s) print under no heading right now` : "Every active head has a heading assigned",
        tone: unassigned ? "bad" : "ok",
      }];
    },
  },
  "/admin/accounting/statements": {
    title: "Generate Balance Sheet",
    body: "Five tabs, one page: Full Statement Pack, Income & Expenditure, Balance Sheet, Trial Balance & Checks, Year-End Close.",
    flow: ["Trial Balance & Checks", "Full Statement Pack", "Balance Sheet", "Income & Expenditure", "Year-End Close"],
    // app/admin/accounting/statements/PageClient.js (StatementsWorkspace)
    steps: [
      "Open the “Trial Balance & Checks” tab first — fix anything it flags before generating anything.",
      "Open “Full Statement Pack” to generate Income, Expenditure, Assets, Liabilities and validation together, in one document.",
      "Open “Balance Sheet” for the standalone statutory Liabilities | Assets format.",
      "Open “Income & Expenditure” for that statement on its own.",
      "Open “Year-End Close” to run the seven closing checks and move the financial year toward Locked.",
    ],
    checklist: [
      "Numbers here read wrong until the other 5 setup pages (Account Heads, Registers, Cash Flow, Format) are complete — fix those first, not the statement.",
    ],
    watch: [
      "Once a year reaches Locked in Year-End Close, reopening it is a SuperAdmin-only exception — not something you undo yourself.",
    ],
    // Reuses the setup-progress endpoint: statements only read correctly once setup is fully done.
    liveCheck: async () => {
      const json = await getJSON("/api/accounting/setup/run");
      const steps = json.steps || [];
      const states = json.states || {};
      const done = steps.filter((s) => states[s.key]?.done === true).length;
      const total = steps.length || 6;
      const ready = total > 0 && done === total;
      return [{
        label: ready ? "Setup is complete — statement numbers should be trustworthy" : `Setup is only ${done} of ${total} done — statements may read wrong until it's finished`,
        tone: ready ? "ok" : "bad",
      }];
    },
    faqCategory: "Statements & Cash",
  },
  "/admin/dashboard": {
    title: "Admin Dashboard",
    body: "The landing page after login: what the society is owed today, how this month's collection is going, which flats owe, and what needs you next.",
    flow: ["Pick the month", "Read the headline", "Click a flat on the map", "Act on Needs attention"],
    // app/admin/dashboard/PageClient.js
    steps: [
      "Pick the month in the header. The financial year beside it is worked out from the month, and the choice stays in the address bar so links keep it.",
      "The large figure is what every flat owes today, across all open bills. The sentence under it compares this month's collection with the same day last month.",
      "The Society Map shows every flat by wing and floor. Red flats owe money (darker means older). Click one to record a payment, send a reminder or open its ledger. Shift-click to select several and remind them together.",
      "Quick actions (Record payment, Generate bills, Send reminders…) live in the command palette: press / or ⌘K.",
    ],
    checklist: [
      "Check the month in the header before reading the monthly figures. The headline and the map always show today's position.",
    ],
    // GET /api/admin/dashboard-stats — same call the page makes, for the period showing right now.
    liveCheck: async () => {
      const now = new Date();
      const json = await getJSON(`/api/admin/dashboard-stats?month=${now.getMonth() + 1}&year=${now.getFullYear()}&fyYear=${now.getFullYear()}`);
      const rate = json?.period?.collectionRate;
      const members = json?.totalMembers;
      const rows = [];
      if (typeof rate === "number") {
        rows.push({ label: `${rate}% collected so far this period`, tone: rate >= 80 ? "ok" : rate >= 50 ? "warn" : "bad" });
      }
      if (typeof members === "number") {
        rows.push({ label: `${members} member(s) in this society`, tone: "info" });
      }
      return rows;
    },
  },
  "/admin/view-members": {
    title: "Members",
    body: "Search, filter, and edit the member/flat directory — this page has no “add new member” form.",
    flow: ["Search or filter", "Click a row", "Edit one section", "Save"],
    // app/admin/view-members/PageClient.js
    steps: [
      "Search by flat, wing, name, phone, or email in the search bar.",
      "Narrow the list with the wing / status / ownership filters.",
      "Click a member row to open their editor drawer, split into sections.",
      "Edit only the section you need, then save that section — the others aren't touched.",
    ],
    checklist: [
      "To add a new member, go to Members → Import Members instead — one at a time or in bulk from a spreadsheet.",
    ],
    watch: [
      "If someone should exist but doesn't show up here, check Import Members' history — they may not have been imported yet.",
    ],
    // GET /api/members/list — same endpoint this page loads on mount.
    liveCheck: async () => {
      const json = await getJSON("/api/members/list?limit=1000");
      return [{ label: `${memberCountFrom(json)} member(s) in the directory right now`, tone: "info" }];
    },
    faqCategory: "Members & Ledger",
  },
  "/admin/generate-bills": {
    title: "Generate Bills",
    body: "Three phases: generate this period's bills, record collections against them, then choose whether next month generates itself.",
    flow: ["Preview & Generate", "Record Collections", "Push now — or Push & schedule next month"],
    // app/admin/generate-bills/BillGenerationFlow.jsx, CollectionsPanel.jsx / ExcelBillUploadFlow.jsx, PaymentsProcessed.jsx, ScheduledBillCard.jsx
    steps: [
      "If your society has Commercial, pick Residential or Commercial — the two generate independently.",
      "Click “Preview Bills” — it computes every member's charges from Billing Config's rates and their own parking slots, without saving anything.",
      "If a unit shows under “skipped”, read its reason and click its “Fix” link to resolve it before generating.",
      "Click “Generate [Segment] Bills for N Members” to commit — bills now exist for this period.",
      "The Preview/Generate block turns into Record Collections — verify each payment row there (Residential: upload an Excel sheet; Commercial: enter them in the browser table).",
      "Once every row is verified, choose “Push now” (posts collections, next month stays fully manual) or “Push & schedule {next month}” (posts collections AND queues next month's bill run for a date you pick).",
      "If you chose schedule, set the date in “Generate {next month} bills on”, then click “Post & schedule”.",
    ],
    checklist: [
      "Confirm Billing Config's rates and Bill Template's layout are correct before you click Preview — both feed the numbers you're about to see.",
      "A scheduled next-month run shows as a card at the very top of this page (all segments) with “Run now”, “Reschedule”, and “Cancel this schedule” — that's the only place to check, change, or stop it.",
    ],
    watch: [
      "There's no per-member undo after Generate — a wrong rate or bad layout ships to everyone at once. Catch it in Preview, not after.",
      "“Push now” does NOT schedule next month — if you want it automatic, you must pick “Push & schedule” on the Record Collections screen. Nothing else on this page starts it.",
      "Cancelling a scheduled run stops next month's bills from being created automatically — you'd have to come back and generate them by hand.",
    ],
    // GET /api/bills/scheduled-runs — same endpoint ScheduledBillCard itself polls, so this answers "is next month scheduled?" for real.
    liveCheck: async () => {
      const json = await getJSON("/api/bills/scheduled-runs");
      const runs = (json.runs || []).filter((r) => ["SCHEDULED", "RUNNING", "FAILED"].includes(r.status));
      if (!runs.length) {
        return [{ label: "No next-month bill run is scheduled right now — next month stays manual unless you schedule one", tone: "warn" }];
      }
      return runs.map((r) => {
        const when = r.runAt ? new Date(r.runAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "an unset date";
        if (r.status === "FAILED") return { label: `${r.periodId || "A"} run FAILED — open the card above to retry or cancel it`, tone: "bad" };
        if (r.status === "RUNNING") return { label: `${r.periodId || "A"} run is creating bills right now`, tone: "warn" };
        return { label: `${r.periodId || "Next"} bills are scheduled to auto-generate on ${when}`, tone: "ok" };
      });
    },
    faqCategory: "Billing & Bills",
  },
  "/admin/ledger": {
    title: "Ledger",
    body: "Every posted transaction for a flat, member, or account head, with filters for member, category, mode, wing, date, amount, and balance status.",
    flow: ["Arrive pre-filtered, or set filters", "Group / sort", "Toggle columns", "Export or drill in"],
    // app/admin/ledger/PageClient.js
    steps: [
      "Arrive here pre-filtered to one member via a “View Ledger” search result or a Dashboard payment click — no manual filtering needed.",
      "Or set filters yourself: member, category, payment mode, wing, date range, amount range, balance status.",
      "Use “Group by” to roll transactions up by member or category instead of one long list.",
      "Toggle columns to show only what you need.",
    ],
    checklist: [
      "Combine a date range with an amount range to isolate one suspicious transaction before assuming it's a data error.",
    ],
    // GET /api/members/list — the same member set this page's filters draw from.
    liveCheck: async () => {
      const json = await getJSON("/api/members/list?limit=1000");
      return [{ label: `${memberCountFrom(json)} member(s) available to filter by`, tone: "info" }];
    },
    faqCategory: "Members & Ledger",
  },
};
