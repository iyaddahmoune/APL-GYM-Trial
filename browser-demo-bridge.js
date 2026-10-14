(function () {
  if (!new URLSearchParams(location.search).has("browserDemo")) return;

  const ACTIVE_KEY = "gymmanager_local_account_active_v1";
  const TRIAL_STATUS = fetch("/v1/demo/status", { credentials: "same-origin", cache: "no-store" })
    .then(async response => ({ response, body: await response.json().catch(() => ({})) }))
    .catch(() => ({ response: { status: 503, ok: false }, body: { reason: "تعذر الاتصال بخدمة التجربة" } }));

  let machineId = localStorage.getItem("apl_gym_demo_machine_id");
  if (!machineId) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    machineId = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("").toUpperCase();
    localStorage.setItem("apl_gym_demo_machine_id", machineId);
  }

  function activeAccountId() {
    return localStorage.getItem(ACTIVE_KEY) || localStorage.getItem("gymmanager_active_account_v1") || "";
  }

  function dataUrl(accountId = activeAccountId(), all = false) {
    const query = new URLSearchParams();
    if (accountId) query.set("accountId", accountId);
    if (all) query.set("all", "1");
    return `/v1/demo/trainees?${query}`;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.reason || "تعذر الاتصال بخدمة التجربة");
    return body;
  }

  async function invoke(channel, ...args) {
    switch (channel) {
      case "check-license": {
        const { response, body } = await TRIAL_STATUS;
        if (!response.ok || !body.active) {
          location.replace(`demo.html?${response.status === 410 ? "expired=1" : "start=1"}`);
          return { valid: false, reason: body.reason || "انتهت التجربة المجانية" };
        }
        return { valid: true, expires: body.expiresAt, mode: "browser-demo" };
      }
      case "get-machine-id": return machineId;
      case "copy-machine-id":
        try { await navigator.clipboard.writeText(machineId); return { success: true }; }
        catch (_) { return { success: false }; }
      case "set-active-account":
        localStorage.setItem(ACTIVE_KEY, String(args[0] || ""));
        return { success: Boolean(args[0]), accountId: String(args[0] || "") };
      case "get-active-account": return activeAccountId() || null;
      case "get-trainees": {
        const result = await api(dataUrl());
        return Array.isArray(result.trainees) ? result.trainees : [];
      }
      case "save-trainees": {
        if (!activeAccountId() || !Array.isArray(args[0])) return false;
        const result = await api(dataUrl(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trainees: args[0] }) });
        return Boolean(result.success);
      }
      case "delete-trainee": {
        const records = await invoke("get-trainees");
        const remaining = records.filter(item => item && String(item.id) !== String(args[0]));
        await invoke("save-trainees", remaining);
        return remaining;
      }
      case "verify-recovery-code": return { valid: false, reason: "استعادة الحساب غير متاحة في نسخة التجربة" };
      case "activate-license":
      case "activate-online-license": return { valid: false, reason: "التفعيل متاح في نسخة Windows بعد الشراء" };
      case "get-email-backup-settings": return { enabled: false, connected: false, configured: false, recipient: "" };
      case "connect-google-mail":
      case "disconnect-google-mail":
      case "save-email-backup-settings":
      case "send-email-backup": return { success: false, reason: "النسخ بالبريد غير متاح في تجربة المتصفح" };
      case "delete-account-data": {
        const result = await api(dataUrl(String(args[0] || activeAccountId())), { method: "DELETE" });
        return result;
      }
      case "factory-reset":
        await api(dataUrl("", true), { method: "DELETE" });
        Object.keys(localStorage).filter(key => key.startsWith("gymmanager_local_") || key.startsWith("sbh_offers_account_") || key.startsWith("sbh_groups_account_")).forEach(key => localStorage.removeItem(key));
        return { success: true };
      case "toggle-fullscreen":
        if (document.fullscreenElement) { await document.exitFullscreen(); return false; }
        await document.documentElement.requestFullscreen(); return true;
      default: return null;
    }
  }

  window.gmBrowserDemo = true;
  window.gymManager = { ipcRenderer: { invoke } };

  function renderTrialBanner(status) {
    const banner = document.createElement("div");
    banner.id = "aplGymBrowserTrialBanner";
    banner.style.cssText = "position:fixed;z-index:99999;top:8px;left:50%;transform:translateX(-50%);background:#171717;border:1px solid #facc15;color:#fff;padding:8px 16px;border-radius:999px;font:14px Segoe UI,Arial,sans-serif;box-shadow:0 4px 18px #0009;white-space:nowrap";
    document.body.appendChild(banner);
    let remainingAtSync = Number(status.remainingMs) || 0;
    let monotonicSync = performance.now();
    function update() {
      const remaining = remainingAtSync - (performance.now() - monotonicSync);
      if (remaining <= 0) { location.replace("demo.html?expired=1"); return; }
      const totalSeconds = Math.ceil(remaining / 1000);
      const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
      const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
      const seconds = String(totalSeconds % 60).padStart(2, "0");
      banner.textContent = `نسخة تجريبية · الوقت المتبقي ${hours}:${minutes}:${seconds}`;
    }
    update();
    setInterval(update, 1000);
    setInterval(async () => {
      try {
        const response = await fetch("/v1/demo/status", { credentials: "same-origin", cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.active || body.remainingMs <= 0) { location.replace("demo.html?expired=1"); return; }
        remainingAtSync = Number(body.remainingMs);
        monotonicSync = performance.now();
        update();
      } catch (_) {
        // Keep the already-issued browser trial bounded by monotonic time if a refresh briefly fails.
      }
    }, 60_000);
  }

  TRIAL_STATUS.then(({ response, body }) => {
    if (response.ok && body.active) {
      document.addEventListener("DOMContentLoaded", () => renderTrialBanner(body), { once: true });
    }
  });
})();
