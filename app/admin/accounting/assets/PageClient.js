"use client";
/**
 * The asset register — the lift, the pump, the generator, the CCTV.
 *
 * ## What makes this page harder than the others
 *
 * Every other accounting screen so far reports. This one asks for fourteen
 * fields, four of which are account-head ids, and gets them from someone who
 * has never heard the phrase "accumulated depreciation account". Registering
 * an asset also POSTS to the ledger immediately — it is not a note kept on the
 * side, it is a purchase entry.
 *
 * Three things follow from that.
 *
 * **The four account heads are pre-chosen and folded away.** The standard
 * chart already contains exactly the right head for each: 1021 Fixed Assets,
 * 5020 Depreciation, 1029 Accumulated Depreciation, 1002 Cash at Bank. They
 * are selected by code on load and hidden behind "Where this posts", open to
 * anyone who wants to check or change them. Asking a secretary to pick four
 * accounts he cannot evaluate is not a choice, it is an obstacle with a
 * dropdown on it.
 *
 * **Depreciation is explained as the thing it is** — "spreading the cost of
 * something over the years it lasts, so one year does not carry all of it" —
 * and the two methods are described by what they do to the numbers, not by
 * their names.
 *
 * **The amount charged is not predicted, it is reported.** computeDepreciation-
 * Amount lives in AssetService and cannot be imported into a client component.
 * Reimplementing it here would give two formulas that must agree forever and
 * will not. So the confirmation states the RULE in words with this asset's own
 * figures, and the exact rupee amount comes back from the server and is shown
 * after posting, worked out from the change in accumulated depreciation.
 *
 * ## What was found while building this
 *
 * depreciate, dispose and transfer had NO permission check — only the legacy
 * hat gate, which by its own comment assumes an authorize() call follows it.
 * Same hole as the voucher workflow routes. Closed with accounting.assets.*.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import notify from "@/lib/notify";
import { SetupGate } from "@/components/accounting/SetupGate";
import {
  PageHeader, SectionLabel, Card, Pill, Btn, Icon, SearchInput,
  Segmented, EmptyState, RevampSkeleton, SmallStat,
} from "@/components/revamp";

/**
 * The head each of the four wiring fields should point at, by code, in the
 * standard chart. Looked up on load; if a society has renamed or removed one,
 * the field falls back to an empty picker rather than guessing.
 */
const DEFAULT_CODES = {
  linkedAssetAccountId: "1021",                    // Fixed Assets
  linkedDepreciationExpenseAccountId: "5020",      // Depreciation
  linkedAccumulatedDepreciationAccountId: "1029",  // Accumulated Depreciation
  fundingAccountId: "1002",                        // Cash at Bank
};

const WIRING_FIELDS = [
  {
    key: "linkedAssetAccountId",
    label: "The head this asset sits under",
    hint: "Where the purchase price is recorded as something the society owns.",
  },
  {
    key: "fundingAccountId",
    label: "What it was paid from",
    hint: "The bank or cash account the money left.",
  },
  {
    key: "linkedDepreciationExpenseAccountId",
    label: "Where the yearly charge goes",
    hint: "The expense head that carries each year's share of the cost.",
  },
  {
    key: "linkedAccumulatedDepreciationAccountId",
    label: "Where the running total is kept",
    hint: "Everything charged so far, held against the asset's value.",
  },
];

const CATEGORIES = ["Lift", "Pump", "Generator", "CCTV", "Furniture", "Vehicle", "Building", "Other"];

const money = (n) =>
  typeof n === "number"
    ? n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
    : "—";

const dateText = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";

const today = () => new Date().toISOString().slice(0, 10);

/** cost − charged so far. What the books still carry it at. */
const bookValue = (a) => Math.max(0, (a.purchaseCost || 0) - (a.accumulatedDepreciation || 0));

const EMPTY_FORM = {
  assetCode: "", name: "", category: "Other", description: "",
  purchaseDate: "", purchaseCost: "", vendor: "", billRef: "",
  usefulLifeYears: "", salvageValue: "0",
  depreciationMethod: "StraightLine", wdvRatePercent: "",
  location: "", custodian: "",
  linkedAssetAccountId: "", fundingAccountId: "",
  linkedDepreciationExpenseAccountId: "", linkedAccumulatedDepreciationAccountId: "",
};

