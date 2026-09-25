"use client";
import { useState, useEffect, useCallback } from "react";
// ── constants ─────────────────────────────────────────────────────────────────
const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const DEFAULT_CONFIG = {
  interestRate: 18,
  gracePeriodDays: 1,
  billDueDay: 10,
  interestRounding: "TWO_DECIMAL",
  interestTriggerTiming: "NEXT_DAY",
  allocationMode: "INTEREST_FIRST",
  charges: 4540,
};
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmt(v) {
  return `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}
function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTH_NAMES[parseInt(m)]} ${y}`;
}
// ── small components ──────────────────────────────────────────────────────────
function Badge({ status }) {
  const map = {
    Paid: "bg-green-100 text-green-800",
    Partial: "bg-yellow-100 text-yellow-800",
    Unpaid: "bg-red-100 text-red-800",
    Overdue: "bg-orange-100 text-orange-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${map[status] || "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}
function PassBadge({ passed }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-bold ${passed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
      {passed ? "✓ PASS" : "✗ FAIL"}
    </span>
  );
}
function Field({ label, children }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-500 w-44 flex-shrink-0">{label}</label>
      {children}
    </div>
  );
}
function NumInput({ value, onChange, className = "" }) {
  return (
    <input type="number" value={value}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className={`border border-gray-300 rounded px-2 py-1 text-sm flex-1 ${className}`} />
  );
}
function DateInput({ value, onChange, className = "" }) {
  return (
    <input type="date" value={value}
      onChange={e => onChange(e.target.value)}
      className={`border border-gray-300 rounded px-2 py-1 text-sm flex-1 ${className}`} />
  );
}
// ── SETUP SCREEN ──────────────────────────────────────────────────────────────
function SetupScreen({ onStart }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [allMembers, setAllMembers] = useState([]);
  const [search, setSearch] = useState("");
  const [member, setMember] = useState(null);
  const [openingPrincipal, setOpeningPrincipal] = useState(0);
  const [openingInterest, setOpeningInterest] = useState(0);
  const [advanceCredit, setAdvanceCredit] = useState(0);
  useEffect(() => {
    fetch("/api/billing-simulator/members")
      .then(r => r.json())
      .then(d => { if (d.members) setAllMembers(d.members); })
      .catch(() => {});
  }, []);
  const setCfg = (key, val) => setConfig(c => ({ ...c, [key]: val }));
  const filtered = allMembers.filter(m =>
    search === "" ||
    m.name?.toLowerCase().includes(search.toLowerCase()) ||
    m.flatNo?.includes(search) ||
    m.wing?.toLowerCase().includes(search.toLowerCase())
  );
  function selectMember(m) {
    setMember(m);
    setOpeningPrincipal(m.openingPrincipal || 0);
    setOpeningInterest(m.openingInterest || 0);
    setAdvanceCredit(m.advanceCredit || 0);
    setSearch("");
  }
  function start() {
    if (!member) return;
    onStart({
      config,
      member: {
        id: member.id || member._id,
        name: member.name || member.ownerName,
        flat: member.flat || `${member.wing}-${member.flatNo}`,
        wing: member.wing,
        flatNo: member.flatNo,
        openingPrincipal,
        openingInterest,
        advanceCredit,
      },
    });
  }
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h2 className="text-lg font-bold text-gray-800">Step 1 — Setup</h2>
      {/* Society Config */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
        <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide mb-1">Society Config</h3>
        <Field label="Interest Rate (% p.a.)">
          <NumInput value={config.interestRate} onChange={v => setCfg("interestRate", v)} />
        </Field>
        <Field label="Grace Period (days)">
          <NumInput value={config.gracePeriodDays} onChange={v => setCfg("gracePeriodDays", v)} />
        </Field>
        <Field label="Bill Due Day">
          <NumInput value={config.billDueDay} onChange={v => setCfg("billDueDay", v)} />
        </Field>
        <Field label="Monthly Charges (₹)">
          <NumInput value={config.charges} onChange={v => setCfg("charges", v)} />
        </Field>
        <Field label="Interest Rounding">
          <select value={config.interestRounding} onChange={e => setCfg("interestRounding", e.target.value)}
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="TWO_DECIMAL">Two Decimal</option>
            <option value="ROUND_UP">Round Up (ceil 2dp)</option>
            <option value="ROUND_UP_INT">Round Up Integer</option>
          </select>
        </Field>
        <Field label="Interest Trigger">
          <select value={config.interestTriggerTiming} onChange={e => setCfg("interestTriggerTiming", e.target.value)}
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="NEXT_DAY">Next Day (day after grace ends)</option>
            <option value="SAME_DAY">Same Day (on grace end day)</option>
          </select>
        </Field>
        <Field label="Payment Allocation">
          <select value={config.allocationMode} onChange={e => setCfg("allocationMode", e.target.value)}
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="INTEREST_FIRST">Interest First</option>
            <option value="PRINCIPAL_FIRST">Principal First</option>
          </select>
        </Field>
      </div>

      {/* Member selection */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
        <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide mb-1">Select Member</h3>
        {member ? (
          <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
            <div>
              <div className="font-bold text-blue-800">{member.name || member.ownerName}</div>
              <div className="text-xs text-blue-600">{member.flat || `${member.wing}-${member.flatNo}`}</div>
            </div>
            <button onClick={() => setMember(null)} className="text-blue-400 hover:text-blue-700 text-lg font-bold">×</button>
          </div>
        ) : (
          <div>
            <input type="text" placeholder="Search by name or flat…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-2" />
            {search && (
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded divide-y">
                {filtered.length === 0 && <div className="text-xs text-gray-400 px-3 py-2">No members found</div>}
                {filtered.map(m => (
                  <button key={m.id || m._id} onClick={() => selectMember(m)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm">
                    <div className="font-medium text-gray-800">{m.name || m.ownerName}</div>
                    <div className="text-xs text-gray-500">{m.wing}-{m.flatNo}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {/* Opening balances */}
      {member && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
          <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide mb-1">Opening Balances</h3>
          <Field label="Opening Principal (₹)">
            <NumInput value={openingPrincipal} onChange={setOpeningPrincipal} />
          </Field>
          <Field label="Opening Interest (₹)">
            <NumInput value={openingInterest} onChange={setOpeningInterest} />
          </Field>
          <Field label="Advance Credit (₹)">
            <NumInput value={advanceCredit} onChange={setAdvanceCredit} />
          </Field>
        </div>
      )}
      <button onClick={start} disabled={!member}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold py-3 rounded-xl text-sm transition-colors">
        Start Simulation →
      </button>
    </div>
  );
}
// ── RUNNING SCREEN ────────────────────────────────────────────────────────────
function RunningScreen({ config, member, actions, snapshots, ledger, finalCarry, onAddAction, onFinish, loading, error }) {
  const today = todayISO();
  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;
  const [actionType, setActionType] = useState("generate");
  // Generate form
  const [genYear, setGenYear] = useState(defaultYear);
  const [genMonth, setGenMonth] = useState(defaultMonth);
  const [genDate, setGenDate] = useState(today);
  const [genCharges, setGenCharges] = useState(config.charges);
  // Pay form
  const [payPeriod, setPayPeriod] = useState("");
  const [payDate, setPayDate] = useState(today);
  const [payAmount, setPayAmount] = useState(0);
  // Unpaid bills from last snapshot carryOut (or member opening)
  const lastSnap = snapshots[snapshots.length - 1];
  const carryOut = lastSnap?.carryOut || {
    openingPrincipal: member.openingPrincipal,
    openingInterest: member.openingInterest,
    advanceCredit: member.advanceCredit,
  };
  // Unpaid bills across all snapshots (those without full payment)
  const unpaidPeriods = snapshots
    .filter(s => !s.payment || s.bill.status !== "Paid")
    .map(s => s.billPeriodId);
  function submitGenerate() {
    onAddAction({
      type: "generate",
      year: genYear,
      month: genMonth,
      generationDate: genDate,
      charges: genCharges,
    });
    // Advance month for convenience
    const next = genMonth === 12 ? 1 : genMonth + 1;
    const nextY = genMonth === 12 ? genYear + 1 : genYear;
    setGenMonth(next);
    setGenYear(nextY);
  }
  function submitPay() {
    onAddAction({
      type: "pay",
      billPeriodId: payPeriod,
      paymentDate: payDate,
      amount: parseFloat(payAmount) || 0,
    });
  }
  // Auto-select first unpaid period when switching to pay
  useEffect(() => {
    if (actionType === "pay" && unpaidPeriods.length > 0 && !payPeriod) {
      setPayPeriod(unpaidPeriods[0]);
    }
  }, [actionType, unpaidPeriods.length]);
  return (
    <div className="grid grid-cols-12 gap-5">
      {/* LEFT — action panel */}
      <div className="col-span-4 space-y-4">
        {/* Member header */}
        <div className="bg-blue-600 text-white rounded-xl px-4 py-3">
          <div className="font-bold">{member.name}</div>
          <div className="text-blue-200 text-xs">{member.flat}</div>
        </div>
        {/* Carry state */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-bold text-gray-500 uppercase mb-2">Current Outstanding</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xs text-gray-400">Principal</div>
              <div className="font-bold text-red-600 text-sm">{fmt(carryOut.openingPrincipal)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Interest</div>
              <div className="font-bold text-orange-500 text-sm">{fmt(carryOut.openingInterest)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Advance</div>
              <div className="font-bold text-green-600 text-sm">{fmt(carryOut.advanceCredit)}</div>
            </div>
          </div>
        </div>
        {/* Action toggle */}
        <div className="flex rounded-lg overflow-hidden border border-gray-200">
          <button onClick={() => setActionType("generate")}
            className={`flex-1 py-2 text-sm font-medium ${actionType === "generate" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            Generate Bill
          </button>
          <button onClick={() => setActionType("pay")}
            className={`flex-1 py-2 text-sm font-medium ${actionType === "pay" ? "bg-green-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            Record Payment
          </button>
        </div>
        {/* Generate form */}
        {actionType === "generate" && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
            <div className="text-xs font-bold text-gray-500 uppercase">Generate Bill</div>
            <Field label="Year">
              <NumInput value={genYear} onChange={setGenYear} />
            </Field>
            <Field label="Month">
              <select value={genMonth} onChange={e => setGenMonth(parseInt(e.target.value))}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm">
                {MONTH_NAMES.slice(1).map((n, i) => (
                  <option key={i+1} value={i+1}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="Generation Date">
              <DateInput value={genDate} onChange={setGenDate} />
            </Field>
            <Field label="Charges (₹)">
              <NumInput value={genCharges} onChange={setGenCharges} />
            </Field>
            <div className="text-xs text-gray-400 bg-yellow-50 border border-yellow-100 rounded p-2">
              Interest eligibility checked against <strong>Generation Date</strong> vs dueDate+grace ({config.gracePeriodDays}d, {config.interestTriggerTiming})
            </div>
            <button onClick={submitGenerate} disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold py-2 rounded-lg text-sm">
              Generate Bill for {MONTH_NAMES[genMonth]} {genYear}
            </button>
          </div>
        )}
        {/* Pay form */}
        {actionType === "pay" && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
            <div className="text-xs font-bold text-gray-500 uppercase">Record Payment</div>
            <Field label="Bill Period">
              <select value={payPeriod} onChange={e => setPayPeriod(e.target.value)}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm">
                <option value="">Select period…</option>
                {snapshots.map(s => (
                  <option key={s.billPeriodId} value={s.billPeriodId}>{s.billPeriodId}</option>
                ))}
              </select>
            </Field>
            <Field label="Payment Date">
              <DateInput value={payDate} onChange={setPayDate} />
            </Field>
            <Field label="Amount (₹)">
              <NumInput value={payAmount} onChange={setPayAmount} />
            </Field>
            {payPeriod && (() => {
              const snap = snapshots.find(s => s.billPeriodId === payPeriod);
              if (!snap) return null;
              return (
                <div className="text-xs text-gray-500 bg-gray-50 rounded p-2 space-y-0.5">
                  <div>Total Bill Due: <strong>{fmt(snap.bill.totalBillDue)}</strong></div>
                  <div>Principal: {fmt(snap.bill.billPrincipalBalance)} | Interest: {fmt(snap.bill.billInterestBalance)}</div>
                </div>
              );
            })()}
            <button onClick={submitPay} disabled={loading || !payPeriod}
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-bold py-2 rounded-lg text-sm">
              Record Payment
            </button>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}
        <button onClick={onFinish}
          className="w-full border border-blue-600 text-blue-600 hover:bg-blue-50 font-bold py-2 rounded-xl text-sm">
          View Summary →
        </button>
      </div>
      {/* RIGHT — live results */}
      <div className="col-span-8 space-y-4">
        {snapshots.length === 0 && (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-400 text-sm">
            Generate the first bill to begin simulation.
          </div>
        )}
        {/* Month cards */}
        {snapshots.map((snap, idx) => (
          <MonthCard key={snap.billPeriodId} snap={snap} idx={idx} />
        ))}
        {/* Ledger */}
        {ledger.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="text-xs font-bold text-gray-500 uppercase mb-3">Monthly Summary</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b">
                  <th className="text-left pb-1">Month</th>
                  <th className="text-right pb-1">Bill Due</th>
                  <th className="text-right pb-1">Paid</th>
                  <th className="text-right pb-1">Balance</th>
                  <th className="text-left pb-1 pl-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.billPeriodId} className="border-b border-gray-50">
                    <td className="py-1 text-gray-700 font-medium">{e.billPeriodId}</td>
                    <td className="py-1 text-right font-mono text-gray-700">{fmt(e.totalBillDue)}</td>
                    <td className="py-1 text-right font-mono text-green-600">{e.amountPaid > 0 ? fmt(e.amountPaid) : "—"}</td>
                    <td className="py-1 text-right font-mono font-bold text-gray-900">{fmt(e.balance)}</td>
                    <td className="py-1 pl-2">
                      <Badge status={e.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
// ── MONTH CARD ────────────────────────────────────────────────────────────────
function MonthCard({ snap, idx }) {
  const [open, setOpen] = useState(true);
  const b = snap.bill;
  const p = snap.payment;
  const c = snap.closing;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 bg-gray-50 hover:bg-gray-100">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-gray-400">#{idx + 1}</span>
          <span className="font-bold text-gray-800">{snap.billPeriodId}</span>
          <Badge status={b.status} />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-500">Bill Due {fmt(b.totalBillDue)}</span>
          {c && <span className="text-blue-600 text-xs">Closing {fmt(c.closingTotal)}</span>}
          {p && <span className="text-green-600 font-bold">Paid {fmt(p.amount)}</span>}
          <span className="text-gray-400">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <div className="px-5 py-4 space-y-4">
          {/* Bill State — immutable pre-payment snapshot */}
          <div className="space-y-1">
            <div className="text-xs font-bold text-blue-500 uppercase">Bill State (Pre-Payment)</div>
            <Row label="Generation Date" val={fmtDate(b.generationDate)} />
            <Row label="Due Date" val={fmtDate(b.dueDate)} />
            <div className="border-t pt-1 mt-1">
              <Row label="Opening Principal" val={fmt(b.openingPrincipal)} highlight={b.openingPrincipal > 0 ? "red" : ""} />
              <Row label="Current Charges" val={fmt(b.currentCharges)} />
              <Row label="Bill Principal" val={fmt(b.billPrincipalBalance)} bold />
            </div>
            <div className="border-t pt-1 mt-1">
              <Row label="Opening Interest" val={fmt(b.openingInterest)} highlight={b.openingInterest > 0 ? "orange" : ""} />
              <Row label="Current Interest" val={fmt(b.currentInterest)} highlight={b.currentInterest > 0 ? "orange" : ""} />
              <Row label="Bill Interest" val={fmt(b.billInterestBalance)} bold />
            </div>
            <div className="border-t pt-1 mt-1 bg-blue-50 rounded px-2 py-1">
              <Row label="Total Bill Due" val={fmt(b.totalBillDue)} bold />
            </div>
          </div>
          {/* Closing State — post-payment snapshot */}
          {p && snap.closing ? (
            <div className="space-y-1">
              <div className="text-xs font-bold text-green-600 uppercase">Closing State (Post-Payment)</div>
              <Row label="Payment Date" val={fmtDate(p.paymentDate)} />
              <Row label="Amount Paid" val={fmt(p.amount)} />
              <div className="border-t pt-1 mt-1">
                <Row label="Interest Cleared" val={fmt(snap.closing.interestCleared)} highlight="green" />
                <Row label="Principal Cleared" val={fmt(snap.closing.principalCleared)} highlight="green" />
              </div>
              <div className="border-t pt-1 mt-1">
                <Row label="Closing Principal" val={fmt(snap.closing.closingPrincipal)} highlight={snap.closing.closingPrincipal > 0 ? "red" : ""} />
                <Row label="Closing Interest" val={fmt(snap.closing.closingInterest)} highlight={snap.closing.closingInterest > 0 ? "orange" : ""} />
                <div className="bg-green-50 rounded px-2 py-1 mt-1">
                  <Row label="Closing Total" val={fmt(snap.closing.closingTotal)} bold />
                </div>
              </div>
              {p.advanceCredit > 0 && (
                <div className="border-t pt-1 mt-1">
                  <Row label="Advance Credit" val={fmt(p.advanceCredit)} highlight="green" />
                </div>
              )}
              <div className="border-t pt-1 mt-1">
                <div className="text-xs font-bold text-gray-400 uppercase">Next Month Carry</div>
                <Row label="Opening Principal" val={fmt(snap.carryOut.openingPrincipal)} />
                <Row label="Opening Interest" val={fmt(snap.carryOut.openingInterest)} />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center text-gray-400 text-sm border border-dashed border-gray-200 rounded-lg">
              No payment recorded yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function Row({ label, val, bold, highlight }) {
  const color = highlight === "red" ? "text-red-600" : highlight === "orange" ? "text-orange-500" : highlight === "green" ? "text-green-600" : "text-gray-800";
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${bold ? "font-bold" : ""} ${color}`}>{val}</span>
    </div>
  );
}
// ── SUMMARY SCREEN ────────────────────────────────────────────────────────────
function SummaryScreen({ config, member, snapshots, ledger, finalCarry, testCases, onReset, onBack }) {
  const allPassed = testCases?.every(t => t.passed);
  function downloadLedger() {
    const rows = [
      ["Month", "Due Date", "Principal Due", "Interest Due", "Total Due", "Amount Paid", "Balance", "Status"],
      ...ledger.map(e => [e.billPeriodId, e.dueDate, e.principalDue, e.interestDue, e.totalBillDue, e.amountPaid, e.balance, e.status]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `ledger_${member.flat}_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">Simulation Summary — {member.name} ({member.flat})</h2>
        <div className="flex gap-2">
          <button onClick={onBack} className="border border-gray-300 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm">← Back</button>
          <button onClick={downloadLedger} className="border border-blue-300 text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg text-sm">↓ CSV</button>
          <button onClick={onReset} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">New Simulation</button>
        </div>
      </div>
      {/* Final balances */}
      {finalCarry && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white border border-red-100 rounded-xl p-4 shadow-sm text-center">
            <div className="text-xs text-gray-400 uppercase mb-1">Final Principal</div>
            <div className="text-2xl font-bold text-red-600">{fmt(finalCarry.openingPrincipal)}</div>
          </div>
          <div className="bg-white border border-orange-100 rounded-xl p-4 shadow-sm text-center">
            <div className="text-xs text-gray-400 uppercase mb-1">Final Interest</div>
            <div className="text-2xl font-bold text-orange-500">{fmt(finalCarry.openingInterest)}</div>
          </div>
          <div className="bg-white border border-green-100 rounded-xl p-4 shadow-sm text-center">
            <div className="text-xs text-gray-400 uppercase mb-1">Advance Credit</div>
            <div className="text-2xl font-bold text-green-600">{fmt(finalCarry.advanceCredit)}</div>
          </div>
        </div>
      )}
      {/* Month-by-month */}
      <div className="space-y-3">
        {snapshots.map((snap, idx) => (
          <MonthCard key={snap.billPeriodId} snap={snap} idx={idx} />
        ))}
      </div>
      {/* Test cases */}
      {testCases?.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold text-gray-500 uppercase">Validation Test Cases</div>
            <span className={`px-2 py-1 rounded text-xs font-bold ${allPassed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
              {testCases.filter(t => t.passed).length}/{testCases.length} passed
            </span>
          </div>
          <div className="space-y-2">
            {testCases.map(tc => (
              <div key={tc.name} className="flex items-start gap-3 text-xs py-1 border-b border-gray-50 last:border-0">
                <PassBadge passed={tc.passed} />
                <div className="flex-1">
                  <span className="font-mono font-bold text-gray-700">{tc.name}</span>
                  {!tc.passed && (
                    <div className="text-red-600 mt-0.5">
                      Expected: {String(tc.expected)} | Got: {String(tc.actual)}
                    </div>
                  )}
                  {tc.note && <div className="text-gray-400">{tc.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Full ledger */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="text-xs font-bold text-gray-500 uppercase mb-3">Monthly Outstanding Summary</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 border-b">
              <th className="text-left pb-1">Month</th>
              <th className="text-left pb-1">Due Date</th>
              <th className="text-right pb-1">Principal Due</th>
              <th className="text-right pb-1">Interest Due</th>
              <th className="text-right pb-1">Total Due</th>
              <th className="text-right pb-1">Paid</th>
              <th className="text-right pb-1">Balance</th>
              <th className="text-left pb-1 pl-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((e) => (
              <tr key={e.billPeriodId} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-1 font-medium text-gray-800">{e.billPeriodId}</td>
                <td className="py-1 text-gray-500">{fmtDate(e.dueDate)}</td>
                <td className="py-1 text-right font-mono text-gray-600">{fmt(e.principalDue)}</td>
                <td className="py-1 text-right font-mono text-orange-500">{fmt(e.interestDue)}</td>
                <td className="py-1 text-right font-mono text-red-600 font-bold">{fmt(e.totalBillDue)}</td>
                <td className="py-1 text-right font-mono text-green-600">{e.amountPaid > 0 ? fmt(e.amountPaid) : "—"}</td>
                <td className="py-1 text-right font-mono font-bold text-gray-900">{fmt(e.balance)}</td>
                <td className="py-1 pl-2"><Badge status={e.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function BillingSimulatorPage() {
  const [step, setStep] = useState("setup"); // "setup" | "running" | "summary"
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [member, setMember] = useState(null);
  const [actions, setActions] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [finalCarry, setFinalCarry] = useState(null);
  const [testCases, setTestCases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [realMode, setRealMode] = useState(false);
  const [realLog, setRealLog] = useState([]);
  async function callSimulator(allActions, cfg, mem) {
    if (allActions.length === 0) {
      setSnapshots([]);
      setLedger([]);
      setFinalCarry(null);
      setTestCases([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing-simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: cfg, member: mem, actions: allActions }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Simulation failed");
      setSnapshots(data.snapshots || []);
      setLedger(data.ledger || []);
      setFinalCarry(data.finalCarry || null);
      setTestCases(data.testCases || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  async function callRealGenerate(action) {
    const res = await fetch("/api/billing-simulator/generate-real", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: action.year,
        month: action.month,
        memberId: member.id,
        generationDate: action.generationDate,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Real generate failed");
    return data;
  }
  async function callRealPay(action) {
    const res = await fetch("/api/billing-simulator/pay-real", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberId: member.id,
        billPeriodId: action.billPeriodId,
        amount: action.amount,
        paymentDate: action.paymentDate,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Real pay failed");
    return data;
  }
  function handleStart({ config: cfg, member: mem }) {
    setConfig(cfg);
    setMember(mem);
    setActions([]);
    setSnapshots([]);
    setLedger([]);
    setFinalCarry(null);
    setTestCases([]);
    setError(null);
    setRealLog([]);
    setStep("running");
  }
  async function handleAddAction(action) {
    const next = [...actions, action];
    setActions(next);
    if (realMode) {
      try {
        let result;
        if (action.type === "generate") {
          result = await callRealGenerate(action);
          setRealLog(l => [...l, { type: "generate", period: result.billPeriodId, totalBillDue: result.totalBillDue, status: "ok" }]);
        } else if (action.type === "pay") {
          result = await callRealPay(action);
          setRealLog(l => [...l, { type: "pay", period: action.billPeriodId, amountPaid: result.amountPaid, interestCleared: result.interestCleared, principalCleared: result.principalCleared, status: "ok" }]);
        }
      } catch (e) {
        setRealLog(l => [...l, { type: action.type, period: action.billPeriodId || `${action.year}-${String(action.month).padStart(2,"0")}`, status: "error", error: e.message }]);
        setError(`Real DB write failed: ${e.message}`);
      }
    }
    callSimulator(next, config, member);
  }
  function handleFinish() {
    setStep("summary");
  }
  function handleBack() {
    setStep("running");
  }
  function handleReset() {
    setStep("setup");
    setMember(null);
    setActions([]);
    setSnapshots([]);
    setLedger([]);
    setFinalCarry(null);
    setTestCases([]);
    setError(null);
    setRealMode(false);
    setRealLog([]);
  }
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Billing Simulator</h1>
            <p className="text-gray-500 text-sm mt-1">
              Manual chronological billing engine — every action sequential, every calculation auditable.
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Real Mode toggle */}
            {step === "running" && (
              <button
                onClick={() => setRealMode(m => !m)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-bold transition-colors ${
                  realMode
                    ? "bg-red-600 border-red-600 text-white"
                    : "bg-white border-gray-300 text-gray-600 hover:border-red-400 hover:text-red-600"
                }`}
                title={realMode ? "Real Mode ON — actions write to DB" : "Real Mode OFF — simulation only"}
              >
                <span className={`w-2 h-2 rounded-full ${realMode ? "bg-white animate-pulse" : "bg-gray-400"}`} />
                {realMode ? "REAL MODE ON" : "Real Mode OFF"}
              </button>
            )}
            {step !== "setup" && (
              <div className="flex items-center gap-2 text-sm">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${step === "setup" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"}`}>1 Setup</span>
                <span className="text-gray-400">→</span>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${step === "running" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"}`}>2 Simulate</span>
                <span className="text-gray-400">→</span>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${step === "summary" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"}`}>3 Summary</span>
              </div>
            )}
          </div>
        </div>
        {/* Real Mode warning banner */}
        {realMode && step === "running" && (
          <div className="mb-4 bg-red-50 border border-red-300 rounded-xl px-5 py-3 flex items-start gap-3">
            <span className="text-red-500 text-lg mt-0.5"></span>
            <div>
              <div className="font-bold text-red-700 text-sm">Real Mode Active — actions write to the database</div>
              <div className="text-red-600 text-xs mt-0.5">Generate Bill → creates real Bill document. Record Payment → creates real Transaction and updates Bill closing state. Cannot be undone from the simulator.</div>
            </div>
          </div>
        )}
        {/* Real Mode activity log */}
        {realMode && realLog.length > 0 && step === "running" && (
          <div className="mb-4 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="text-xs font-bold text-gray-500 uppercase mb-2">Real DB Writes</div>
            <div className="space-y-1">
              {realLog.map((entry, i) => (
                <div key={i} className={`flex items-center gap-3 text-xs py-1 ${entry.status === "error" ? "text-red-600" : "text-gray-700"}`}>
                  <span className={`font-bold ${entry.status === "error" ? "text-red-500" : entry.type === "generate" ? "text-blue-500" : "text-green-500"}`}>
                    {entry.status === "error" ? "✗" : "✓"} {entry.type === "generate" ? "GENERATE" : "PAY"}
                  </span>
                  <span className="font-mono">{entry.period}</span>
                  {entry.totalBillDue != null && <span className="text-gray-500">Bill Due: {fmt(entry.totalBillDue)}</span>}
                  {entry.amountPaid != null && <span className="text-green-600">Paid: {fmt(entry.amountPaid)} (Int: {fmt(entry.interestCleared)} | Prin: {fmt(entry.principalCleared)})</span>}
                  {entry.error && <span className="text-red-600">{entry.error}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {step === "setup" && (
          <SetupScreen onStart={handleStart} />
        )}
        {step === "running" && (
          <RunningScreen
            config={config}
            member={member}
            actions={actions}
            snapshots={snapshots}
            ledger={ledger}
            finalCarry={finalCarry}
            onAddAction={handleAddAction}
            onFinish={handleFinish}
            loading={loading}
            error={error}
          />
        )}
        {step === "summary" && (
          <SummaryScreen
            config={config}
            member={member}
            snapshots={snapshots}
            ledger={ledger}
            finalCarry={finalCarry}
            testCases={testCases}
            onReset={handleReset}
            onBack={handleBack}
          />
        )}
      </div>
    </div>
  );
}
