"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PageHeader, Card, Btn, Icon, Select, Toast,
} from "@/components/revamp";

const CATEGORIES = [
  { value: "noise", label: "Noise" },
  { value: "parking", label: "Parking" },
  { value: "water", label: "Water" },
  { value: "security", label: "Security" },
  { value: "cleanliness", label: "Cleanliness" },
  { value: "maintenance", label: "Maintenance" },
  { value: "billing", label: "Billing" },
  { value: "staff", label: "Staff" },
  { value: "pets", label: "Pets" },
  { value: "other", label: "Other" },
];

export default function CreateComplaintPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    category: "",
    title: "",
    description: "",
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const validate = () => {
    const e = {};
    if (!form.category) e.category = "Please select a category";
    if (!form.title || form.title.length < 10)
      e.title = "Title must be at least 10 characters";
    if (form.title.length > 120) e.title = "Title must be under 120 characters";
    if (!form.description || form.description.length < 30)
      e.description = "Description must be at least 30 characters";
    if (form.description.length > 1000)
      e.description = "Description must be under 1000 characters";
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) return setErrors(errs);
    setErrors({});
    setLoading(true);
    try {
      const res = await fetch("/api/complaints", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit");
      showToast("Complaint submitted anonymously! It is now pending review.");
      setTimeout(() => router.push("/member/complaints/my"), 1500);
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="message-square" size={11} /> Community</>}
        title="Submit a Complaint"
        sub="Your identity will remain anonymous publicly. Admin reviews before it goes live."
      />

      <Card>
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
          <div>
            <label className="label">Category *</label>
            <Select
              value={form.category}
              onChange={(v) => setForm({ ...form, category: v })}
              size="md"
              style={{
                width: "100%",
                borderColor: errors.category ? "var(--r-danger)" : undefined,
              }}
            >
              <option value="">-- Select Category --</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            {errors.category && (
              <span style={{ display: "block", fontSize: 12, color: "var(--r-danger)", marginTop: 5 }}>
                {errors.category}
              </span>
            )}
          </div>

          <div>
            <label className="label" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Title *</span>
              <span style={{ color: "var(--r-fg-4)", fontWeight: 500 }}>{form.title.length}/120</span>
            </label>
            <input
              type="text"
              className="input"
              value={form.title}
              maxLength={120}
              placeholder="Brief title (10–120 characters)"
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              style={{ borderColor: errors.title ? "var(--r-danger)" : undefined }}
            />
            {errors.title && (
              <span style={{ display: "block", fontSize: 12, color: "var(--r-danger)", marginTop: 5 }}>
                {errors.title}
              </span>
            )}
          </div>

          <div>
            <label className="label" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Description *</span>
              <span style={{ color: "var(--r-fg-4)", fontWeight: 500 }}>{form.description.length}/1000</span>
            </label>
            <textarea
              className="input"
              value={form.description}
              maxLength={1000}
              rows={6}
              placeholder="Describe the issue clearly (30–1000 characters). Do not include phone numbers, emails, or links."
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              style={{ resize: "vertical", fontFamily: "inherit", borderColor: errors.description ? "var(--r-danger)" : undefined }}
            />
            {errors.description && (
              <span style={{ display: "block", fontSize: 12, color: "var(--r-danger)", marginTop: 5 }}>
                {errors.description}
              </span>
            )}
          </div>

          <div style={{
            display: "flex", gap: 8, alignItems: "flex-start",
            padding: "10px 12px", borderRadius: 8,
            background: "var(--r-surface-2)", color: "var(--r-fg-3)", fontSize: 12.5, lineHeight: 1.5,
          }}>
            <Icon name="lock" size={13} style={{ marginTop: 1 }} />
            <span>Your complaint is submitted anonymously as a random pseudonym. Max 2 per day, 15 min cooldown.</span>
          </div>

          <div style={{
            display: "flex", gap: 8, alignItems: "flex-start",
            padding: "12px 16px", borderRadius: 8,
            background: "var(--r-warning-soft)", color: "var(--r-warning)", fontSize: 13,
          }}>
            <Icon name="lock" size={14} style={{ marginTop: 1 }} />
            <span>Complaint submission is currently disabled. Contact your society admin directly.</span>
          </div>

          <Btn type="submit" variant="primary" size="lg" disabled style={{ width: "100%" }}>
            Submit Complaint
          </Btn>
        </form>
      </Card>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
