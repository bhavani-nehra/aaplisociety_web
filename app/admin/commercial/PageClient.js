"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardHead, Pill, StatTile, Btn, Icon } from "./_ui";

const QUICK_LINKS = [
  { href: "/admin/commercial/units", icon: "home", title: "Units", body: "Tag which flats are shops or offices, in bulk." },
  { href: "/admin/commercial/businesses", icon: "store", title: "Businesses", body: "Create listings, contact details & hours, publish or suspend." },
  { href: "/admin/commercial/categories", icon: "tag", title: "Categories", body: "Add categories specific to this society." },
  { href: "/admin/commercial/rate-card", icon: "indian-rupee", title: "Rate card", body: "Compare a flat, a shop and an office side by side." },
  { href: "/admin/generate-bills", icon: "file-text", title: "Generate bills", body: "Switch to the Commercial segment of the billing wizard." },
];

export default function CommercialOverviewPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["commercial-overview"],
    queryFn: () => apiClient.get("/api/commercial/overview"),
    retry: false,
  });
  const disabled = /not enabled/i.test(error?.message || "");

  return (
    <div className="commercial-scope cx-fade" style={{ padding: "1.75rem 2rem" }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, color: "var(--cx-fg-4)", marginBottom: 8 }}>
          <Icon name="store" size={11} /> Shops &amp; offices
        </div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "var(--cx-fg-1)", letterSpacing: "-0.018em" }}>Commercial</h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--cx-fg-3)" }}>
          Which units are commercial, what they sell, and what they are charged.
        </p>
      </div>

      {disabled && (
        <Card style={{ marginBottom: 18, borderColor: "var(--cx-warning)" }}>
          <span style={{ color: "var(--cx-warning)" }}>The commercial module is switched off for this society. Turn it on in{" "}</span>
          <Link href="/admin/society-config" style={{ fontWeight: 700, color: "var(--cx-brand)" }}>Society Config</Link>.
        </Card>
      )}
      {error && !disabled && (
        <Card style={{ marginBottom: 18, borderColor: "var(--cx-danger)", color: "var(--cx-danger)" }}>{error.message}</Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 18 }}>
        <StatTile icon="home" label="Units in society" value={isLoading ? "–" : String(data?.units?.total ?? 0)} />
        <StatTile icon="store" label="Tagged Shop / Office" value={isLoading ? "–" : String(data?.units?.commercial ?? 0)} />
        <StatTile icon="check-circle" label="Published listings" value={isLoading ? "–" : String(data?.listings?.PUBLISHED ?? 0)} />
        <StatTile icon="file-text" label="Drafts" value={isLoading ? "–" : String(data?.listings?.DRAFT ?? 0)} />
        <StatTile icon="alert-triangle" label="Suspended" value={isLoading ? "–" : String(data?.listings?.SUSPENDED ?? 0)} tone={(data?.listings?.SUSPENDED ?? 0) > 0 ? "danger" : undefined} />
      </div>

      {!isLoading && !error && (data?.units?.commercial ?? 0) === 0 && (
        <Card style={{ marginBottom: 18 }}>
          No unit is tagged as a Shop or an Office yet, so no business can be listed. Start on the{" "}
          <Link href="/admin/commercial/units" style={{ fontWeight: 700, color: "var(--cx-brand)" }}>Units</Link> screen.
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginBottom: 18 }}>
        {QUICK_LINKS.map((l) => (
          <Link key={l.href} href={l.href} style={{ textDecoration: "none" }}>
            <Card hover style={{ height: "100%" }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--cx-brand-soft)", color: "var(--cx-brand)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <Icon name={l.icon} size={16} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cx-fg-1)" }}>{l.title}</div>
              <div style={{ fontSize: 12, color: "var(--cx-fg-3)", lineHeight: 1.4, marginTop: 4 }}>{l.body}</div>
            </Card>
          </Link>
        ))}
      </div>

      {data?.flags && (
        <Card>
          <CardHead title="Switches" sub="Society-wide commercial module flags" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {[
              ["Module", data.flags.enabled],
              ["Member directory", data.flags.directoryEnabled],
              ["Owner self-editing", data.flags.ownerEditingEnabled],
              ["Commercial billing", data.flags.commercialBillingEnabled],
            ].map(([label, on]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", background: "var(--cx-surface-2)", borderRadius: 9, border: "1px solid var(--cx-border)" }}>
                <span style={{ fontSize: 12, color: "var(--cx-fg-2)", fontWeight: 500 }}>{label}</span>
                <Pill tone={on ? "active" : "neutral"} dot={false}>{on ? "on" : "off"}</Pill>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <Btn variant="ghost" href="/admin/society-config">Change these in Society Config</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}
