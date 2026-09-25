"use client";
import { useCallback, useEffect, useState } from "react";
import notify from "@/lib/notify";
import {
  PageHeader, Card, CardHead, Btn, Pill, Icon, Select,
  DataTable, RevampSkeleton, Toast,
} from "@/components/revamp";
import { useQueryClient } from "@tanstack/react-query";
import ExpensesBand from "@/components/money/ExpensesBand";

async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: opts && opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}

const CATEGORIES = [
  "Salary", "Security", "Housekeeping", "Repairs & Maintenance", "Electricity", "Water",
  "Lift/Elevator", "Garden", "Legal & Professional", "Audit", "Insurance", "Property Tax",
  "Bank Charges", "Festival & Events", "Miscellaneous",
];
const METHODS = ["Cash", "Cheque", "Online", "NEFT", "UPI", "Card", "Other"];
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

function currentFy() {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

function Field({ label, children }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const emptyForm = () => ({
  category: "Repairs & Maintenance",
  amount: "",
  date: new Date().toISOString().slice(0, 10),
  paymentMethod: "Online",
  vendor: "",
  referenceNo: "",
  description: "",
});

export default function ExpenditurePage() {
  const qc = useQueryClient();
  const [fy, setFy] = useState(currentFy());
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState(emptyForm());

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/api/expenses?fy=${fy}`);
      setItems(data.items || []);
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, [fy]);

  useEffect(() => { load(); }, [load]);

  async function addExpense() {
    if (!form.amount || Number(form.amount) <= 0) {
      setToast({ type: "error", message: "Enter a valid amount" });
      return;
    }
    setSaving(true);
    try {
      const res = await api("/api/expenses", { method: "POST", body: JSON.stringify(form) });
      // Recording an expense now also writes it into the double-entry books.
      // Say which head it landed on — an admin who never sees where the money
      // was filed cannot tell a right entry from a wrong one. And when it did
      // NOT reach the books, say that instead of a bare "Expense added": the
      // row exists, the statement will not show it, and only the reason makes
      // that recoverable.
      const acc = res?.accounting;
      if (acc?.posted) {
        setToast({
          type: "success",
          message: `Expense added and posted to the books under ${String(acc.debitAccount).replace(/\.\s*$/, "")}.`,
        });
      } else if (acc?.reason) {
        setToast({ type: "error", message: acc.reason });
      } else {
        setToast({ type: "success", message: "Expense added" });
        qc.invalidateQueries({ queryKey: ["money-insights"] });
      }
      setForm(emptyForm());
      load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!(await notify.confirm("Delete this expense?"))) return;
    try {
      await api(`/api/expenses/${id}`, { method: "DELETE" });
      setToast({ type: "success", message: "Expense deleted" });
      qc.invalidateQueries({ queryKey: ["money-insights"] });
      load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const cols = [
    {
      key: "amount", label: "Amount / category", render: (it) => (
        <div>
          <div className="revamp-num" style={{ fontWeight: 800, color: "var(--r-fg-1)" }}>{inr(it.amount)}</div>
          <Pill tone="neutral" dot={false} style={{ marginTop: 4 }}>{it.category}</Pill>
        </div>
      ),
    },
    {
      key: "meta", label: "Date / method", render: (it) => (
        <div style={{ fontSize: 12.5, color: "var(--r-fg-3)" }}>
          <div>{fmtDate(it.date)} · {it.paymentMethod}</div>
          {it.vendor ? <div style={{ color: "var(--r-fg-4)" }}>{it.vendor}</div> : null}
          {it.referenceNo ? <div style={{ color: "var(--r-fg-4)" }}>Ref {it.referenceNo}</div> : null}
        </div>
      ),
    },
    { key: "desc", label: "Description", render: (it) => <span style={{ color: "var(--r-fg-4)", fontSize: 12.5 }}>{it.description || "—"}</span> },
    {
      // Whether this row reached the double-entry books. A row that did not
      // is invisible on every statement built from the ledger, and nothing
      // else on this page would say so. Rows recorded before the bridge
      // existed have neither field and are left unmarked rather than accused.
      key: "books", label: "Books", render: (it) => (
        it.notPostedReason ? (
          <Pill tone="unpaid" dot={false}>Not posted</Pill>
        ) : it.postedToBooksAt ? (
          <Pill tone="paid" dot={false}>In the books</Pill>
        ) : null
      ),
    },
    { key: "actions", label: "", render: (it) => <Btn size="sm" variant="danger" icon="trash-2" onClick={() => remove(it._id)}>Delete</Btn> },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="wallet" size={11} /> Money · Expenditure</>}
        title="Expenditure"
        sub="Record society expenses (salary, repairs, electricity, audit, etc.). These flow into the Balance Sheet as the outflow side."
        right={
          <Select value={fy} size="md" onChange={(v) => setFy(parseInt(v))} title="Financial year">
            {[0, 1, 2, 3].map((d) => {
              const y = currentFy() - d;
              return <option key={y} value={y}>Apr {y} – Mar {y + 1}</option>;
            })}
          </Select>
        }
      />

      <ExpensesBand fy={fy} />

      <Card style={{ marginBottom: 16 }}>
        <CardHead title="Add expense" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, alignItems: "end" }}>
          <Field label="Category">
            <select className="input" value={form.category} onChange={set("category")}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Amount (₹)">
            <input type="number" min="0" step="0.01" className="input" value={form.amount} onChange={set("amount")} />
          </Field>
          <Field label="Date">
            <input type="date" className="input" value={form.date} onChange={set("date")} />
          </Field>
          <Field label="Method">
            <select className="input" value={form.paymentMethod} onChange={set("paymentMethod")}>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Vendor / payee">
            <input className="input" value={form.vendor} onChange={set("vendor")} placeholder="Optional" />
          </Field>
          <Field label="Reference no.">
            <input className="input" value={form.referenceNo} onChange={set("referenceNo")} placeholder="Optional" />
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Description">
              <input className="input" value={form.description} onChange={set("description")} placeholder="Optional note" />
            </Field>
          </div>
          <div>
            <Btn variant="primary" icon="plus" onClick={addExpense} disabled={saving}>
              {saving ? "Saving…" : "Add expense"}
            </Btn>
          </div>
        </div>
      </Card>


      {loading ? (
        <RevampSkeleton h={280} />
      ) : (
        <DataTable
          cols={cols}
          rows={items}
          rowKey="_id"
          emptyIcon="wallet"
          emptyTitle="No expenses recorded"
          emptySub="Add your first expense above to start building the balance sheet's outflow side."
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
