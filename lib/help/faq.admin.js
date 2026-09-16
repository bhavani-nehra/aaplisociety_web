/**
 * Admin FAQ content — docs/ux-overhaul/2026-09-01-faq-docs-hub-design.md
 * Phase 1. Plain data array, PR-editable, grep-able.
 *
 * Shape per entry: `question`, a one-line `answer` (the direct answer, not a
 * lead-in), and `steps` — the actual numbered click-path in the real page,
 * named exactly as the button/tab/field reads on screen (source noted in
 * each entry's comment). `steps` is omitted only on the couple of entries
 * that answer a yes/no with nothing to click.
 */
export const ADMIN_FAQ = [
  {
    category: "Getting Started",
    question: "Where do I start setting up the accounting module for the first time?",
    // app/admin/accounting/setup/PageClient.js
    answer: "Configuration → Guided Setup — six steps, run in order.",
    steps: [
      "Open Configuration → Guided Setup.",
      "Read each step's grey “when you press this” line before running it.",
      "Click “Preview & run all six” to see every step's diff at once, then “Confirm & run all” — or run steps one at a time with “Preview” → “Run this”.",
      "Done once the progress bar hits 100% — that's “The books are open.”",
    ],
  },
  {
    category: "Vouchers & Journal Entries",
    question: "What's the difference between a Voucher and a Journal Entry here?",
    // app/admin/accounting/vouchers/PageClient.js, journal-entries/PageClient.js
    answer: "A Voucher is the slip with a workflow; a Journal Entry is what actually posted once it cleared that workflow.",
    steps: [
      "Open Configuration → Vouchers — every receipt/payment/adjustment slip lives here, tagged Draft, Pending approval, or Cancelled.",
      "A Draft voucher stays here and never appears anywhere else.",
      "Once a voucher clears approval, open The Books (Configuration → Journal Entries) — only posted entries show up there.",
    ],
  },
  {
    category: "Vouchers & Journal Entries",
    question: "Why can't I edit a Journal Entry directly on The Books page?",
    // app/admin/accounting/journal-entries/PageClient.js (read-only by design)
    answer: "The Books page is read-only by design — correct a mistake with a new adjusting voucher instead.",
    steps: [
      "Open Configuration → Vouchers and create a new adjusting voucher for the correction.",
      "Get it approved the same way as any other voucher — it posts as a new Journal Entry.",
      "Check Audit Trail (Configuration → Corrections) — the adjustment shows there, so the change is on record.",
    ],
  },
  {
    category: "Vouchers & Journal Entries",
    question: "I expanded an entry and it shows two amounts — why?",
    // app/admin/accounting/vouchers/PageClient.js ("Why every entry opens to show two halves")
    answer: "Every entry has two sides that must match — debit and credit — shown together on purpose.",
    steps: [
      "Click any row in Vouchers or The Books to expand it.",
      "Read the two lines — the account names are spelled out, e.g. a maintenance receipt debits Cash and credits Dues from Members for the same amount.",
    ],
  },
  {
    category: "Financial Years",
    question: "How do I close a financial year?",
    // app/admin/accounting/financial-years/PageClient.js (CHAIN), statements/YearEndClose.jsx
    answer: "Run Year-End Close, not Financial Years — that page only tracks Draft → Locked status.",
    steps: [
      "Open Statements → Year-End Close.",
      "Clear all seven checks: Trial Balance balanced, every head has a Schedule, default account mappings set, no vouchers left in Draft, depreciation posted, bank statements reconciled, no overdue liabilities.",
      "Move the year through Draft → Reviewed → Auditor Review → Approved → Locked once every check clears.",
    ],
    watch: [
      "Locked means no further entries — reopening a Locked year is a SuperAdmin-only exception, done from the SuperAdmin console, not something you can undo yourself.",
    ],
  },
  {
    category: "Financial Years",
    question: "Do I need to enter the financial year's start and end dates myself?",
    // app/admin/accounting/financial-years/PageClient.js ("getFinancialYearRange()")
    answer: "No — Financial Years defaults the label and dates from the society's own FY range automatically.",
    steps: [
      "Open Configuration → Financial Years — the current year is already filled in.",
      "Click the custom-dates link only if this society's year genuinely runs on different dates.",
    ],
  },
  {
    category: "Automatic Entries & Book Checks",
    question: "What is a Posting Rule / Automatic Entry?",
    // app/admin/accounting/posting-rules/PageClient.js
    answer: "A rule that auto-posts a debit/credit pair whenever a chosen event happens — for example, a payment recorded in Cash.",
    steps: [
      "Open Configuration → Automatic Entries.",
      "Read a rule's trigger and its debit/credit lines, both written in plain language.",
      "No account-key knowledge needed — each rule already reads as “when X happens, debit A and credit B”.",
    ],
  },
  {
    category: "Automatic Entries & Book Checks",
    question: "Why does a rule still say “Debit” and “Credit” instead of “money in” and “money out”?",
    // app/admin/accounting/posting-rules/PageClient.js ("Why Debit and Credit are NOT translated away")
    answer: "Because that translation is wrong half the time — Debit means money in for Cash, but money in for a maintenance bill CREDITS Income.",
  },
  {
    category: "Automatic Entries & Book Checks",
    question: "What does a “blocking” Book Check mean?",
    // app/admin/accounting/validation-rules/PageClient.js
    answer: "That specific check failing stops a statement from generating at all.",
    steps: [
      "Open Configuration → Book Checks.",
      "Find the rule marked blocking and read its plain-language description of what it stops.",
      "Fix what it names, then try generating the statement again.",
    ],
  },
  {
    category: "Registers",
    question: "Why does registering a Fixed Asset ask for account heads I don't recognise?",
    // app/admin/accounting/assets/PageClient.js ("The four account heads are pre-chosen and folded away")
    answer: "Registering an asset posts a real purchase entry immediately — the four heads it needs are pre-selected and folded away.",
    steps: [
      "Open Accounting → Assets & Liabilities → Fixed Assets, and register the asset.",
      "Open “Where this posts” if you want to check or change the four pre-selected heads (Fixed Assets, Depreciation, Accumulated Depreciation, Cash at Bank) before confirming.",
    ],
  },
  {
    category: "Registers",
    question: "What's the difference between the Funds and Liabilities registers?",
    // app/admin/accounting/funds/PageClient.js, liabilities/PageClient.js
    answer: "Funds are the society's own reserve money; Liabilities are what it owes someone else.",
    steps: [
      "Open Accounting → Assets & Liabilities → Funds to contribute to, withdraw from, or transfer between Reserve/Sinking/Repair/Corpus funds.",
      "Open the Liabilities section on the same page to record a vendor payable, loan, deposit, advance, or statutory tax, or mark one paid off.",
    ],
  },
  {
    category: "Statements & Cash",
    question: "Why is an account head missing from the Balance Sheet?",
    // app/admin/accounting/format/PageClient.js ("accountsMissingScheduleCode")
    answer: "It has no Schedule code — a head with none is dropped or misplaced, and it blocks generation until fixed.",
    steps: [
      "Open Configuration → Balance Sheet Format.",
      "Check the “Heads with no heading” count at the top.",
      "Drag the head onto a Schedule box, or tick it, pick a Schedule chip, and click “Confirm”.",
    ],
  },
  {
    category: "Statements & Cash",
    question: "What counts as “cash” versus “bank” for the accounting module?",
    // app/admin/accounting/cash-flow/PageClient.js, bank-accounts/PageClient.js
    answer: "That split, and reconciling each bank account against its statement, is set up on Cash Flow Setup.",
    steps: [
      "Open Configuration → Cash Flow Setup.",
      "Click “+ Add a bank account” to register one against a Bank-subtype head.",
      "Upload an Excel bank statement, click “Suggest” for proposed matches, then “Confirm” (or “Undo”) each one — this is also what Trial Balance and cash reports read from.",
    ],
  },
  {
    category: "Billing & Bills",
    question: "What actually happens when I click “Generate Bills”?",
    // app/admin/generate-bills/BillGenerationFlow.jsx ("Preview Bills" -> Preview Modal -> "Generate {segment} Bills for {N} Members")
    answer: "Nothing is created until the second button — Preview only calculates.",
    steps: [
      "Click “Preview Bills” — it calculates every member's charges from Billing Config's rates and their own parking slots, without saving.",
      "Page through the preview, one member at a time.",
      "Click “Generate [Segment] Bills for N Members” only once the preview looks right — this is the step that actually creates bills, for everyone previewed, at once.",
    ],
    watch: [
      "There's no per-member undo after Generate — catch a wrong rate or a skipped unit in Preview, not after.",
    ],
  },
  {
    category: "Billing & Bills",
    question: "The preview says some units were “left out” — why, and what do I do?",
    // app/admin/generate-bills/BillGenerationFlow.jsx (previewSkipped list with reason + fixHref)
    answer: "Each skipped unit lists a plain-language reason and, where possible, a direct “Fix” link.",
    steps: [
      "In the Preview Bills screen, find the unit under the skipped list.",
      "Read its reason — usually a missing rate in Billing Config, or a member missing required area/parking data.",
      "Click its “Fix” link, resolve the issue, then re-run Preview Bills — generating without fixing it just leaves that unit unbilled this cycle.",
    ],
  },
  {
    category: "Billing & Bills",
    question: "Residential and Commercial billing look like separate flows — are they?",
    // app/admin/generate-bills/page.js (segment switch, hasCommercial from /api/entitlements)
    answer: "Yes — the segment switch only appears if Commercial is enabled, and each segment generates independently.",
    steps: [
      "If the switch is visible, pick Residential or Commercial before clicking Preview Bills.",
      "Finishing one segment for a period does not generate the other — repeat Preview → Generate for the second segment separately.",
    ],
  },
  {
    category: "Billing & Bills",
    question: "How do I make next month's bills generate on their own, without me clicking Generate again?",
    // app/admin/generate-bills/PaymentsProcessed.jsx ("push" | "schedule"), ScheduledBillCard.jsx
    answer: "You have to opt in on the Record Collections screen — Generate on its own never schedules anything.",
    steps: [
      "Generate this period's bills as usual (Preview Bills → Generate).",
      "Record collections against them (Excel upload for Residential, the in-browser table for Commercial), and verify every row.",
      "On the “All rows verified” screen, click “Push & schedule {next month}” instead of “Push now”.",
      "Pick the date under “Generate {next month} bills on”, then click “Post & schedule”.",
      "Check the card at the top of the Generate Bills page any time — it shows the scheduled run and lets you “Run now”, “Reschedule”, or “Cancel this schedule”.",
    ],
    watch: [
      "“Push now” posts collections but leaves next month fully manual — it's easy to pick that by habit and get no automatic run.",
    ],
  },
  {
    category: "Members & Ledger",
    question: "I can't find where to add a brand-new member on the Members page — is it broken?",
    // app/admin/view-members/PageClient.js (search/filter/edit only, no create form)
    answer: "Not broken — Members is search/edit-only by design; new members are added elsewhere.",
    steps: [
      "Go to Members → Import Members.",
      "Add one member by hand, or upload a spreadsheet to add several at once.",
      "If someone you expected isn't showing on View Members, check Import Members' history first — they may not be imported yet.",
    ],
  },
  {
    category: "Members & Ledger",
    question: "How do I see one member's full transaction history without hunting through the Ledger filters?",
    // app/admin/ledger/PageClient.js (memberId query param read on mount) + Dashboard payment-row onClick
    answer: "Search for them, or click their Dashboard payment row — both land pre-filtered on Ledger.",
    steps: [
      "Press ⌘K (or “/”) and search the member's name, then open their “View Ledger” result — or click their row in the Dashboard's payment list.",
      "Either path opens Ledger pre-filtered to that member (`?memberId=`) — no manual filtering needed.",
    ],
  },
];
