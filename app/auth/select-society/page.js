"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ROLE_COLOR_MAP = {
  red: "bg-red-50 text-red-700 ring-red-600/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  green: "bg-green-50 text-green-700 ring-green-600/20",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
  purple: "bg-purple-50 text-purple-700 ring-purple-600/20",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/20",
};

function badgeClass(color) {
  return ROLE_COLOR_MAP[color] || "bg-gray-100 text-gray-700 ring-gray-500/20";
}

export default function SelectSocietyPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState(null);
  const [name, setName] = useState("");
  const [selecting, setSelecting] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const raw = sessionStorage.getItem("pendingProfiles");
    const storedName = sessionStorage.getItem("pendingName");
    if (!raw) {
      router.replace("/auth/login");
      return;
    }
    setProfiles(JSON.parse(raw));
    setName(storedName || "");
  }, []);

  const handleSelect = async (profileId, kind) => {
    setSelecting(profileId);
    setError("");
    try {
      const profileSelectToken = sessionStorage.getItem("profileSelectToken");
      const res = await fetch("/api/auth/switch-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ profileId, profileSelectToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          sessionStorage.removeItem("pendingProfiles");
          sessionStorage.removeItem("pendingUserId");
          sessionStorage.removeItem("profileSelectToken");
          sessionStorage.removeItem("pendingName");
          router.replace("/auth/login?expired=1");
          return;
        }
        throw new Error(data.error || "Failed to select society");
      }
      sessionStorage.removeItem("pendingProfiles");
      sessionStorage.removeItem("pendingUserId");
      sessionStorage.removeItem("profileSelectToken");
      sessionStorage.removeItem("pendingName");
      // Set by /auth/login when the user arrived with ?next= — see the note
      // there. This is the leg of the journey that used to lose it.
      let next = null;
      try {
        next = sessionStorage.getItem("postLoginNext");
        sessionStorage.removeItem("postLoginNext");
      } catch {
        next = null;
      }
      if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//")) {
        router.replace(next);
        return;
      }
      router.replace(kind === "Staff" ? "/my-access" : "/member/dashboard");
    } catch (err) {
      setError(err.message);
      setSelecting(null);
    }
  };

  if (profiles === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <span className="pulse-loader" style={{ width: 56, height: 56 }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl shadow-gray-200/60 ring-1 ring-gray-100">
        <h2 className="text-xl font-semibold text-gray-900">Choose Society</h2>
        <p className="mt-1 text-sm text-gray-500">
          Welcome back, {name}. You have access to {profiles.length}{" "}
          {profiles.length === 1 ? "profile" : "profiles"} — pick one to continue.
        </p>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2.5">
          {profiles.map((p) => {
            const isSelecting = selecting === String(p.profileId);
            const isDisabled = selecting !== null;
            const societyLabel = p.societyName?.trim() || "Unnamed Society";
            return (
              <button
                key={String(p.profileId)}
                onClick={() => handleSelect(String(p.profileId), p.kind)}
                disabled={isDisabled}
                className={`group relative flex items-center justify-between rounded-xl border px-4 py-3.5 text-left transition
                  ${isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-indigo-400 hover:shadow-sm"}
                  ${isSelecting ? "border-indigo-400" : "border-gray-200"}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base
                      ${p.kind === "Staff" ? "bg-indigo-50" : "bg-gray-100"}`}
                  >
                    {p.kind === "Staff" ? "🛡️" : "🏢"}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {societyLabel}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {p.kind === "Staff"
                        ? p.flatNo
                          ? `Management · Flat ${p.wing ? `${p.wing}-` : ""}${p.flatNo}`
                          : "Management"
                        : `${p.kind === "Commercial" ? "Shop" : "Flat"} ${p.wing ? `${p.wing}-` : ""}${p.flatNo || "—"}`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeClass(p.roleColor)}`}
                  >
                    {p.role}
                  </span>
                  {isSelecting && (
                    <span className="pulse-loader" style={{ width: 24, height: 24 }} />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
