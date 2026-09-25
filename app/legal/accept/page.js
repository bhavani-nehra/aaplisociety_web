"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import notify from "@/lib/notify";
import styles from "@/styles/LegalAccept.module.css";
import { SkylineArcMark } from "@/components/brand/SkylineArc";

async function apiFetch(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });
  } catch {
    const err = new Error("Can't reach the server. Check your connection and try again.");
    err.network = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Deliberately not a full markdown renderer — headings get weight, tables
// stay readable, everything else is a paragraph. This is a legal document
// people are meant to actually read, not decorate.
function MarkdownLite({ text }) {
  const lines = text.split("\n");
  const blocks = [];
  let para = [];
  let tableRows = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "p", text: para.join(" ") });
      para = [];
    }
  };
  const flushTable = () => {
    if (tableRows.length) {
      blocks.push({ type: "table", rows: tableRows });
      tableRows = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara();
      if (!/^\|[\s-:|]+\|$/.test(line)) {
        tableRows.push(line.split("|").slice(1, -1).map((c) => c.trim()));
      }
      continue;
    }
    flushTable();
    if (!line.trim()) {
      flushPara();
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flushPara();
      blocks.push({ type: `h${h[1].length}`, text: h[2] });
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flushPara();
      blocks.push({ type: "hr" });
      continue;
    }
    if (/^[-*]\s+/.test(line.trim())) {
      flushPara();
      blocks.push({ type: "li", text: line.trim().replace(/^[-*]\s+/, "") });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  flushTable();

  return (
    <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg-2)" }}>
      {blocks.map((b, i) => {
        if (b.type.startsWith("h")) {
          const size = { h1: 22, h2: 18, h3: 15, h4: 14 }[b.type] || 14;
          return <div key={i} style={{ fontWeight: 700, fontSize: size, margin: "1.1rem 0 0.4rem", color: "var(--fg-1)" }}>{b.text.replace(/\*\*/g, "")}</div>;
        }
        if (b.type === "hr") return <hr key={i} style={{ border: "none", borderTop: "1px solid var(--border)", margin: "1rem 0" }} />;
        if (b.type === "li") return <div key={i} style={{ display: "flex", gap: 8, margin: "0.25rem 0 0.25rem 0.5rem" }}><span>•</span><span>{b.text.replace(/\*\*(.*?)\*\*/g, "$1")}</span></div>;
        if (b.type === "table") {
          return (
            <div key={i} style={{ overflowX: "auto", margin: "0.6rem 0" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                <tbody>
                  {b.rows.map((row, ri) => (
                    <tr key={ri} style={ri === 0 ? { background: "var(--bg-sunken)", fontWeight: 700 } : {}}>
                      {row.map((cell, ci) => (
                        <td key={ci} style={{ border: "1px solid var(--border)", padding: "6px 8px" }}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={i} style={{ margin: "0.5rem 0" }}>{b.text.replace(/\*\*(.*?)\*\*/g, "$1")}</p>;
      })}
    </div>
  );
}

function DocumentSection({ doc, open, onToggle }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["legal-document", doc.id],
    queryFn: () => apiFetch(`/api/legal/document?doc=${doc.id}`),
    enabled: open,
    retry: 2,
  });

  return (
    <div className={styles.doc}>
      <button onClick={onToggle} aria-expanded={open} className={styles.docBtn}>
        <span>{doc.title}</span>
        <span className={styles.docHint}>{open ? "▾ Hide" : "▸ Read"}</span>
      </button>
      {open && (
        <div className={styles.docBody}>
          {isLoading ? (
            <div style={{ color: "var(--fg-4)", fontSize: 13 }}>Loading…</div>
          ) : isError ? (
            <div style={{ fontSize: 13, color: "var(--danger)", display: "flex", gap: 10, alignItems: "center" }}>
              Couldn't load this document.
              <button onClick={() => refetch()} style={{ padding: "2px 10px", borderRadius: 6, border: "1px solid var(--danger)", background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: 12 }}>Retry</button>
            </div>
          ) : (
            <MarkdownLite text={data.content} />
          )}
        </div>
      )}
    </div>
  );
}

export default function LegalAcceptPage() {
  const router = useRouter();
  const [openDoc, setOpenDoc] = useState(null);
  const [checked, setChecked] = useState(false);

  const status = useQuery({
    queryKey: ["legal-status"],
    queryFn: () => apiFetch("/api/v1/legal/status"),
    retry: 2,
  });

  useEffect(() => {
    if (status.data?.accepted) {
      router.replace("/admin/dashboard");
    }
  }, [status.data?.accepted, router]);

  const accept = useMutation({
    mutationFn: () => apiFetch("/api/v1/legal/accept", { method: "POST" }),
    onSuccess: () => {
      notify.success("Thanks — you're all set.");
      router.replace("/admin/dashboard");
    },
    onError: (err) => notify.error(err.message),
  });

  if (status.isLoading) {
    return <div className={styles.center}>Loading…</div>;
  }

  if (status.isError) {
    return (
      <div className={styles.center}>
        <div className={styles.card} style={{ textAlign: "center", maxWidth: 420 }}>
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{status.error.message}</p>
          <button
            onClick={() => status.refetch()}
            style={{ padding: "0.5rem 1.25rem", borderRadius: 6, border: "none", background: "var(--primary)", color: "var(--on-solid)", fontWeight: 700, cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const documents = status.data?.documents || [];

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.head}>
          <div className={styles.mark}>
            <SkylineArcMark color="#ffffff" size={30} />
          </div>
          <h1 className={styles.title}>Before you continue</h1>
          <p className={styles.sub}>
            Your Society needs to accept these before you can use the dashboard. One acceptance covers your whole Society — any Admin or Secretary confirming this is enough.
          </p>
        </div>

        {documents.map((doc) => (
          <DocumentSection
            key={doc.id}
            doc={doc}
            open={openDoc === doc.id}
            onToggle={() => setOpenDoc(openDoc === doc.id ? null : doc.id)}
          />
        ))}

        <label className={styles.agree}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I have read and agree to the Terms of Service, Privacy Policy, and Refund &amp; Cancellation Policy on behalf of my Society.</span>
        </label>

        <button
          onClick={() => accept.mutate()}
          disabled={!checked || accept.isPending}
          className={`${styles.cta} ${checked ? styles.ctaOn : styles.ctaOff}`}
        >
          {accept.isPending ? "Saving…" : "Accept and continue"}
        </button>
      </div>
    </div>
  );
}
