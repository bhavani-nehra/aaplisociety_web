"use client";
// app/admin/generate-bills/CollectionsGrid.jsx
//
// Replaces the "Download Template" -> edit in Excel -> "Upload" loop with a
// native grid.
//
// Design rules enforced here:
//
//  - Four ledger columns (Opening Due, Current Charges, Bill Due, Remaining
//    Due) are read-only. They render grey, they are not focusable, and their
//    values are never sent back to the server on submit. Each row carries an
//    HMAC that proves they were not touched.
//  - Exactly three fields are editable: Amount Paid, Mode, Remarks.
//  - Navigation behaves like a spreadsheet. Enter and the arrow keys move
//    between cells and wrap across rows. Tab still works normally.
//  - The sheet is fetched once and reused until the billing-config
//    fingerprint changes.

import PulseLoader from "@/components/brand/PulseLoader";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { gsap } from "gsap";
import {
  Lock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Wallet,
  Smartphone,
  Save,
  ShieldAlert,
} from "lucide-react";
import s from "@/styles/CollectionsGrid.module.css";

const MODES = ["", "Cash", "Cheque", "NEFT", "IMPS", "UPI", "Card", "Online"];
const TOLERANCE = 0.01;

/**
 * Every row must reach one of three resolved states before Submit is allowed:
 * a real payment (with a remark if it's short, and explicit confirmation if
 * it's over the amount due), or an explicit "no payment collected" confirm.
 * Leaving a row untouched is no longer a silent pass — see [[save-submit-gate]].
 */
export function resolveRow(row, st) {
  if (row.systemStatus === "PAID") return { resolved: true };
  const amt = Number(st?.amountPaid);
  const hasAmt = Number.isFinite(amt) && amt > 0;
  const hasMode = !!st?.mode;

  if (!hasAmt && !hasMode) {
    return st?.confirmedBlank
      ? { resolved: true }
      : { resolved: false, reason: "Confirm no payment, or enter one." };
  }
  if (hasAmt && !hasMode) return { resolved: false, reason: "Pick a payment mode." };
  if (!hasAmt && hasMode) return { resolved: false, reason: "Enter the amount collected." };

  const overpay = amt > row.remainingDue + TOLERANCE;
  if (overpay && !st?.overpayAsAdvance) {
    return { resolved: false, reason: "Confirm the extra amount as advance credit." };
  }
  const shortfall = !overpay && amt < row.remainingDue - TOLERANCE;
  if (shortfall && !String(st?.remarks || "").trim()) {
    return { resolved: false, reason: "Add a remark for the short payment." };
  }
  return { resolved: true };
}

// Column order for keyboard navigation. Only editable cells appear here,
// which is what makes arrow-right skip the grey ledger block entirely.
const EDITABLE_COLS = ["amountPaid", "mode", "remarks"];