/* ── small form primitives, local: the revamp kit has no labelled input ── */

function Field({ label, hint, children, wide }) {
  return (
    <label style={{ display: "block", gridColumn: wide ? "1 / -1" : undefined }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--r-fg-2)", marginBottom: 3 }}>
        {label}
      </span>
      {children}
      {hint ? (
        <span style={{ display: "block", fontSize: 11, color: "var(--r-fg-4)", marginTop: 3, lineHeight: 1.5 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

const inputStyle = {
  width: "100%", padding: "7px 9px", borderRadius: 7,
  border: "1px solid var(--r-border)", background: "var(--r-surface)",
  color: "var(--r-fg-1)", fontSize: 13, fontFamily: "inherit",
};

const Input = (p) => <input {...p} style={{ ...inputStyle, ...p.style }} />;
const SelectBox = (p) => <select {...p} style={{ ...inputStyle, ...p.style }} />;

export default function AssetsPage() {
  return (
    <SetupGate requires="chartOfAccounts">
      <AssetsBody />
    </SetupGate>
  );
}

function AssetsBody() {
  const router = useRouter();
  const [assets, setAssets] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("Active");
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(null);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showWiring, setShowWiring] = useState(false);

  // { id, kind } — the inline confirmation open on one asset.
  const [acting, setActing] = useState(null);
  const [actionForm, setActionForm] = useState({});

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const [aRes, cRes, pRes] = await Promise.all([
        fetch("/api/accounting/assets", { credentials: "include", signal }),
        fetch("/api/accounting/chart-of-accounts", { credentials: "include", signal }),
        fetch("/api/rbac/my-access", { credentials: "include", signal }),
      ]);
      const aJson = await aRes.json().catch(() => ({}));
      if (!aRes.ok) throw new Error(aJson.error || "Could not load the asset register");
      setAssets(aJson.assets || []);
      if (cRes.ok) setAccounts((await cRes.json().catch(() => ({}))).accounts || []);
      if (pRes.ok) setPerms(new Set((await pRes.json().catch(() => ({}))).permissions || []));
    } catch (e) {
      if (e?.name !== "AbortError") setError(e.message);
    } finally {
      // A StrictMode double-mount (dev only) aborts the first of two calls to
      // this load() — without this guard its `finally` still clears loading
      // right away, flashing the empty state before the second, real fetch
      // resolves seconds later.
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const can = useCallback((id) => !perms || perms.has(id), [perms]);

  const accountName = useCallback(
    (id) => {
      const a = accounts.find((x) => String(x._id) === String(id));
      return a ? `${a.code} ${a.name}` : "an account head";
    },
    [accounts],
  );

  /** Pre-choose the four wiring accounts the moment the chart is available. */
  const openAdd = useCallback(() => {
    const byCode = new Map(accounts.map((a) => [a.code, String(a._id)]));
    setForm({
      ...EMPTY_FORM,
      purchaseDate: today(),
      ...Object.fromEntries(
        Object.entries(DEFAULT_CODES).map(([field, code]) => [field, byCode.get(code) || ""]),
      ),
    });
    setShowWiring(false);
    setAdding(true);
  }, [accounts]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const wiringComplete = WIRING_FIELDS.every((f) => form[f.key]);

  const submitNew = useCallback(async () => {
    setBusy("register");
    try {
      const res = await fetch("/api/accounting/assets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          purchaseCost: Number(form.purchaseCost),
          usefulLifeYears: Number(form.usefulLifeYears),
          salvageValue: Number(form.salvageValue || 0),
          wdvRatePercent:
            form.depreciationMethod === "WDV" ? Number(form.wdvRatePercent) : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not register the asset");
      notify.success(
        `${json.asset?.name || "Asset"} registered, and the purchase entry has been written into the books.`,
      );
      setAdding(false);
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setBusy(null);
    }
  }, [form, load]);

  /** depreciate / transfer / dispose, one path. */
  const runAction = useCallback(
    async (asset, kind, body) => {
      setBusy(`${asset._id}:${kind}`);
      const before = asset.accumulatedDepreciation || 0;
      try {
        const res = await fetch(`/api/accounting/assets/${asset._id}/${kind}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "That did not go through");
        const after = json.asset?.accumulatedDepreciation ?? before;
        notify.success(
          kind === "depreciate"
            ? `${money(Math.round((after - before) * 100) / 100)} charged. The books now carry ${asset.name} at ${money(
                Math.max(0, (asset.purchaseCost || 0) - after),
              )}.`
            : kind === "dispose"
              ? `${asset.name} disposed. The entry is in the books, and the asset stays on this page as a record.`
              : `${asset.name} moved. Nothing in the books changed — this is a record of who holds it.`,
        );
        setActing(null);
        await load();
      } catch (e) {
        notify.error(e.message);
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return assets.filter((a) => {
      if (status !== "all" && a.status !== status) return false;
      if (!needle) return true;
      return [a.name, a.assetCode, a.category, a.location, a.custodian, a.vendor]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(needle));
    });
  }, [assets, q, status]);

  const stats = useMemo(() => {
    const active = assets.filter((a) => a.status === "Active");
    const thisYear = new Date().getFullYear();
    return {
      active: active.length,
      cost: active.reduce((s, a) => s + (a.purchaseCost || 0), 0),
      book: active.reduce((s, a) => s + bookValue(a), 0),
      // An asset with no run at all this calendar year. The seeded check
      // (assetsMissingDepreciationThisYear) flags the same thing, but only
      // when someone generates a statement — far too late to act on.
      undepreciatedList: active.filter(
        (a) => !(a.depreciationRuns || []).some((r) => new Date(r.date).getFullYear() === thisYear),
      ),
      get undepreciated() { return this.undepreciatedList.length; },
    };
  }, [assets]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="package" size={11} /> Also called the fixed asset register</>}
        title="What the society owns"
        sub="The lift, the pump, the generator, the CCTV — what each cost, what it is worth now, and who has it."
        right={
          <div style={{ display: "flex", gap: 8 }}>
            {can("accounting.assets.register") && !adding ? (
              <Btn variant="primary" icon="plus" onClick={openAdd}>Add something</Btn>
            ) : null}
            <Btn icon="arrow-left" onClick={() => router.push("/admin/accounting")}>Overview</Btn>
          </div>
        }
      />

      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          <RevampSkeleton h={80} /><RevampSkeleton h={240} />
        </div>
      ) : error ? (
        <Card>
          <EmptyState icon="alert-triangle" title="Could not load the asset register" sub={error} />
          <div style={{ textAlign: "center", paddingBottom: 20 }}>
            <Btn variant="primary" onClick={() => load()}>Try again</Btn>
          </div>
        </Card>
      ) : (
        <>
          {/* ── register form ──────────────────────────────────────── */}
          {adding ? (
            <Card style={{ marginBottom: 18 }}>
              <SectionLabel icon="plus">Add something the society owns</SectionLabel>
              <p style={{ fontSize: 12.5, color: "var(--r-fg-3)", lineHeight: 1.65, margin: "0 0 14px" }}>
                Saving this does two things at once: it adds the item to this
                register, and it writes the purchase into the books as money
                spent on something the society now owns. It is a real entry, not
                a note.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <Field label="What is it?" hint="Plain name — Lift, Water Pump, CCTV System.">
                  <Input value={form.name} onChange={set("name")} placeholder="Passenger lift" />
                </Field>
                <Field label="Your reference code" hint="Anything you will recognise later. LIFT-01.">
                  <Input value={form.assetCode} onChange={set("assetCode")} placeholder="LIFT-01" />
                </Field>
                <Field label="Kind">
                  <SelectBox value={form.category} onChange={set("category")}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </SelectBox>
                </Field>
                <Field label="When was it bought?">
                  <Input type="date" value={form.purchaseDate} onChange={set("purchaseDate")} />
                </Field>
                <Field label="What did it cost?" hint="The full amount paid, in rupees.">
                  <Input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={set("purchaseCost")} />
                </Field>
                <Field label="Bought from" hint="Optional.">
                  <Input value={form.vendor} onChange={set("vendor")} placeholder="Vendor name" />
                </Field>
                <Field label="Bill number" hint="Optional.">
                  <Input value={form.billRef} onChange={set("billRef")} />
                </Field>
                <Field label="Where is it?" hint="Optional. Terrace, basement, gate.">
                  <Input value={form.location} onChange={set("location")} />
                </Field>
                <Field label="Who looks after it?" hint="Optional.">
                  <Input value={form.custodian} onChange={set("custodian")} />
                </Field>
              </div>

              {/* ── depreciation, explained ─────────────────────────── */}
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--r-hairline)" }}>
                <SectionLabel icon="trending-down">Spreading the cost over its life</SectionLabel>
                <p style={{ fontSize: 12.5, color: "var(--r-fg-3)", lineHeight: 1.65, margin: "0 0 12px" }}>
                  A lift bought for ₹8,00,000 is not an ₹8,00,000 expense in the
                  year it was bought — it serves the society for years, so the
                  cost is spread across them. That yearly share is called
                  depreciation, and it is what makes the accounts show the true
                  cost of running the building each year.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                  <Field label="How many years will it last?" hint="Your best estimate. A lift, 15. A computer, 3.">
                    <Input type="number" min="1" value={form.usefulLifeYears} onChange={set("usefulLifeYears")} />
                  </Field>
                  <Field label="Worth at the end" hint="What you could sell it for once finished with. Usually 0.">
                    <Input type="number" min="0" step="0.01" value={form.salvageValue} onChange={set("salvageValue")} />
                  </Field>
                  <Field
                    label="How should the cost be spread?"
                    hint={
                      form.depreciationMethod === "StraightLine"
                        ? "The same amount every year until it reaches its end value. The usual choice."
                        : "A fixed percentage of whatever is left each year — larger early, smaller later."
                    }
                  >
                    <SelectBox value={form.depreciationMethod} onChange={set("depreciationMethod")}>
                      <option value="StraightLine">Evenly — the same each year</option>
                      <option value="WDV">A percentage of what is left each year</option>
                    </SelectBox>
                  </Field>
                  {form.depreciationMethod === "WDV" ? (
                    <Field label="Percentage each year" hint="For example 15 for 15%.">
                      <Input type="number" min="0" step="0.01" value={form.wdvRatePercent} onChange={set("wdvRatePercent")} />
                    </Field>
                  ) : null}
                </div>
              </div>

              {/* ── the four account heads, folded away ─────────────── */}
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--r-hairline)" }}>
                <button
                  type="button"
                  onClick={() => setShowWiring((v) => !v)}
                  style={{
                    border: "none", background: "none", padding: 0, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                    fontSize: 12.5, fontWeight: 600, color: "var(--r-fg-2)",
                  }}
                >
                  <Icon name={showWiring ? "chevron-down" : "chevron-right"} size={13} />
                  Where this posts in the books
                  {wiringComplete ? (
                    <Pill tone="paid">chosen for you</Pill>
                  ) : (
                    <Pill tone="overdue">needs setting</Pill>
                  )}
                </button>
                {!showWiring ? (
                  <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", margin: "6px 0 0", lineHeight: 1.6 }}>
                    {wiringComplete
                      ? "The four account heads have been picked from your standard chart. Open this only if you want to check or change them."
                      : "One or more of the standard heads is missing from your chart, so these have to be chosen by hand. Open this to set them."}
                  </p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 12 }}>
                    {WIRING_FIELDS.map((f) => (
                      <Field key={f.key} label={f.label} hint={f.hint}>
                        <SelectBox value={form[f.key]} onChange={set(f.key)}>
                          <option value="">Choose an account head…</option>
                          {accounts
                            .filter((a) => a.isActive !== false)
                            .map((a) => (
                              <option key={a._id} value={String(a._id)}>{a.code} — {a.name}</option>
                            ))}
                        </SelectBox>
                      </Field>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 18, alignItems: "center", flexWrap: "wrap" }}>
                <Btn
                  variant="primary"
                  disabled={
                    busy === "register" ||
                    !form.name.trim() || !form.assetCode.trim() ||
                    !(Number(form.purchaseCost) > 0) || !(Number(form.usefulLifeYears) > 0) ||
                    !wiringComplete ||
                    (form.depreciationMethod === "WDV" && !(Number(form.wdvRatePercent) > 0))
                  }
                  onClick={submitNew}
                >
                  {busy === "register" ? "Saving and posting…" : "Save and post the purchase"}
                </Btn>
                <Btn onClick={() => setAdding(false)}>Leave it</Btn>
                {!wiringComplete ? (
                  <span style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
                    Set the four account heads above first.
                  </span>
                ) : null}
              </div>
            </Card>
          ) : null}

          {assets.length === 0 && !adding ? (
            <Card>
              <div style={{ padding: "36px 24px", textAlign: "center", maxWidth: 540, margin: "0 auto" }}>
                <Icon name="package" size={30} color="var(--r-fg-5)" style={{ margin: "0 auto" }} />
                <p style={{ marginTop: 12, fontSize: 15, fontWeight: 600, color: "var(--r-fg-1)" }}>
                  Nothing registered yet
                </p>
                <p style={{ marginTop: 8, fontSize: 13, color: "var(--r-fg-3)", lineHeight: 1.65 }}>
                  This is where the society's own property is listed — the lift,
                  the pumps, the generator, the CCTV, the furniture. Without it
                  the Balance Sheet shows no property, and the yearly wear and
                  tear on any of it never reaches the accounts.
                </p>
                {can("accounting.assets.register") ? (
                  <Btn variant="primary" icon="plus" onClick={openAdd} style={{ marginTop: 16 }}>
                    Add the first one
                  </Btn>
                ) : null}
              </div>
            </Card>
          ) : assets.length ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
                <SmallStat icon="package" label="Items owned" value={stats.active} />
                <SmallStat icon="banknote" label="What they cost" value={money(stats.cost)} />
                <SmallStat icon="trending-down" label="Worth now, in the books" value={money(stats.book)} />
                <SmallStat icon="alert-triangle" label="Not depreciated this year" value={stats.undepreciated} />
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
                <SearchInput value={q} onChange={setQ} placeholder="Search name, code or place…" style={{ maxWidth: 260 }} />
                <Segmented
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "Active", label: "Still owned" },
                    { value: "Disposed", label: "Gone" },
                    { value: "all", label: "All" },
                  ]}
                />
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--r-fg-4)" }}>
                  {visible.length} shown
                </span>
              </div>

              {visible.length === 0 ? (
                <Card><EmptyState icon="search" title="Nothing matches" sub="Try a different search or filter." /></Card>
              ) : (
                  <Card padded={false}>
                  {visible.map((a, i) => {
                    const id = String(a._id);
                    const open = openId === id;
                    const gone = a.status === "Disposed";
                    const act = acting?.id === id ? acting.kind : null;
                    return (
                      <div
                        key={id}
                        style={{ borderBottom: i === visible.length - 1 ? "none" : "1px solid var(--r-hairline)" }}
                      >
                        <div
                          onClick={() => setOpenId(open ? null : id)}
                          style={{ display: "flex", gap: 12, padding: "12px 15px", alignItems: "center", cursor: "pointer", opacity: gone ? 0.6 : 1 }}
                        >
                          <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--r-fg-5)" />
                          <span className="revamp-num" style={{ fontSize: 12, fontWeight: 700, color: "var(--r-fg-4)", width: 84, flexShrink: 0 }}>
                            {a.assetCode}
                          </span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--r-fg-1)" }}>
                            {a.name}
                            <span style={{ color: "var(--r-fg-4)", fontSize: 11.5 }}>
                              {a.location ? ` · ${a.location}` : ""}
                            </span>
                          </span>
                          <span className="revamp-num" style={{ fontSize: 12.5, color: "var(--r-fg-2)" }}>
                            {money(bookValue(a))}
                          </span>
                          {gone ? <Pill tone="expired">gone</Pill> : <Pill tone="active">owned</Pill>}
                        </div>

                        {open ? (
                          <div style={{ padding: "0 15px 14px 41px" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px 20px", fontSize: 12.5, color: "var(--r-fg-3)", marginBottom: 10 }}>
                              <span>Bought {dateText(a.purchaseDate)}{a.vendor ? ` from ${a.vendor}` : ""}</span>
                              <span>Cost <strong className="revamp-num" style={{ color: "var(--r-fg-1)" }}>{money(a.purchaseCost)}</strong></span>
                              <span>Charged so far <strong className="revamp-num" style={{ color: "var(--r-fg-1)" }}>{money(a.accumulatedDepreciation)}</strong></span>
                              <span>Carried at <strong className="revamp-num" style={{ color: "var(--r-fg-1)" }}>{money(bookValue(a))}</strong></span>
                              <span>
                                Spread{" "}
                                {a.depreciationMethod === "WDV"
                                  ? `at ${a.wdvRatePercent}% of what is left each year`
                                  : `evenly over ${a.usefulLifeYears} years`}
                              </span>
                              {a.custodian ? <span>Looked after by {a.custodian}</span> : null}
                            </div>

                            {(a.depreciationRuns || []).length ? (
                              <details style={{ marginBottom: 10 }}>
                                <summary style={{ fontSize: 11.5, color: "var(--r-fg-4)", cursor: "pointer" }}>
                                  {a.depreciationRuns.length} charge{a.depreciationRuns.length === 1 ? "" : "s"} so far
                                </summary>
                                <div style={{ display: "grid", gap: 3, marginTop: 6 }}>
                                  {a.depreciationRuns.map((r, j) => (
                                    <div key={j} style={{ display: "flex", gap: 12, fontSize: 11.5, color: "var(--r-fg-4)" }}>
                                      <span style={{ width: 110 }}>{dateText(r.date)}</span>
                                      <span className="revamp-num">{money(r.amount)}</span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            ) : null}

                            {(a.transferHistory || []).length ? (
                              <details style={{ marginBottom: 10 }}>
                                <summary style={{ fontSize: 11.5, color: "var(--r-fg-4)", cursor: "pointer" }}>
                                  Moved {a.transferHistory.length} time{a.transferHistory.length === 1 ? "" : "s"}
                                </summary>
                                <div style={{ display: "grid", gap: 3, marginTop: 6 }}>
                                  {a.transferHistory.map((t, j) => (
                                    <div key={j} style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
                                      {dateText(t.date)} — {t.fromLocation || "unrecorded"} → {t.toLocation || "unrecorded"}
                                      {t.toCustodian ? `, now with ${t.toCustodian}` : ""}
                                      {t.note ? ` (${t.note})` : ""}
                                    </div>
                                  ))}
                                </div>
                              </details>
                            ) : null}

                            {gone ? (
                              <div style={{ fontSize: 12, color: "var(--r-fg-3)", lineHeight: 1.65, background: "var(--r-surface-2)", borderRadius: 8, padding: "9px 11px" }}>
                                Disposed on {dateText(a.disposal?.date)}
                                {a.disposal?.proceeds ? `, sold for ${money(a.disposal.proceeds)}` : ""}.
                                {typeof a.disposal?.gainLoss === "number" && Math.abs(a.disposal.gainLoss) >= 0.005 ? (
                                  <>
                                    {" "}That was {money(Math.abs(a.disposal.gainLoss))}{" "}
                                    {a.disposal.gainLoss > 0 ? "more" : "less"} than the books carried it at,
                                    and the difference has been recorded as a{" "}
                                    {a.disposal.gainLoss > 0 ? "gain" : "loss"}.
                                  </>
                                ) : null}
                                {a.disposal?.note ? ` ${a.disposal.note}` : ""}
                                {" "}It stays on this page so the record of it is not lost.
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {can("accounting.assets.depreciate") ? (
                                  <Btn size="sm" onClick={() => { setActionForm({ date: today(), periodMonths: 12 }); setActing({ id, kind: "depreciate" }); }}>
                                    Charge this year's share
                                  </Btn>
                                ) : null}
                                {can("accounting.assets.transfer") ? (
                                  <Btn size="sm" onClick={() => { setActionForm({ toLocation: a.location || "", toCustodian: a.custodian || "", note: "" }); setActing({ id, kind: "transfer" }); }}>
                                    Move it / change who holds it
                                  </Btn>
                                ) : null}
                                {can("accounting.assets.dispose") ? (
                                  <Btn size="sm" variant="danger" onClick={() => { setActionForm({ date: today(), proceeds: "", disposalAccountId: "", gainLossAccountId: "", note: "" }); setActing({ id, kind: "dispose" }); }}>
                                    Sold or scrapped
                                  </Btn>
                                ) : null}
                              </div>
                            )}

                            {/* ── inline confirmations ─────────────── */}
                            {act === "depreciate" ? (
                              <ActionBox
                                title="Charge this year's share"
                                blurb={
                                  a.depreciationMethod === "WDV"
                                    ? `The rule for this item is ${a.wdvRatePercent}% of what is left. It is carried at ${money(bookValue(a))} today, so roughly that percentage of that figure will be charged. The exact amount is worked out when it posts, and shown to you afterwards.`
                                    : `The rule for this item is the cost, less its ${money(a.salvageValue)} end value, spread evenly over ${a.usefulLifeYears} years. The exact amount is worked out when it posts, and shown to you afterwards.`
                                }
                                onCancel={() => setActing(null)}
                                confirmLabel="Charge it"
                                busy={busy === `${id}:depreciate`}
                                onConfirm={() => runAction(a, "depreciate", { date: actionForm.date, periodMonths: Number(actionForm.periodMonths) || 12 })}
                              >
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                                  <Field label="As at" hint="The date the charge is recorded on.">
                                    <Input type="date" value={actionForm.date || ""} onChange={(e) => setActionForm((f) => ({ ...f, date: e.target.value }))} />
                                  </Field>
                                  <Field label="How much of a year?" hint="12 for a full year, 3 for a quarter.">
                                    <SelectBox value={actionForm.periodMonths} onChange={(e) => setActionForm((f) => ({ ...f, periodMonths: e.target.value }))}>
                                      <option value={12}>A full year</option>
                                      <option value={6}>Half a year</option>
                                      <option value={3}>A quarter</option>
                                      <option value={1}>One month</option>
                                    </SelectBox>
                                  </Field>
                                </div>
                              </ActionBox>
                            ) : null}

                            {act === "transfer" ? (
                              <ActionBox
                                title="Move it, or change who holds it"
                                blurb="Nothing in the books changes. This only records where the item is and who is responsible for it, and keeps the previous answer in its history."
                                onCancel={() => setActing(null)}
                                confirmLabel="Record the move"
                                busy={busy === `${id}:transfer`}
                                disabled={!actionForm.toLocation && !actionForm.toCustodian}
                                onConfirm={() => runAction(a, "transfer", actionForm)}
                              >
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                                  <Field label="Where is it now?">
                                    <Input value={actionForm.toLocation || ""} onChange={(e) => setActionForm((f) => ({ ...f, toLocation: e.target.value }))} />
                                  </Field>
                                  <Field label="Who holds it now?">
                                    <Input value={actionForm.toCustodian || ""} onChange={(e) => setActionForm((f) => ({ ...f, toCustodian: e.target.value }))} />
                                  </Field>
                                  <Field label="Note" hint="Optional." wide>
                                    <Input value={actionForm.note || ""} onChange={(e) => setActionForm((f) => ({ ...f, note: e.target.value }))} />
                                  </Field>
                                </div>
                              </ActionBox>
                            ) : null}

                            {act === "dispose" ? (
                              <ActionBox
                                title="Sold, scrapped or written off"
                                blurb={`The books carry this at ${money(bookValue(a))}. Whatever it fetched is compared against that figure, and the difference is recorded as a gain or a loss. The item is closed, its entry is posted, and it stays on this page as a record — nothing is deleted.`}
                                onCancel={() => setActing(null)}
                                confirmLabel="Record the disposal"
                                danger
                                busy={busy === `${id}:dispose`}
                                disabled={Number(actionForm.proceeds) > 0 && !actionForm.disposalAccountId}
                                onConfirm={() =>
                                  runAction(a, "dispose", {
                                    date: actionForm.date,
                                    proceeds: Number(actionForm.proceeds || 0),
                                    disposalAccountId: actionForm.disposalAccountId || undefined,
                                    gainLossAccountId: actionForm.gainLossAccountId || undefined,
                                    note: actionForm.note,
                                  })
                                }
                              >
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                                  <Field label="On what date?">
                                    <Input type="date" value={actionForm.date || ""} onChange={(e) => setActionForm((f) => ({ ...f, date: e.target.value }))} />
                                  </Field>
                                  <Field label="What did it fetch?" hint="0 if it was scrapped or given away.">
                                    <Input type="number" min="0" step="0.01" value={actionForm.proceeds} onChange={(e) => setActionForm((f) => ({ ...f, proceeds: e.target.value }))} />
                                  </Field>
                                  {Number(actionForm.proceeds) > 0 ? (
                                    <Field label="Where did the money go?" hint="Required when it fetched something.">
                                      <SelectBox value={actionForm.disposalAccountId || ""} onChange={(e) => setActionForm((f) => ({ ...f, disposalAccountId: e.target.value }))}>
                                        <option value="">Choose an account head…</option>
                                        {accounts.filter((x) => x.isActive !== false).map((x) => (
                                          <option key={x._id} value={String(x._id)}>{x.code} — {x.name}</option>
                                        ))}
                                      </SelectBox>
                                    </Field>
                                  ) : null}
                                  <Field
                                    label="Where should the difference go?"
                                    hint="Only needed if it fetched more or less than the books carry it at. Leave blank and the system will tell you if it is required."
                                  >
                                    <SelectBox value={actionForm.gainLossAccountId || ""} onChange={(e) => setActionForm((f) => ({ ...f, gainLossAccountId: e.target.value }))}>
                                      <option value="">Not needed / choose…</option>
                                      {accounts.filter((x) => x.isActive !== false).map((x) => (
                                        <option key={x._id} value={String(x._id)}>{x.code} — {x.name}</option>
                                      ))}
                                    </SelectBox>
                                  </Field>
                                  <Field label="Note" hint="Optional." wide>
                                    <Input value={actionForm.note || ""} onChange={(e) => setActionForm((f) => ({ ...f, note: e.target.value }))} />
                                  </Field>
                                </div>
                              </ActionBox>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  </Card>
              )}

              <p style={{ fontSize: 12, color: "var(--r-fg-4)", lineHeight: 1.65, marginTop: 12 }}>
                A disposed item is never removed from this list. Its purchase, every
                charge against it and its disposal are all in the books, and a
                register that quietly drops things cannot be reconciled against
                them. It simply stops counting toward what the society owns.
              </p>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The inline confirmation shell — same shape for all three actions. */
function ActionBox({ title, blurb, children, onConfirm, onCancel, confirmLabel, busy, danger, disabled }) {
  return (
    <div style={{
      marginTop: 12, padding: "12px 13px", borderRadius: 10,
      border: `1px solid ${danger ? "var(--r-danger)" : "var(--r-warning)"}`,
      background: "var(--r-surface-2)",
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-1)" }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 4, marginBottom: 10, lineHeight: 1.65 }}>
        {blurb}
      </div>
      {children}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Btn
          variant={danger ? "dangerSolid" : "primary"}
          size="sm"
          disabled={busy || disabled}
          onClick={onConfirm}
        >
          {busy ? "Working…" : confirmLabel}
        </Btn>
        <Btn size="sm" onClick={onCancel}>Leave it</Btn>
      </div>
    </div>
  );
}
