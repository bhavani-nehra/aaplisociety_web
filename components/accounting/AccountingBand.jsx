"use client";
/**
 * Accounting home band — where the books stand right now: bank and cash, what
 * members owe, year surplus, the Books checks with a fix link each, and one-tap
 * shortcuts to the day-to-day pages. Figures come from the money insights
 * (overview + guide); nothing here is typed in.
 */
import Link from "next/link";
import { useMoneyInsights, inr, compact, currentFy, Skeleton } from "@/components/money/kit";

const SHORTCUTS = [
  ["Record payment", "/admin/payments"],
  ["Add expense", "/admin/expenditure"],
  ["Journal entry", "/admin/accounting/journal-entries"],
  ["Vouchers", "/admin/accounting/vouchers"],
  ["Ledger", "/admin/ledger"],
  ["Balance sheet", "/admin/accounting/year-summary"],
  ["Print statements", "/admin/accounting/statements?tab=print"],
  ["Auditor", "/admin/accounting/auditor"],
];

export default function AccountingBand() {
  const fy = currentFy();
  const ov = useMoneyInsights("overview", { fy });
  const guide = useMoneyInsights("guide", { fy });
  if (ov.isLoading || guide.isLoading) {
    return <div className="mn mn-grid" style={{ marginBottom: 20 }}><Skeleton h={110} span="mn-s3" /><Skeleton h={110} span="mn-s3" /><Skeleton h={110} span="mn-s3" /><Skeleton h={110} span="mn-s3" /></div>;
  }
  const d = ov.data;
  const checks = guide.data?.checks || [];
  const bad = checks.filter((c) => !c.ok);
  const bank = (d?.bank?.accounts || []).filter((a) => a.kind === "Bank").reduce((s, a) => s + a.balance, 0);
  const cash = (d?.bank?.accounts || []).filter((a) => a.kind === "Cash").reduce((s, a) => s + a.balance, 0);
  const booksOn = d?.bank?.available;
  return (
    <div className="mn" style={{ display: "grid", gap: 14, marginBottom: 22 }}>
      <div className="mn-grid">
        <Link href="/admin/accounting/registers" className="mn-dk mn-s3" style={{ textDecoration: "none" }}>
          <div className="mn-lbl">Bank</div>
          <div className="mn-num" style={{ fontSize: 26, marginTop: 6 }}>{booksOn ? inr(bank) : "—"}</div>
          <div className="mn-sub" style={{ marginTop: 4 }}>{booksOn ? "as per books" : "Turn on the books first"}</div>
        </Link>
        <Link href="/admin/accounting/registers" className="mn-card mn-s3" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="mn-lbl">Cash in hand</div>
          <div className="mn-num" style={{ fontSize: 26, marginTop: 6 }}>{booksOn ? inr(cash) : "—"}</div>
          <div className="mn-sub" style={{ marginTop: 4 }}>{booksOn ? "as per books" : "—"}</div>
        </Link>
        <Link href="/admin/late-payment" className="mn-card mn-s3" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="mn-lbl">Members owe</div>
          <div className="mn-num" style={{ fontSize: 26, marginTop: 6, color: "var(--mn-bad)" }}>{compact(d?.dues?.total)}</div>
          <div className="mn-sub" style={{ marginTop: 4 }}>{d?.dues?.units || 0} flats · {d?.dues?.overdueUnits || 0} late</div>
        </Link>
        <Link href="/admin/accounting/year-summary" className="mn-dk mn-s3" style={{ textDecoration: "none" }}>
          <div className="mn-lbl">Surplus this year</div>
          <div className="mn-num" style={{ fontSize: 26, marginTop: 6 }}>{compact(d?.fyTotals?.surplus)}</div>
          <div className="mn-sub" style={{ marginTop: 4 }}>{compact(d?.fyTotals?.collected)} in · {compact(d?.fyTotals?.spent)} out</div>
        </Link>
      </div>

      <div className="mn-grid">
        <div className="mn-card mn-s8">
          <div className="mn-h">
            <span className="mn-lbl">Books check · {checks.length - bad.length} of {checks.length} pass</span>
            <Link className="mn-link" href="/admin/accounting/your-year">Your year ›</Link>
          </div>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {checks.map((c) => (
              <div key={c.key} className="mn-row" style={{ justifyContent: "space-between", padding: "8px 12px", borderRadius: 14, background: c.ok ? "var(--mn-ok-bg)" : "var(--mn-bad-bg)" }}>
                <span className="mn-row" style={{ gap: 8, minWidth: 0 }}>
                  <b style={{ color: c.ok ? "var(--mn-ok)" : "var(--mn-bad)" }}>{c.ok ? "✓" : "✗"}</b>
                  <span style={{ minWidth: 0 }}><b style={{ fontSize: 13 }}>{c.label}</b><span className="mn-sub" style={{ display: "block" }}>{c.detail}</span></span>
                </span>
                {!c.ok && c.href ? <Link className="mn-btn solid" href={c.href}>Fix</Link> : null}
              </div>
            ))}
            {!checks.length && <div className="mn-sub">Checks appear once the books are on.</div>}
          </div>
        </div>
        <div className="mn-card mn-s4">
          <div className="mn-lbl">Shortcuts</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {SHORTCUTS.map(([l, h]) => <Link key={l} className="mn-btn" href={h}>{l}</Link>)}
          </div>
          <div className="mn-sub" style={{ marginTop: 14 }}>
            {bad.length ? `${bad.length} check${bad.length === 1 ? "" : "s"} need you before statements print.` : "Everything matches. Statements are safe to print."}
          </div>
        </div>
      </div>
    </div>
  );
}
