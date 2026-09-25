// The coalesced refresh used to live here. It moved to lib/session-refresh.js
// so the global fetch interceptor (lib/api-fetch-interceptor.js) shares the
// SAME in-flight promise: refresh tokens rotate on use and revoke the old jti,
// so two independent coalescers would invalidate each other's tokens under any
// page that mixes apiClient calls with raw fetch — which is most of them.
import {
  attemptRefresh,
  announceSessionEnded,
  fallbackRedirect,
} from "@/lib/session-refresh";

function redirectToLogin(detail) {
  // Announce first so the session dialog (Plan 05 §A5) can take over and keep
  // the user's unsaved work on screen; the hard redirect only happens while no
  // dialog is mounted.
  announceSessionEnded(detail);
  fallbackRedirect();
}
class ApiClient {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
  }
  async request(endpoint, options = {}, _isRetry = false) {
    const normalized = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const url = `${this.baseUrl}${normalized}`;
    const config = {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      credentials: "include", // ← Sends HttpOnly cookies automatically
      // Tells lib/api-fetch-interceptor.js to stay out of the way: this method
      // already retries behind a refresh below. Unknown init keys are ignored
      // by fetch, so this never reaches the network.
      __aapliHandled: true,
    };
    try {
      const response = await fetch(url, config);
      if (response.status === 401) {
        // One silent-refresh retry per request — a refresh-endpoint 401
        // itself (refresh token also expired/revoked) or a retry that still
        // 401s means the session is genuinely over.
        let detail;
        if (!_isRetry && normalized !== "/api/auth/refresh") {
          const refreshed = await attemptRefresh();
          if (refreshed.ok) return this.request(endpoint, options, true);
          if (refreshed.transient) throw new Error("Can't reach the server right now — check your connection and try again.");
          detail = refreshed.detail;
        }
        redirectToLogin(detail);
        throw new Error("Unauthorized");
      }
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || data.message || "Request failed");
        }
        return data;
      }
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      return response;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }
  get(endpoint) {
    return this.request(endpoint, { method: "GET" });
  }
  post(endpoint, body) {
    return this.request(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  put(endpoint, body) {
    return this.request(endpoint, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }
  // ADDED 2026-08-07: PATCH was missing entirely, so any screen that needed a
  // partial update had to abuse PUT or POST. The Units screen uses it to save a
  // unit's carpet area.
  patch(endpoint, body) {
    return this.request(endpoint, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }
  delete(endpoint, body) {
    return this.request(endpoint, {
      method: "DELETE",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async upload(endpoint, formData, _isRetry = false) {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "include", // ← Send cookies
        body: formData, // Don't set Content-Type for FormData
        __aapliHandled: true, // see request() — this method retries itself
      });
      if (response.status === 401) {
        let detail;
        if (!_isRetry) {
          const refreshed = await attemptRefresh();
          if (refreshed.ok) return this.upload(endpoint, formData, true);
          if (refreshed.transient) throw new Error("Can't reach the server right now — check your connection and try again.");
          detail = refreshed.detail;
        }
        redirectToLogin(detail);
        throw new Error("Unauthorized");
      }
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }
      return data;
    } catch (error) {
      console.error(`Upload Error [${endpoint}]:`, error);
      throw error;
    }
  }
  async download(endpoint, filename) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      credentials: "include", // ← Send cookies
    });
    if (!response.ok) {
      throw new Error("Download failed");
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
}
export const apiClient = new ApiClient("");