function inr(n) {
  if (n === null || n === undefined || n === "") return "—";
  return Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function StatusPill({ status, paidVia }) {
  const map = {
    PAID: { cls: s.pillPaid, label: "Paid" },
    PARTIAL: { cls: s.pillPartial, label: "Partial" },
    UNPAID: { cls: s.pillUnpaid, label: "Unpaid" },
  };
  const m = map[status] || map.UNPAID;
  return (
    <span className={`${s.pill} ${m.cls}`}>
      {paidVia === "MEMBER_APP" && <Smartphone size={11} strokeWidth={2.5} />}
      {m.label}
    </span>
  );
}

export default function CollectionsGrid({
  periodId,
  billSeries = "RESIDENTIAL",
  rowState,
  setRowState,
  results,
  onSheetLoaded,
  onRequestVerify,
  verifyBtnRef,
  busy,
}) {
  const gridRef = useRef(null);
  const cellRefs = useRef(new Map());
  const [focused, setFocused] = useState({ row: 0, col: 0 });

  // ---- One fetch, cached until the fingerprint moves --------------------
  //
  // staleTime Infinity is deliberate. The server decides when this data is
  // stale, not a timer, because "stale" here means "billing config changed",
  // which no client-side interval can know. The verify endpoint returns
  // STALE_FINGERPRINT and the parent triggers a refetch.
  const {
    data: sheet,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["collection-sheet", billSeries, periodId],
    queryFn: () =>
      apiClient.get(`/api/bills/collection-sheet?periodId=${periodId}&billSeries=${billSeries}`),
    enabled: Boolean(periodId),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const rows = useMemo(() => sheet?.rows || [], [sheet]);

  useEffect(() => {
    if (sheet) onSheetLoaded?.(sheet);
  }, [sheet, onSheetLoaded]);

  // ---- Row entrance -----------------------------------------------------
  // transform + opacity only. Animating height here would reflow the table on
  // every frame and is exactly the pixel-shift we are avoiding.
  useEffect(() => {
    if (!rows.length || !gridRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const rowEls = gridRef.current.querySelectorAll("[data-grid-row]");
    gsap.fromTo(
      rowEls,
      { opacity: 0, y: 10 },
      {
        opacity: 1,
        y: 0,
        duration: 0.34,
        ease: "power2.out",
        force3D: true,
        // amount, not per-item: 31 flats and 300 flats take the same 0.35s.
        stagger: { amount: Math.min(0.35, rowEls.length * 0.01) },
        clearProps: "transform",
      },
    );
  }, [rows.length]);

  const cellKey = (r, c) => `${r}:${c}`;

  const registerCell = useCallback((r, c, el) => {
    if (el) cellRefs.current.set(cellKey(r, c), el);
    else cellRefs.current.delete(cellKey(r, c));
  }, []);

  const focusCell = useCallback((r, c) => {
    const total = EDITABLE_COLS.length;
    const el = cellRefs.current.get(cellKey(r, c));
    if (!el) return false;
    el.focus();
    if (el.select) {
      try {
        el.select();
      } catch {
        /* selects on <select> throw, ignore */
      }
    }
    setFocused({ row: r, col: c });
    // Keep the active row in view without smooth-scrolling, which fights the
    // stagger animation on slower devices.
    el.closest("[data-grid-row]")?.scrollIntoView({
      block: "nearest",
      behavior: "auto",
    });
    return total > 0;
  }, []);

  /**
   * Spreadsheet keyboard model.
   *
   *   Enter        -> next row, same column (wraps to first row)
   *   Shift+Enter  -> previous row, same column
   *   ArrowDown/Up -> same as Enter / Shift+Enter
   *   ArrowRight   -> next editable column, wrapping to the next row
   *   ArrowLeft    -> previous editable column, wrapping to the previous row
   *   Escape       -> blur, so the overlay shortcut can take over
   *
   * Arrow left/right inside a text input only navigates when the caret is
   * already at the edge. Otherwise it moves the caret, which is what anyone
   * coming from Excel expects.
   */
  const onKeyDown = useCallback(
    (e, r, c) => {
      const lastRow = rows.length - 1;
      const lastCol = EDITABLE_COLS.length - 1;
      const el = e.target;
      const isText = el.tagName === "INPUT" && el.type !== "checkbox";
      const atStart = !isText || el.selectionStart === 0;
      const atEnd = !isText || el.selectionEnd === (el.value?.length ?? 0);

      switch (e.key) {
        case "Enter":
          e.preventDefault();
          if (e.shiftKey) focusCell(Math.max(0, r - 1), c);
          else if (r < lastRow) focusCell(r + 1, c);
          else focusCell(0, c);
          break;

        case "ArrowDown":
          e.preventDefault();
          focusCell(Math.min(lastRow, r + 1), c);
          break;

        case "ArrowUp":
          e.preventDefault();
          focusCell(Math.max(0, r - 1), c);
          break;

        case "ArrowRight":
          if (!atEnd) return;
          e.preventDefault();
          if (c < lastCol) focusCell(r, c + 1);
          else if (r < lastRow) focusCell(r + 1, 0);
          break;

        case "ArrowLeft":
          if (!atStart) return;
          e.preventDefault();
          if (c > 0) focusCell(r, c - 1);
          else if (r > 0) focusCell(r - 1, lastCol);
          break;

        case "Escape":
          el.blur();
          break;

        default:
          break;
      }
    },
    [rows.length, focusCell],
  );

  const update = useCallback(
    (billId, field, value) => {
      setRowState((prev) => ({
        ...prev,
        [billId]: { ...(prev[billId] || {}), [field]: value },
      }));
    },
    [setRowState],
  );

  // ---- Live totals, computed from locked server values ------------------
  const totals = useMemo(() => {
    let entered = 0;
    let filledRows = 0;
    let unresolved = 0;
    let blankUnconfirmed = 0;
    let blankConfirmed = 0;
    for (const r of rows) {
      const st = rowState[r.billId] || {};
      const amt = Number(st.amountPaid);
      if (st.mode && Number.isFinite(amt) && amt > 0) {
        entered += amt;
        filledRows += 1;
      }
      if (!resolveRow(r, st).resolved) unresolved += 1;
      if (r.systemStatus !== "PAID" && !amt && !st.mode) {
        if (st.confirmedBlank) blankConfirmed += 1;
        else blankUnconfirmed += 1;
      }
    }
    return {
      entered,
      filledRows,
      unresolved,
      blankUnconfirmed,
      blankConfirmed,
      outstanding: sheet?.summary?.outstanding || 0,
    };
  }, [rows, rowState]);

  // One click instead of one checkbox per empty flat — most of a sheet is
  // usually untouched rows (nothing collected at the desk), and the point of
  // requiring confirmation was never to make that tedious, just explicit.
  const confirmAllBlank = useCallback(() => {
    setRowState((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const st = next[r.billId] || {};
        const amt = Number(st.amountPaid);
        if (r.systemStatus !== "PAID" && !amt && !st.mode && !st.confirmedBlank) {
          next[r.billId] = { ...st, confirmedBlank: true };
        }
      }
      return next;
    });
  }, [rows, setRowState]);

  // The undo for the bulk confirm above — one click back to "nothing
  // decided yet" for every still-blank row, instead of unchecking each one.
  const unconfirmAllBlank = useCallback(() => {
    setRowState((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const st = next[r.billId] || {};
        const amt = Number(st.amountPaid);
        if (!amt && !st.mode && st.confirmedBlank) {
          next[r.billId] = { ...st, confirmedBlank: false };
        }
      }
      return next;
    });
  }, [rows, setRowState]);

  // ---- Save & continue later ---------------------------------------------
  // A plain in-browser draft, not a server commit — nothing here is posted
  // until Verify & Submit runs. Lets an admin fill half a sheet, leave, and
  // pick up exactly where they stopped instead of losing typed-in amounts.
  const draftKey = `collections-draft:${billSeries}:${periodId}`;
  const [draftSavedAt, setDraftSavedAt] = useState(null);

  useEffect(() => {
    if (!periodId) return;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.rowState && Object.keys(parsed.rowState).length) {
        setRowState((prev) => ({ ...parsed.rowState, ...prev }));
        setDraftSavedAt(parsed.savedAt || null);
      }
    } catch {
      /* corrupt or foreign draft, ignore */
    }
    // Only ever load once, when this sheet first mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const saveDraft = useCallback(() => {
    const savedAt = new Date().toISOString();
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({ rowState, savedAt }));
      setDraftSavedAt(savedAt);
    } catch {
      /* storage full or blocked — nothing to do, the admin's typed values are
         still in memory and Verify & Submit still works this session */
    }
  }, [draftKey, rowState]);

  if (isLoading) {
    return (
      <div className={s.skeletonWrap}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={s.skeletonRow} style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    );
  }

  if (isError) {
    const code = error?.data?.code || error?.body?.code;
    const isCommercial = billSeries === "COMMERCIAL";
    const what = isCommercial ? "shop and office" : "flat";
    const whatPlural = isCommercial ? "shops and offices" : "flats";

    // "No bills yet" is NOT an error. It is the normal state before a run, and
    // it has exactly one cure: generate the bills. Retrying the same request
    // can never fix it, so the retry button is not offered for it.
    const noBills = code === "NO_BILLS";

    return (
      <div className={s.emptyState}>
        <AlertCircle size={28} className={s.emptyIcon} />
        <h3>
          {noBills
            ? `No ${isCommercial ? "commercial" : "residential"} bills exist for ${periodId} yet`
            : "The collection sheet could not be loaded"}
        </h3>

        {noBills ? (
          <>
            <p>
              You can only record payments against bills that have already been generated.
              Nothing has gone wrong — the {periodId} {isCommercial ? "commercial" : "residential"}{" "}
              run simply has not been done.
            </p>
            <p style={{ marginTop: 6 }}>
              <b>What to do:</b> close this, make sure the{" "}
              <b>{isCommercial ? "Commercial" : "Residential"}</b> switch at the top of the page is
              selected, choose {periodId}, then press <b>Preview</b> followed by{" "}
              <b>Generate bills</b>. Come back here afterwards.
            </p>
            {isCommercial && (
              <p style={{ marginTop: 6 }}>
                If the commercial run finds nothing to bill, it is because no {whatPlural} have been
                added yet, or they have no area. Shops are added on the Shops screen — that is a
                separate list from your flats, and adding one never changes a flat.
              </p>
            )}
            {isCommercial && (
              <a className={s.btnSecondary} href="/admin/commercial/shops" style={{ marginTop: 10 }}>
                Open {whatPlural}
              </a>
            )}
          </>
        ) : (
          <>
            <p>
              This is a problem fetching the sheet, not a problem with your bills or your
              payments. Nothing has been saved or changed.
            </p>
            <p style={{ marginTop: 6 }}>
              <b>What to do:</b> press Try again. If it keeps failing, check your internet
              connection and reload the page. Any payments you had already submitted are safe.
            </p>
            {error?.message && (
              <p style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                Technical detail for support: {error.message}
              </p>
            )}
            <button className={s.btnSecondary} onClick={() => refetch()}>
              <RefreshCw size={14} /> Try again
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={s.wrap} ref={gridRef}>
      {/* ---- Sheet header -------------------------------------------- */}
      <div className={s.sheetBar}>
        <div className={s.sheetMeta}>
          <span className={s.sheetTitle}>
            {billSeries === "COMMERCIAL" ? "Commercial collections" : "Residential collections"} · {periodId}
          </span>
          <span className={s.sheetSub}>
            {sheet.summary.total} {billSeries === "COMMERCIAL" ? "shops & offices" : "flats"} ·{" "}
            {sheet.summary.alreadyPaid} already paid ·{" "}
            {sheet.summary.partial} partial · {sheet.summary.unpaid} unpaid
          </span>
        </div>
        <div className={s.sheetActions}>
          {totals.blankUnconfirmed > 0 && (
            <button
              className={s.btnSecondary}
              onClick={confirmAllBlank}
              disabled={busy}
              title="Marks every still-empty flat as no collection this month, in one go — same as ticking each row's checkbox yourself. Any row you then fill in overrides it."
            >
              Confirm {totals.blankUnconfirmed} empty row
              {totals.blankUnconfirmed === 1 ? "" : "s"} as no payment
            </button>
          )}
          {totals.blankConfirmed > 0 && (
            <button
              className={s.btnGhost}
              onClick={unconfirmAllBlank}
              disabled={busy}
              title="Undoes the bulk confirm above for every row that's still blank — back to needing a decision, one row at a time or in bulk again."
            >
              Unselect {totals.blankConfirmed} confirmed
            </button>
          )}
          <span className={s.cacheTag} title="This sheet is reused until billing configuration changes.">
            <Lock size={11} /> Ledger locked
          </span>
          <button
            className={s.btnGhost}
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refetch only if you changed billing heads or rates"
          >
            {isFetching ? <PulseLoader size={24} /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </div>

      {/* ---- Grid ------------------------------------------------------ */}
      <div className={s.tableScroll}>
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.thSticky}>Flat</th>
              <th className={s.thName}>Owner</th>
              <th className={s.thStatus}>Status</th>
              <th className={s.thLocked}>
                Opening Due <Lock size={10} />
              </th>
              <th className={s.thLocked}>
                Current Charges <Lock size={10} />
              </th>
              <th className={s.thLocked}>
                Bill Due <Lock size={10} />
              </th>
              <th className={s.thLocked}>
                Remaining Due <Lock size={10} />
              </th>
              <th className={s.thEdit}>Amount Paid</th>
              <th className={s.thEdit}>Mode</th>
              <th className={s.thEdit}>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rIdx) => {
              const st = rowState[row.billId] || {};
              const res = results?.[row.billId];
              const rowCls = [
                s.row,
                res?.ok === true ? s.rowPass : "",
                res?.ok === false ? s.rowFail : "",
                row.systemStatus === "PAID" ? s.rowSettled : "",
              ]
                .filter(Boolean)
                .join(" ");

              // A fully settled bill has nothing left to collect. Locking the
              // inputs is friendlier than letting the admin type and then
              // rejecting it at verify time.
              const settled = row.systemStatus === "PAID";
              const amtNum = Number(st.amountPaid);
              const hasAmt = Number.isFinite(amtNum) && amtNum > 0;
              const overpay = hasAmt && amtNum > row.remainingDue + TOLERANCE;
              const excess = overpay ? Math.round((amtNum - row.remainingDue) * 100) / 100 : 0;
              const isBlank = !hasAmt && !st.mode;
              const rowResult = resolveRow(row, st);

              return (
                <tr
                  key={row.billId}
                  data-grid-row
                  data-bill-id={row.billId}
                  className={rowCls}
                >
                  <td className={s.tdSticky}>{row.flat}</td>
                  <td className={s.tdName} title={row.ownerName}>
                    {row.ownerName}
                  </td>
                  <td>
                    <StatusPill status={row.systemStatus} paidVia={row.paidVia} />
                  </td>

                  {/* ---- LOCKED LEDGER BLOCK -------------------------- */}
                  <td className={s.tdLocked}>{inr(row.openingDue)}</td>
                  <td className={s.tdLocked}>{inr(row.currentCharges)}</td>
                  <td className={`${s.tdLocked} ${s.tdEmphasis}`}>{inr(row.billDue)}</td>
                  <td
                    className={`${s.tdLocked} ${row.remainingDue > 0 ? s.tdDue : s.tdClear}`}
                  >
                    {inr(row.remainingDue)}
                  </td>

                  {/* ---- EDITABLE ------------------------------------- */}
                  <td className={s.tdEdit}>
                    <input
                      ref={(el) => registerCell(rIdx, 0, el)}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      className={s.cellInput}
                      value={st.amountPaid ?? ""}
                      disabled={settled || busy}
                      placeholder={settled ? "settled" : inr(row.remainingDue)}
                      onChange={(e) =>
                        update(row.billId, "amountPaid", e.target.value)
                      }
                      onKeyDown={(e) => onKeyDown(e, rIdx, 0)}
                      onFocus={() => setFocused({ row: rIdx, col: 0 })}
                    />
                    {overpay && (
                      <label className={s.rowOverpay}>
                        <input
                          type="checkbox"
                          checked={!!st.overpayAsAdvance}
                          disabled={settled || busy}
                          onChange={(e) =>
                            update(row.billId, "overpayAsAdvance", e.target.checked)
                          }
                        />
                        <ShieldAlert size={11} /> ₹{inr(excess)} over due — add as advance
                        credit
                      </label>
                    )}
                  </td>
                  <td className={s.tdEdit}>
                    <select
                      ref={(el) => registerCell(rIdx, 1, el)}
                      className={s.cellSelect}
                      value={st.mode ?? ""}
                      disabled={settled || busy}
                      onChange={(e) => update(row.billId, "mode", e.target.value)}
                      onKeyDown={(e) => onKeyDown(e, rIdx, 1)}
                      onFocus={() => setFocused({ row: rIdx, col: 1 })}
                    >
                      {MODES.map((m) => (
                        <option key={m || "none"} value={m}>
                          {m || "— not collected —"}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={s.tdEdit}>
                    <input
                      ref={(el) => registerCell(rIdx, 2, el)}
                      type="text"
                      maxLength={240}
                      className={s.cellInput}
                      value={st.remarks ?? ""}
                      disabled={settled || busy}
                      placeholder={st.mode === "Cheque" ? "Cheque no. + bank" : ""}
                      onChange={(e) => update(row.billId, "remarks", e.target.value)}
                      onKeyDown={(e) => onKeyDown(e, rIdx, 2)}
                      onFocus={() => setFocused({ row: rIdx, col: 2 })}
                    />
                    {isBlank && !settled && (
                      <label className={s.rowBlankConfirm}>
                        <input
                          type="checkbox"
                          checked={!!st.confirmedBlank}
                          disabled={busy}
                          onChange={(e) =>
                            update(row.billId, "confirmedBlank", e.target.checked)
                          }
                        />
                        Confirm — no payment collected, {inr(row.remainingDue)} carries
                        forward
                      </label>
                    )}
                    {res && !res.ok && (
                      <span className={s.rowError} role="alert">
                        <AlertCircle size={11} /> {res.message}
                      </span>
                    )}
                    {res?.ok && (
                      <span className={s.rowOk}>
                        <CheckCircle2 size={11} /> {res.note}
                      </span>
                    )}
                    {!settled && !isBlank && !overpay && !rowResult.resolved && !res && (
                      <span className={s.rowNeedsAction}>
                        <AlertCircle size={11} /> {rowResult.reason}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---- Footer dock ---------------------------------------------- */}
      <div className={s.footerDock}>
        <div className={s.footerStats}>
          <div>
            <span className={s.footLabel}>Outstanding</span>
            <span className={s.footValue}>₹{inr(totals.outstanding)}</span>
          </div>
          <div>
            <span className={s.footLabel}>Being collected</span>
            <span className={`${s.footValue} ${s.footAccent}`}>
              ₹{inr(totals.entered)}
            </span>
          </div>
          <div>
            <span className={s.footLabel}>Rows filled</span>
            <span className={s.footValue}>
              {totals.filledRows} / {rows.length}
            </span>
          </div>
          {totals.unresolved > 0 && (
            <div>
              <span className={s.footLabel}>Needs attention</span>
              <span className={`${s.footValue} ${s.footWarn}`}>
                {totals.unresolved} row{totals.unresolved === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </div>

        <div className={s.footerActions}>
          <button
            type="button"
            className={s.btnSecondary}
            onClick={saveDraft}
            disabled={busy}
            title="Save what's filled in so far — you can close this and come back to it."
          >
            <Save size={14} />
            Save
          </button>
          {draftSavedAt && (
            <span className={s.draftSaved}>
              Saved {new Date(draftSavedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            ref={verifyBtnRef}
            className={s.btnVerify}
            onClick={onRequestVerify}
            disabled={busy || rows.length === 0 || totals.unresolved > 0}
            title={
              totals.unresolved > 0
                ? `${totals.unresolved} row${totals.unresolved === 1 ? "" : "s"} still need${
                    totals.unresolved === 1 ? "s" : ""
                  } a decision — enter a payment, confirm no payment, or confirm the extra as advance credit.`
                : undefined
            }
          >
            <Wallet size={16} />
            {totals.unresolved > 0
              ? `Resolve ${totals.unresolved} row${totals.unresolved === 1 ? "" : "s"} first`
              : "Verify & Submit"}
            {totals.unresolved === 0 && <kbd className={s.kbd}>⌘↵</kbd>}
          </button>
        </div>
      </div>
    </div>
  );
}
