import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, BarChart3, ExternalLink, Shield, Zap } from "lucide-react";
import { api } from "../lib/api";
import {
  clearManagedBackup,
  fetchAnalyticsSummary,
  logoutCloudSession,
  redeemAccessCode,
  saveManagedBackup,
  type AnalyticsSummary,
  type CloudUser,
  getManagedBackup,
} from "../lib/cloud";
import { recordTelemetry } from "../lib/telemetry";
import { useApp } from "../lib/store";

const MANAGED_MODEL_ID = "zwork-router";
const MANAGED_BASE_URL = "https://api.tryzwork.app/api/v1";
const MANAGED_MODEL_NAME = "zWork Router";

function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-line bg-paper-raised p-5 shadow-[0_10px_40px_rgba(17,17,17,0.05)]">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">{label}</div>
        <div className="text-ink-muted">{icon}</div>
      </div>
      <div className="mt-4 text-[34px] font-light tracking-tight text-ink">{value}</div>
      <div className="mt-1 text-[12.5px] leading-5 text-ink-muted">{hint}</div>
    </div>
  );
}

function ProgressQuotaCard({
  label,
  used,
  limit,
  hint,
}: {
  label: string;
  used: number;
  limit: number;
  hint: string;
}) {
  const remaining = Math.max(limit - used, 0);
  const percentRemaining = limit > 0 ? Math.max(0, Math.min(100, (remaining / limit) * 100)) : 0;
  const tone =
    percentRemaining <= 10 ? "bg-[#dc2626]"
      : percentRemaining <= 25 ? "bg-[#f59e0b]"
        : "bg-[#15803d]";

  return (
    <div className="rounded-[28px] border border-line bg-paper-raised p-5 shadow-[0_10px_40px_rgba(17,17,17,0.05)]">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">{label}</div>
          <div className="mt-3 text-[28px] font-light tracking-tight text-ink">
            {remaining}
            <span className="ml-1 text-[14px] text-ink-muted">left</span>
          </div>
        </div>
        <div className="text-right text-[12px] text-ink-muted">
          <div>{used} used</div>
          <div>{limit} total</div>
        </div>
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-[#d7d7d1]">
        <div className={`h-full rounded-full transition-[width] duration-300 ${tone}`} style={{ width: `${percentRemaining}%` }} />
      </div>
      <div className="mt-2 text-[12.5px] leading-5 text-ink-muted">{hint}</div>
    </div>
  );
}

export function AnalyticsPage({
  cloudUser,
  onCloudUserChange,
}: {
  cloudUser: CloudUser;
  onCloudUserChange: (user: CloudUser | null) => void;
}) {
  const settings = useApp((s) => s.settings);
  const refreshSettings = useApp((s) => s.refreshSettings);
  const refreshProviders = useApp((s) => s.refreshProviders);
  const saveSettings = useApp((s) => s.saveSettings);
  const upsertCustomModel = useApp((s) => s.upsertCustomModel);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessCode, setAccessCode] = useState("zwork-dev-pro");
  const [accessCodeBusy, setAccessCodeBusy] = useState(false);
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [trendRange, setTrendRange] = useState<"7d" | "1m">("7d");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void fetchAnalyticsSummary()
      .then((data) => {
        if (!alive) return;
        setSummary(data);
        onCloudUserChange(data.user);
      })
      .catch(() => {
        if (!alive) return;
        setSummary(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [onCloudUserChange]);

  const managedActive = useMemo(() => {
    const currentBase = settings?.provider_config?.openai?.base_url || "";
    const currentDefault = settings?.default_model || "";
    return currentBase === MANAGED_BASE_URL && currentDefault === MANAGED_MODEL_ID;
  }, [settings]);
  const managedReady = summary?.managed_gateway_ready ?? false;
  const managedStatus = summary?.managed_gateway_status || "Checking hosted gateway status…";

  const activateManagedMode = async () => {
    if (!settings) return;
    setRouteBusy(true);
    setRouteError(null);
    try {
      if (!getManagedBackup()) {
        saveManagedBackup({
          apiKey: settings.api_keys?.openai || "",
          baseUrl: settings.provider_config?.openai?.base_url || "",
          defaultModel: settings.default_model || "",
        });
      }
      await saveSettings({
        api_keys: { openai: window.localStorage.getItem("zwork:cloud-token") || "" },
        provider_config: { openai: { base_url: MANAGED_BASE_URL } },
      });
      await upsertCustomModel({
        id: MANAGED_MODEL_ID,
        name: MANAGED_MODEL_NAME,
        shape: "openai",
        credential: "openai",
        model_id: MANAGED_MODEL_ID,
        base_url_override: MANAGED_BASE_URL,
      });
      await api.putSettings({ default_model: MANAGED_MODEL_ID });
      await Promise.all([refreshSettings(), refreshProviders()]);
      recordTelemetry("managed_mode_activated", {
        tier: cloudUser.tier,
      });
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : "Failed to activate managed mode.");
    } finally {
      setRouteBusy(false);
    }
  };

  const restorePersonalMode = async () => {
    const backup = getManagedBackup();
    setRouteBusy(true);
    setRouteError(null);
    try {
      await saveSettings({
        api_keys: { openai: backup?.apiKey || "" },
        provider_config: { openai: { base_url: backup?.baseUrl || "" } },
      });
      await api.putSettings({ default_model: backup?.defaultModel || "" });
      clearManagedBackup();
      await Promise.all([refreshSettings(), refreshProviders()]);
      recordTelemetry("managed_mode_restored_personal", {});
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : "Failed to restore your previous setup.");
    } finally {
      setRouteBusy(false);
    }
  };

  const redeemAccess = async () => {
    setAccessCodeBusy(true);
    setAccessCodeError(null);
    try {
      const user = await redeemAccessCode(accessCode);
      onCloudUserChange(user);
      setSummary((current) => (current ? { ...current, user } : current));
      recordTelemetry("access_code_applied", {
        code: accessCode,
        tier: user.tier,
      });
    } catch (error) {
      setAccessCodeError(error instanceof Error ? error.message : "Failed to redeem access code.");
      recordTelemetry("access_code_failed", {
        code: accessCode,
        message: error instanceof Error ? error.message : "Failed to redeem access code.",
      });
    } finally {
      setAccessCodeBusy(false);
    }
  };

  const signOut = async () => {
    setLogoutBusy(true);
    try {
      await logoutCloudSession();
      onCloudUserChange(null);
    } finally {
      setLogoutBusy(false);
    }
  };

  const trendData = trendRange === "1m" ? (summary?.past_month || []) : (summary?.past_week || []);
  const maxDay = Math.max(1, ...(trendData.map((day) => day.roots) || [1]));
  const user = summary?.user || cloudUser;
  const ownerProviders = summary?.owner_provider_overview || [];

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-y-auto bg-paper">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-6 py-8">
        <section className="overflow-hidden rounded-[32px] border border-line bg-[linear-gradient(135deg,rgba(247,240,226,0.95),rgba(255,255,255,0.82)),radial-gradient(circle_at_top_right,rgba(15,118,110,0.14),transparent_34%)] p-6 shadow-[0_24px_90px_rgba(17,17,17,0.08)] md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Managed analytics</div>
              <h1 className="mt-3 text-[40px] font-light leading-[0.95] tracking-tight text-ink md:text-[52px]">
                {user.name.split(/\s+/)[0] || "zWork"} is signed in.
              </h1>
              <p className="mt-3 max-w-[60ch] text-[14px] leading-6 text-ink-muted">
                Your hosted account, access status, request volume, and server access all land here. Root user actions are counted separately from internal tool and continuation turns so agentic runs do not get rate-limited into the floor.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-line-strong bg-white/80 px-3 py-1.5 text-[12px] font-medium text-ink">
                {user.tier === "pro" ? "Pro plan unlocked" : "Free plan"}
              </span>
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={logoutBusy}
                className="rounded-full border border-line bg-white/80 px-3 py-1.5 text-[12px] font-medium text-ink-muted hover:text-ink disabled:opacity-50"
              >
                {logoutBusy ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <ProgressQuotaCard
            label="5 Hour Limit"
            used={loading ? 0 : (summary?.five_hour_used || 0)}
            limit={loading ? 0 : (summary?.five_hour_limit || 0)}
            hint="Rolling product quota for user-initiated runs in the last five hours."
          />
          <ProgressQuotaCard
            label="Weekly Limit"
            used={loading ? 0 : (summary?.weekly_used || 0)}
            limit={loading ? 0 : (summary?.weekly_limit || 0)}
            hint="Rolling seven-day budget. This resets gradually as older usage falls out of the window."
          />
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <StatCard label="Plan" value={user.tier === "pro" ? "Pro" : "Free"} hint={user.access_code || user.coupon_code ? `Code: ${user.access_code || user.coupon_code}` : "No access code applied yet."} icon={<Shield className="h-4 w-4" />} />
          <StatCard label="Active Runs" value={loading ? "…" : String(summary?.active_runs || 0)} hint="Concurrent root runs still in flight right now." icon={<Activity className="h-4 w-4" />} />
          <StatCard label="Continuations" value={loading ? "…" : String(summary?.continuation_requests_today || 0)} hint="Internal tool/model turns today. These do not burn root quota directly." icon={<Zap className="h-4 w-4" />} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[28px] border border-line bg-paper-raised p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[18px] font-semibold tracking-tight text-ink">Usage trend</h2>
                <p className="mt-1 text-[13px] text-ink-muted">Root-request volume over time so users can see pace before they slam into quota.</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-full border border-line bg-paper-sunken p-1">
                  <button
                    type="button"
                    onClick={() => setTrendRange("7d")}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium ${trendRange === "7d" ? "bg-ink text-paper" : "text-ink-muted"}`}
                  >
                    7d
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrendRange("1m")}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium ${trendRange === "1m" ? "bg-ink text-paper" : "text-ink-muted"}`}
                  >
                    1m
                  </button>
                </div>
                <BarChart3 className="h-5 w-5 text-ink-faint" />
              </div>
            </div>
            <div
              className="mt-6 grid gap-3"
              style={{ gridTemplateColumns: `repeat(${Math.max(trendData.length, 1)}, minmax(0, 1fr))` }}
            >
              {trendData.map((day) => {
                const height = `${Math.max(8, (day.roots / maxDay) * 180)}px`;
                return (
                  <div key={day.day} className="flex flex-col items-center gap-2">
                    <div className="flex h-[200px] w-full items-end justify-center rounded-[22px] bg-paper-sunken px-2 pb-2">
                      <div
                        className="flex w-full flex-col overflow-hidden rounded-[16px] border border-line/70 bg-white/80"
                        style={{ height }}
                      >
                        <div className="flex-1 bg-[#15803d]" />
                      </div>
                    </div>
                    <div className="text-center text-[11px] text-ink-muted">
                      {day.day.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-[28px] border border-line bg-paper-raised p-6">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Managed route</div>
              <h2 className="mt-3 text-[20px] font-semibold tracking-tight text-ink">Use the hosted gateway</h2>
              <p className="mt-2 text-[13px] leading-6 text-ink-muted">
                This repoints the local sidecar to {summary?.router_label || "zWork Router"} with your signed-in desktop token, while keeping the agent loop local on-device.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {managedActive ? (
                  <button
                    type="button"
                    disabled={routeBusy}
                    onClick={() => void restorePersonalMode()}
                    className="rounded-full border border-line-strong bg-paper px-4 py-2 text-[12.5px] font-medium text-ink hover:bg-paper-sunken disabled:opacity-50"
                  >
                    {routeBusy ? "Restoring…" : "Return to personal setup"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={routeBusy || user.tier !== "pro" || !managedReady}
                    onClick={() => void activateManagedMode()}
                    className="rounded-full bg-ink px-4 py-2 text-[12.5px] font-medium text-paper hover:bg-ink-soft disabled:opacity-50"
                  >
                    {routeBusy
                      ? "Activating…"
                      : user.tier !== "pro"
                        ? "Unlock pro first"
                        : managedReady
                          ? "Activate managed mode"
                          : "Hosted gateway not ready"}
                  </button>
                )}
              </div>
              <div className="mt-3 rounded-2xl border border-line bg-paper-sunken px-4 py-3 text-[12.5px] text-ink-muted">
                {managedStatus}
              </div>
              {routeError && (
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">
                  {routeError}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-line bg-paper-raised p-6">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Pro testing</div>
              <h2 className="mt-3 text-[20px] font-semibold tracking-tight text-ink">Access code</h2>
              <p className="mt-2 text-[13px] leading-6 text-ink-muted">
                Use a dev access code to test the paid path before Stripe is live.
              </p>
              <div className="mt-4 flex gap-2">
                <input
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  className="min-w-0 flex-1 rounded-full border border-line bg-paper px-4 py-2 text-[12.5px] text-ink focus:border-line-strong focus:outline-none"
                  placeholder="zwork-dev-pro"
                />
                <button
                  type="button"
                  disabled={accessCodeBusy}
                  onClick={() => void redeemAccess()}
                  className="rounded-full border border-line-strong bg-paper px-4 py-2 text-[12.5px] font-medium text-ink hover:bg-paper-sunken disabled:opacity-50"
                >
                  {accessCodeBusy ? "Applying…" : "Apply code"}
                </button>
              </div>
              {accessCodeError && (
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">
                  {accessCodeError}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            { label: "API", href: summary?.api_url || "https://api.tryzwork.app/health", note: "Health check and the hosted gateway edge." },
            { label: "Analytics", href: summary?.analytics_url || "https://us.posthog.com/project/397748", note: "PostHog project for funnels, auth, and usage stats." },
            { label: "DB", href: summary?.db_url || "https://db.tryzwork.app/", note: "Private admin surface. Public access should stay blocked." },
          ].map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="group rounded-[24px] border border-line bg-paper-raised p-5 transition-transform hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">{link.label}</div>
                <ExternalLink className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
              <div className="mt-4 text-[16px] font-semibold tracking-tight text-ink">{link.href.replace(/^https?:\/\//, "")}</div>
              <div className="mt-2 text-[12.5px] leading-6 text-ink-muted">{link.note}</div>
            </a>
          ))}
        </section>

        {ownerProviders.length > 0 && (
          <section className="rounded-[28px] border border-line bg-paper-raised p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Owner view</div>
                <h2 className="mt-3 text-[20px] font-semibold tracking-tight text-ink">Provider usage overview</h2>
                <p className="mt-2 text-[13px] leading-6 text-ink-muted">
                  Seven-day request and token volume across the hosted router, plus the latest observed provider headroom when the upstream exposes it.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              {ownerProviders.map((provider) => (
                <div key={provider.provider_name} className="rounded-[22px] border border-line bg-paper p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[15px] font-semibold text-ink">{provider.provider_name}</div>
                      <div className="mt-1 text-[12px] text-ink-muted">
                        {provider.last_model_id || "No recent model recorded"}
                      </div>
                    </div>
                    <div className="rounded-full border border-line bg-paper-sunken px-2.5 py-1 text-[11px] text-ink-muted">
                      {provider.last_status ? `HTTP ${provider.last_status}` : "No status"}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-ink-faint">7d requests</div>
                      <div className="mt-1 text-[22px] font-light tracking-tight text-ink">{provider.requests_7d}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-ink-faint">7d tokens</div>
                      <div className="mt-1 text-[22px] font-light tracking-tight text-ink">{provider.total_tokens_7d}</div>
                    </div>
                  </div>
                  <div className="mt-4 space-y-1 text-[12px] text-ink-muted">
                    <div>Roots: {provider.roots_7d} • Continuations: {provider.continuations_7d}</div>
                    <div>Prompt: {provider.prompt_tokens_7d} • Completion: {provider.completion_tokens_7d}</div>
                    <div>
                      Remaining req/day: {provider.requests_remaining_day ?? "n/a"}
                      {provider.requests_limit_day ? ` / ${provider.requests_limit_day}` : ""}
                    </div>
                    <div>
                      Remaining tok/min: {provider.tokens_remaining_minute ?? "n/a"}
                      {provider.tokens_limit_minute ? ` / ${provider.tokens_limit_minute}` : ""}
                    </div>
                    <div>
                      Last seen: {provider.last_observed_at ? new Date(provider.last_observed_at).toLocaleString() : "n/a"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
