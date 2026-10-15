"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  GitBranch,
  History,
  Leaf,
  Lightbulb,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  HardDrive,
  Settings,
  ShieldCheck,
  Sparkles,
  Sprout,
  Sun,
  Trees,
  TriangleAlert,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  HistoryEvent,
  Locale,
  Operation,
  Policy,
  PolicyState,
  PolicyStatus,
} from "./lib/policy/types";
import {
  dayKey,
  descendants,
  getTodayActivation,
} from "./lib/policy/domain";
import { usePolicyStore } from "./lib/policy/use-policy-store";
import { checkBackupSize, parseBackup, serializeBackup } from "./lib/policy/backup";

type PageName = "today" | "tree" | "library" | "history" | "settings";
type ModalState =
  | {
      type: "edit" | "activate" | "violate" | "reflect" | "detail";
      policy?: Policy;
    }
  | { type: "install" }
  | null;
const statusText: Record<PolicyStatus, [string, string]> = {
  draft: ["草稿", "Draft"],
  ready: ["待选", "Ready"],
  trial: ["今日尝试", "Today's trial"],
  active: ["生效中", "Active"],
  returned: ["已退回", "Returned"],
};
const navItems: { id: PageName; cn: string; en: string; icon: LucideIcon }[] = [
  { id: "today", cn: "今日", en: "Today", icon: Sun },
  { id: "tree", cn: "国策树", en: "Policy tree", icon: GitBranch },
  { id: "library", cn: "国策库", en: "Library", icon: BookOpen },
  { id: "history", cn: "历程", en: "History", icon: History },
  { id: "settings", cn: "设置", en: "Settings", icon: Settings },
];
function uid() {
  return crypto.randomUUID();
}
function fmtDate(at: string, locale: Locale, timezone: string, full = false) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    ...(full ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(at));
}
async function exportBackup(state: PolicyState, today: string) {
  const content = serializeBackup(state);
  const name = `policy-tree-${today}.json`;
  const file = new File([content], name, { type: "application/json" });
  let canShareFile = false;
  try {
    canShareFile = typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {}
  if (canShareFile && typeof navigator.share === "function") {
    try {
      await navigator.share({ files: [file], title: "Policy Tree backup" });
      return "shared" as const;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled" as const;
      throw error;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "downloaded" as const;
}

export default function PolicyApp() {
  const {
    state,
    ready,
    error,
    lastSaved,
    submit,
    reload,
    updateAvailable,
    offlineReady,
    applyUpdate,
    storageError,
  } = usePolicyStore();
  const locale = state.settings.locale;
  const t = (cn: string, en: string) => (locale === "zh" ? cn : en);
  const [page, setPage] = useState<PageName>("today");
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(() => new Date().toISOString());
  const [exporting, setExporting] = useState(false);
  const [installHint, setInstallHint] = useState(false);
  const readyPolicies = state.policies.filter((p) => p.status === "ready");
  const active = state.policies.filter((p) => p.status === "active");
  const trial = state.policies.find((p) => p.status === "trial");
  const todayActivation = getTodayActivation(state, now);
  const today = dayKey(now, state.settings.timezone);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4200);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    try {
      setInstallHint(
        !window.matchMedia("(display-mode: standalone)").matches &&
          localStorage.getItem("policy-tree-install-dismissed") !== "1",
      );
    } catch {}
  }, []);
  async function act(
    type: Operation["type"],
    policyId?: string,
    payload: Record<string, unknown> = {},
    message?: string,
  ) {
    const saved = await submit(type, policyId, payload);
    if (saved && message) setToast(message);
    return saved;
  }
  const choose = async (p: Policy) => {
    if (
      await act("choose", p.id, {}, t("已选为今日尝试", "Chosen for today"))
    ) {
      setModal(null);
      setPage("today");
    }
  };
  const newPolicy = () => setModal({ type: "edit" });
  const editCandidate = async (p: Policy) => {
    if (p.status === "returned") {
      if (
        await act(
          "restore",
          p.id,
          {},
          t(
            "已重新加入待选，可调整规则",
            "Returned to Ready; you can revise the rule",
          ),
        )
      )
        setModal({
          type: "edit",
          policy: { ...p, status: "ready", parentId: null },
        });
    } else if (p.status === "draft" || p.status === "ready")
      setModal({ type: "edit", policy: p });
  };
  const keepTrial = async (p: Policy) => {
    if (await act("restore", p.id))
      await act(
        "choose",
        p.id,
        {},
        t("已沿用为今天的尝试", "Kept as today’s trial"),
      );
  };
  const badge = (p: Policy) => (
    <span className={`status-badge ${p.status}`}>
      {statusText[p.status][locale === "zh" ? 0 : 1]}
    </span>
  );
  const openDetail = (p: Policy) => setModal({ type: "detail", policy: p });
  const navigate = (id: PageName) => {
    setPage(id);
    setModal(null);
  };
  if (!ready)
    return (
      <div className="loading-screen">
        <Trees size={42} />
        <h1>{t("正在载入你的国策树", "Loading your policy tree")}</h1>
        {error ? (
          <>
            <p className="muted">{error}</p>
            <button className="button primary" onClick={reload}>
              {t("重新读取", "Reload data")}
            </button>
          </>
        ) : (
          <Loader2 className="spin" />
        )}
        <p className="field-help">
          {t(
            "正在读取此浏览器保存的记录。",
            "Reading records saved in this browser.",
          )}
        </p>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#today"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("today");
          }}
        >
          <span className="brand-mark">
            <Trees size={26} />
          </span>
          <span className="brand-copy">
            <strong>国策树</strong>
            <small>POLICY TREE</small>
          </span>
        </a>
        <div className="nav-section-label">{t("我的空间", "MY SPACE")}</div>
        <nav className="nav-list" aria-label={t("主导航", "Main navigation")}>
          {navItems.map((n) => (
            <button
              key={n.id}
              className={`nav-link ${page === n.id ? "active" : ""}`}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={20} />
              <span>{t(n.cn, n.en)}</span>
              {n.id === "library" && <small>{readyPolicies.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-quote">
            <Sprout size={22} />
            <p>
              {t("不必一步到位。", "One small rule at a time.")}
              <br />
              {t("每天，让改变生长一点。", "Let your progress take root.")}
            </p>
          </div>
          <div className="sidebar-profile">
            <span className="avatar">我</span>
            <div>
              <strong>{t("我的国策树", "My policy tree")}</strong>
              <small>{t("本机空间 · v0.3", "On this device · v0.3")}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span className="mobile-brand">
              <Trees size={22} />
              国策树
            </span>
            <span className="desktop-breadcrumb">
              {t("我的空间", "My space")} <ChevronRight size={14} />{" "}
              {t(
                navItems.find((n) => n.id === page)!.cn,
                navItems.find((n) => n.id === page)!.en,
              )}
            </span>
          </div>
          <div className="topbar-actions">
            <button
              className={`sync-indicator ${storageError ? "error" : ""}`}
              title={t("记录保存在当前浏览器，请定期导出备份", "Records stay in this browser. Export backups regularly.")}
              onClick={() => setPage("settings")}
            >
              {storageError ? <TriangleAlert size={15} /> : <HardDrive size={15} />}
              <span>{storageError ? t("保存需处理", "Storage needs attention") : t("保存在本机", "On this device")}</span>
            </button>
            <button
              className="avatar"
              aria-label={t("个人设置", "Personal settings")}
              onClick={() => setPage("settings")}
            >
              我
            </button>
          </div>
        </header>
        <main className="page" id="main-content">
          {storageError && (
            <div className="notice error" role="alert">
              <TriangleAlert size={18} />
              {storageError}
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
            </div>
          )}
          {updateAvailable && (
            <div className="notice success">
              <RefreshCw size={18} />
              <span>
                {t(
                  "新版本已准备好。当前记录会保留，填写中的内容请先保存。",
                  "An update is ready. Records are retained; save any open editor first.",
                )}
              </span>
              <button
                className="text-button"
                onClick={() => {
                  if (modal) {
                    setToast(
                      t(
                        "请先保存并关闭当前编辑窗口",
                        "Save and close the current editor first",
                      ),
                    );
                    return;
                  }
                  applyUpdate();
                }}
              >
                {t("立即更新", "Update now")}
              </button>
            </div>
          )}
          {page === "today" && (
            <>
              <div className="page-header">
                <div>
                  <p className="eyebrow">
                    {new Intl.DateTimeFormat(
                      locale === "zh" ? "zh-CN" : "en-US",
                      {
                        timeZone: state.settings.timezone,
                        month: "long",
                        day: "numeric",
                        weekday: "long",
                      },
                    ).format(new Date(now))}
                  </p>
                  <h1 className="page-title">
                    {t("今天，从一小步开始。", "A little progress, today.")}
                  </h1>
                  <p className="page-subtitle">
                    {t(
                      "不用一次改变所有事。一条国策，也是在向前。",
                      "You don’t have to change everything. One small rule is a step forward.",
                    )}
                  </p>
                </div>
                <button className="button primary" onClick={newPolicy}>
                  <Plus size={18} />
                  {t("新建国策", "New policy")}
                </button>
              </div>
              <div className="stats-grid">
                <Stat
                  icon={Sun}
                  label={t("今日点亮", "Today’s activation")}
                  value={`${todayActivation ? "1" : "0"} / 1`}
                  note={t(
                    "每天最多一条，不必每天完成",
                    "At most one. No daily obligation.",
                  )}
                />
                <Stat
                  icon={GitBranch}
                  label={t("正在生效", "Active policies")}
                  value={String(active.length).padStart(2, "0")}
                  note={t(
                    "正在长成你的日常",
                    "Small rules becoming your routine",
                  )}
                />
                <Stat
                  icon={BookOpen}
                  label={t("待选储备", "Ready in your library")}
                  value={String(readyPolicies.length).padStart(2, "0")}
                  note={
                    readyPolicies.length < 5
                      ? t("少于 5 条，记得补充", "Below 5 — time to replenish")
                      : t(
                          "储备充足，安心执行",
                          "Well prepared for the days ahead",
                        )
                  }
                />
              </div>
              <div className="dashboard-grid">
                <div className="main-column">
                  <section className="card trial-card">
                    <div className="card-header">
                      <h2 className="section-title">
                        <Sun size={19} />
                        {t("今日尝试", "Today’s trial")}
                      </h2>
                      <span className="section-caption">
                        {t(
                          "一次，只专注一条",
                          "One rule. Your full attention.",
                        )}
                      </span>
                    </div>
                    {todayActivation ? (
                      <div className="completion-content">
                        <span className="completion-icon">
                          <Check size={30} />
                        </span>
                        <p className="eyebrow">
                          {t(
                            "今天的改变，已经发生",
                            "A LITTLE CHANGE TOOK ROOT",
                          )}
                        </p>
                        <h2 className="trial-title">
                          {todayActivation.policyName}
                        </h2>
                        <p className="muted">
                          {t(
                            "今日点亮额度已使用。继续照顾已有的国策，也可以为明天补库。",
                            "Today’s activation is complete. Care for your active rules, or prepare for tomorrow.",
                          )}
                        </p>
                        <button
                          className="button secondary"
                          onClick={() => setPage("tree")}
                        >
                          {t("去看看我的树", "View my tree")}
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    ) : trial ? (
                      <div className="trial-content">
                        <div className="trial-top">
                          {badge(trial)}
                          <span className="meta-row">
                            <Circle size={13} />
                            {t("等待你的实践", "Ready for practice")}
                          </span>
                        </div>
                        <h2 className="trial-title">{trial.name}</h2>
                        <p className="rule-text">{trial.rule}</p>
                        <div className="meta-row">
                          <GitBranch size={15} />
                          {trial.suggestedParentId
                            ? (state.policies.find(
                                (p) => p.id === trial.suggestedParentId,
                              )?.name ??
                              t("请重新选择挂载位置", "Choose a new parent"))
                            : t("从一条新的分支开始", "Start a new branch")}
                        </div>
                        <div className="card-actions">
                          <button
                            className="button primary"
                            onClick={() =>
                              trial.trialDate !== today
                                ? void keepTrial(trial)
                                : setModal({ type: "activate", policy: trial })
                            }
                          >
                            <Sparkles size={17} />
                            {trial.trialDate !== today
                              ? t("沿用为今天的尝试", "Keep for today")
                              : t("我已做到，点亮国策", "I’ve done it — Activate")}
                          </button>
                          <button
                            className="button ghost"
                            onClick={() => setPage("library")}
                          >
                            <RefreshCw size={15} />
                            {t("换一条", "Choose another")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="empty-state">
                        <div className="empty-illustration">
                          <Sprout size={44} strokeWidth={1.3} />
                          <span className="orbit orbit-one" />
                          <span className="orbit orbit-two" />
                        </div>
                        <h2 className="empty-title">
                          {t(
                            "给今天选一个小小的改变",
                            "Choose a small change for today",
                          )}
                        </h2>
                        <p className="empty-description">
                          {t(
                            "从提前准备好的国策里选一条，做到之后再点亮。",
                            "Choose a policy you prepared earlier. Put it into practice, then activate it.",
                          )}
                        </p>
                        <button
                          className="button primary"
                          onClick={() =>
                            readyPolicies.length
                              ? setPage("library")
                              : newPolicy()
                          }
                        >
                          {readyPolicies.length
                            ? t("从国策库中选择", "Choose from the library")
                            : t(
                                "准备我的第一条国策",
                                "Prepare my first policy",
                              )}
                          <ArrowRight size={17} />
                        </button>
                      </div>
                    )}
                  </section>
                  <section className="card">
                    <div className="card-header">
                      <h2 className="section-title">
                        <ShieldCheck size={18} />
                        {t("正在生效", "Active policies")}
                        <span className="count-label">{active.length}</span>
                      </h2>
                      <button
                        className="text-button"
                        onClick={() => setPage("tree")}
                      >
                        {t("查看全部", "View all")}
                        <ArrowRight size={14} />
                      </button>
                    </div>
                    {active.length ? (
                      <div className="active-list">
                        {active.slice(0, 4).map((p) => (
                          <button
                            className="policy-row"
                            key={p.id}
                            onClick={() => openDetail(p)}
                          >
                            <span className="policy-dot" />
                            <span className="policy-row-main">
                              <span className="policy-row-title">{p.name}</span>
                              <span className="policy-row-rule">{p.rule}</span>
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="quiet-empty">
                        <Leaf size={22} />
                        <p>
                          {t(
                            "你的树正在等待第一片新叶。",
                            "Your tree is waiting for its first new leaf.",
                          )}
                        </p>
                      </div>
                    )}
                  </section>
                </div>
                <div className="side-column">
                  {state.settings.inventoryReminders &&
                    readyPolicies.length < 5 && (
                      <section className="inventory-card">
                        <div className="inventory-heading">
                          <span>
                            <BookOpen size={19} />
                            {t(
                              "给未来的自己，一点准备",
                              "A little preparation for later",
                            )}
                          </span>
                          <span className="status-badge trial">
                            {t("补库提醒", "Replenish")}
                          </span>
                        </div>
                        <h3>
                          {t(
                            `待选还有 ${readyPolicies.length} 条`,
                            `${readyPolicies.length} policies ready`,
                          )}
                        </h3>
                        <p>
                          {t(
                            "有空时多准备几条，忙碌时只需要选一条。",
                            "Prepare a few rules when you have time. On busy days, just choose one.",
                          )}
                        </p>
                        <div className="inventory-dots">
                          {Array.from({ length: 5 }, (_, i) => (
                            <span
                              key={i}
                              className={`inventory-dot ${i < readyPolicies.length ? "filled" : ""}`}
                            />
                          ))}
                        </div>
                        <button
                          className="button secondary full"
                          onClick={newPolicy}
                        >
                          <Plus size={16} />
                          {t("补充国策库", "Replenish library")}
                        </button>
                      </section>
                    )}
                  <section className="card tip-card">
                    <span className="tip-icon">
                      <Lightbulb size={20} />
                    </span>
                    <p className="eyebrow">
                      {t("给自己的一点提醒", "A GENTLE REMINDER")}
                    </p>
                    <h3>
                      {t("稳定，比完美更重要。", "Consistency grows slowly.")}
                    </h3>
                    <p>
                      {t(
                        "未记录不等于失败。遇到违反，记录原因、调整规则，再重新开始。",
                        "An unrecorded day isn’t a failure. When a rule breaks, reflect, adjust, and try again.",
                      )}
                    </p>
                    <div className="tip-divider" />
                    <span className="meta-row">
                      <Leaf size={14} />{" "}
                      {t("让规则适合生活", "Make rules that fit your life")}
                    </span>
                  </section>
                  {installHint && (
                    <section className="card install-card">
                      <button
                        className="icon-button dismiss-install"
                        aria-label={t(
                          "关闭安装提示",
                          "Dismiss installation hint",
                        )}
                        onClick={() => {
                          setInstallHint(false);
                          try {
                            localStorage.setItem(
                              "policy-tree-install-dismissed",
                              "1",
                            );
                          } catch {}
                        }}
                      >
                        <X size={15} />
                      </button>
                      <div className="meta-row">
                        <ArrowDownToLine size={19} />
                        <h3>{t("把国策树放在手边", "Keep your tree close")}</h3>
                      </div>
                      <p className="muted">
                        {t(
                          "添加到主屏幕，下次一触即达。",
                          "Add to your Home Screen for a quicker return.",
                        )}
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setModal({ type: "install" })}
                      >
                        {t("查看安装方法", "How to install")}
                        <ArrowRight size={14} />
                      </button>
                    </section>
                  )}
                </div>
              </div>
            </>
          )}
          {page === "library" && (
            <Library
              state={state}
              locale={locale}
              newPolicy={newPolicy}
              choose={choose}
              edit={(p) => void editCandidate(p)}
              detail={openDetail}
            />
          )}
          {page === "tree" && (
            <Tree
              state={state}
              locale={locale}
              detail={openDetail}
              violate={(p) => setModal({ type: "violate", policy: p })}
              reflect={(p) => setModal({ type: "reflect", policy: p })}
              goLibrary={() => setPage("library")}
            />
          )}
          {page === "history" && (
            <HistoryView
              state={state}
              locale={locale}
              reflect={(p) => setModal({ type: "reflect", policy: p })}
            />
          )}
          {page === "settings" && (
            <>
              <div className="page-header">
                <div>
                  <p className="eyebrow">YOUR SPACE, YOUR PACE</p>
                  <h1 className="page-title">
                    {t("让工具适合你", "Make it yours")}
                  </h1>
                  <p className="page-subtitle">
                    {t(
                      "免登录，记录保存在本机。定期备份，让改变安心留存。",
                      "No sign-in. Records stay on this device. Export backups to keep them safe.",
                    )}
                  </p>
                </div>
              </div>
              <div className="settings-grid">
                <section className="card settings-section">
                  <h2 className="section-title">
                    <Settings size={18} />
                    {t("偏好设置", "Preferences")}
                  </h2>
                  <div className="settings-row">
                    <label htmlFor="language">
                      {t("界面语言", "Language")}
                    </label>
                    <select
                      id="language"
                      className="select language-select"
                      value={locale}
                      onChange={(e) =>
                        void act("settings", undefined, {
                          locale: e.target.value,
                        })
                      }
                    >
                      <option value="zh">简体中文</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <span>{t("每日边界", "Daily boundary")}</span>
                    <span className="muted">
                      {state.settings.timezone} · 00:00
                    </span>
                  </div>
                  <p className="field-help">
                    {t(
                      "使用固定时区划分每天，旅行时也按这个边界计算。",
                      "A fixed time zone defines each day, including while travelling.",
                    )}
                  </p>
                  <label className="settings-row checkbox-row">
                    <span>
                      {t(
                        "国策库少于 5 条时提示",
                        "Show low-inventory prompts below 5",
                      )}
                    </span>
                    <input
                      type="checkbox"
                      checked={state.settings.inventoryReminders}
                      onChange={(e) =>
                        void act("settings", undefined, {
                          inventoryReminders: e.target.checked,
                        })
                      }
                    />
                  </label>
                  <button
                    className="button secondary"
                    onClick={() => setModal({ type: "install" })}
                  >
                    <ArrowDownToLine size={16} />
                    {t("安装到主屏幕", "Add to Home Screen")}
                  </button>
                </section>
                <section className="card settings-section">
                  <h2 className="section-title">
                    <HardDrive size={18} />
                    {t("本机数据与备份", "Local data and backups")}
                  </h2>
                  <div className="settings-row">
                    <span>{t("存储位置", "Storage")}</span>
                    <span className="muted">{t("当前设备 · 当前浏览器", "This device · this browser")}</span>
                  </div>
                  <div className="settings-row">
                    <span>{t("上次保存", "Last saved")}</span>
                    <span className="muted">
                      {lastSaved ? fmtDate(lastSaved, locale, state.settings.timezone, true) : t("暂无记录", "No saved records yet")}
                    </span>
                  </div>
                  <p className="muted">
                    {t(
                      "不需要账号，也不会自动同步到其他设备。清除网站数据、使用无痕浏览或系统清理都可能让记录丢失。",
                      "No account is required. Records do not sync to other devices. Clearing website data, private browsing, or system cleanup can remove them.",
                    )}
                  </p>
                  <div className="backup-actions">
                    <button
                      className="button secondary"
                      disabled={exporting}
                      onClick={async () => {
                        setExporting(true);
                        try {
                          const result = await exportBackup(state, today);
                          if (result === "shared") setToast(t("已完成系统分享，请确认备份已保存到“文件”", "Sharing complete. Check that the backup was saved to Files."));
                          if (result === "downloaded") setToast(t("备份下载已开始，请确认文件已保存", "Backup download started. Check that the file was saved."));
                        } catch {
                          setToast(t("导出未完成，请重试并选择“存储到文件”", "Export did not complete. Try again and choose Save to Files."));
                        } finally {
                          setExporting(false);
                        }
                      }}
                    >
                      {exporting ? <Loader2 size={16} className="spin" /> : <ArrowDownToLine size={16} />}
                      {t("导出备份", "Export backup")}
                    </button>
                    <ImportButton
                      locale={locale}
                      importState={async (s) => act("import", undefined, { state: s }, t("备份已合并并保存到本机", "Backup merged and saved on this device"))}
                    />
                  </div>
                  <div className="settings-row">
                    <span>{t("离线使用", "Offline use")}</span>
                    <span>{offlineReady ? t("已准备好", "Ready") : t("缓存尚未准备好，请保持联网后重新打开", "Not ready yet; stay online and reopen")}</span>
                  </div>
                  <p className="field-help">
                    {t(
                      "iPhone 导出时可在分享菜单选择“存储到文件”。建议每周备份一次，存到 iCloud 云盘或其他安全位置。换设备时手动导入；同 ID 国策保留本机版本。",
                      "On iPhone, choose Save to Files in the share sheet. Back up weekly to iCloud Drive or another safe location. Import manually on a new device; existing policy IDs keep their current local version.",
                    )}
                  </p>
                  <p className="field-help">
                    {t(
                      "旧网页版备份可以导入已记录的状态；旧提醒和未确认操作不会自动执行。Safari 网页与主屏幕 App 的存储也可能独立，请在实际使用的入口检查记录。",
                      "Older web backups can import their recorded state. Old reminders and unconfirmed operations are not executed. Safari and a Home Screen app may have separate storage; check records in the entry point you use.",
                    )}
                  </p>
                </section>
                <section className="card settings-section">
                  <h2 className="section-title">
                    <Sprout size={18} />
                    {t("关于国策树", "About Policy Tree")}
                  </h2>
                  <p className="muted">
                    {t(
                      "每天最多点亮一条，可以留白。父节点违反时，后代连带退回；已有记录会一直保留。",
                      "Activate at most one policy a day; taking a day off is fine. A violation returns its descendants too, while history is retained.",
                    )}
                  </p>
                  <p className="field-help">
                    PWA · v0.3 · {t("个人使用", "Personal use")}
                  </p>
                </section>
              </div>
            </>
          )}
        </main>
        <footer className="page-footer">
          <span>
            <Leaf size={13} />{" "}
            {t("每天一条，让改变慢慢生长。", "Small rules. Steady growth.")}
          </span>
          <span>POLICY TREE</span>
        </footer>
      </div>
      <nav
        className="mobile-nav"
        aria-label={t("移动端导航", "Mobile navigation")}
      >
        {navItems.map((n) => (
          <button
            key={n.id}
            className={page === n.id ? "active" : ""}
            onClick={() => navigate(n.id)}
          >
            <n.icon size={21} />
            <span>{t(n.cn, n.en)}</span>
          </button>
        ))}
      </nav>
      {modal && (
        <Modal
          title={
            modal.type === "edit"
              ? t(
                  modal.policy ? "编辑国策" : "新建国策",
                  modal.policy ? "Edit policy" : "New policy",
                )
              : modal.type === "activate"
                ? t("让这条国策生效", "Activate your policy")
                : modal.type === "violate"
                  ? t("记录违反，准备重新出发", "Record a violation")
                  : modal.type === "reflect"
                    ? t("留下一点复盘", "A moment to reflect")
                    : modal.type === "install"
                      ? t("让国策树随手可达", "Keep your tree close")
                      : (modal.policy?.name ?? "")
          }
          close={() => setModal(null)}
        >
          {modal.type === "edit" && (
            <Editor
              key={modal.policy?.id ?? "new"}
              policy={modal.policy}
              state={state}
              locale={locale}
              submit={submit}
              close={() => setModal(null)}
              notify={setToast}
            />
          )}
          {modal.type === "activate" && modal.policy && (
            <ActivateForm
              policy={modal.policy}
              state={state}
              locale={locale}
              close={() => setModal(null)}
              activate={async (parentId) => {
                if (
                  await act(
                    "activate",
                    modal.policy!.id,
                    { parentId },
                    t(
                      "国策已点亮并保存到本机",
                      "Policy activated and saved on this device",
                    ),
                  )
                )
                  setModal(null);
              }}
            />
          )}
          {modal.type === "violate" && modal.policy && (
            <ViolationForm
              policy={modal.policy}
              state={state}
              locale={locale}
              close={() => setModal(null)}
              confirm={async (note) => {
                if (
                  await act(
                    "violate",
                    modal.policy!.id,
                    { note },
                    t(
                      "记录已保存，可以慢慢重新开始",
                      "Recorded. You can start again at your own pace.",
                    ),
                  )
                )
                  setModal(null);
              }}
            />
          )}
          {modal.type === "reflect" && modal.policy && (
            <ReflectionForm
              locale={locale}
              confirm={async (note) => {
                if (
                  await act(
                    "reflect",
                    modal.policy!.id,
                    { note },
                    t("复盘已保存", "Reflection saved"),
                  )
                )
                  setModal(null);
              }}
            />
          )}
          {modal.type === "detail" && modal.policy && (
            <PolicyDetail
              policy={
                state.policies.find((p) => p.id === modal.policy!.id) ??
                modal.policy
              }
              state={state}
              locale={locale}
              edit={(p) => void editCandidate(p)}
              violate={(p) => setModal({ type: "violate", policy: p })}
              reflect={(p) => setModal({ type: "reflect", policy: p })}
              restore={(p) =>
                void act(
                  "restore",
                  p.id,
                  {},
                  t("已重新加入待选库", "Returned to Ready"),
                )
              }
              choose={choose}
            />
          )}
          {modal.type === "install" && <InstallGuide locale={locale} />}
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label={t("关闭提示", "Dismiss message")}
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-head">
        <span className="stat-label">{label}</span>
        <span className="stat-icon">
          <Icon size={19} />
        </span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">{note}</div>
    </div>
  );
}

function Library({
  state,
  locale,
  newPolicy,
  choose,
  edit,
  detail,
}: {
  state: PolicyState;
  locale: Locale;
  newPolicy: () => void;
  choose: (p: Policy) => void;
  edit: (p: Policy) => void;
  detail: (p: Policy) => void;
}) {
  const t = (c: string, e: string) => (locale === "zh" ? c : e);
  const [tab, setTab] = useState<PolicyStatus>("ready");
  const [query, setQuery] = useState("");
  const visible = state.policies.filter(
    (p) =>
      p.status === tab &&
      `${p.name} ${p.rule}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">PREPARE TODAY, THANK YOURSELF TOMORROW</p>
          <h1 className="page-title">
            {t("把好想法，提前存下来。", "Keep tomorrow’s ideas ready.")}
          </h1>
          <p className="page-subtitle">
            {t(
              "有空的时候多准备，忙碌的时候少犹豫。",
              "Prepare when you have time. Choose with ease when you don’t.",
            )}
          </p>
        </div>
        <button className="button primary" onClick={newPolicy}>
          <Plus size={18} />
          {t("新建国策", "New policy")}
        </button>
      </div>
      <div className="library-toolbar">
        <div
          className="tabs"
          role="tablist"
          aria-label={t("国策状态", "Policy state")}
        >
          {(["ready", "draft", "returned"] as PolicyStatus[]).map((s) => (
            <button
              role="tab"
              aria-selected={tab === s}
              key={s}
              className={`tab ${tab === s ? "active" : ""}`}
              onClick={() => setTab(s)}
            >
              {statusText[s][locale === "zh" ? 0 : 1]}
              <span>{state.policies.filter((p) => p.status === s).length}</span>
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label={t("搜索国策", "Search policies")}
            placeholder={t("搜索名称或规则…", "Search names or rules…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {visible.length ? (
        <div className="policy-grid">
          {visible.map((p, i) => (
            <article key={p.id} className="card policy-card">
              <div className="policy-card-top">
                <span className="policy-index">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={`status-badge ${p.status}`}>
                  {p.status === "returned"
                    ? p.returnKind === "direct"
                      ? t("自身违反", "Direct violation")
                      : t("连带退回", "Dependent return")
                    : statusText[p.status][locale === "zh" ? 0 : 1]}
                </span>
              </div>
              <button className="policy-card-title" onClick={() => detail(p)}>
                {p.name || t("未命名草稿", "Untitled draft")}
              </button>
              <p className="policy-card-rule">
                {p.rule ||
                  t(
                    "把想法先记下来，稍后完善。",
                    "Capture the idea now, complete it later.",
                  )}
              </p>
              <div className="policy-card-footer">
                <button className="text-button" onClick={() => edit(p)}>
                  {t(
                    p.status === "returned" ? "调整后重新加入" : "编辑",
                    p.status === "returned" ? "Revise & prepare" : "Edit",
                  )}
                </button>
                {p.status === "ready" ? (
                  <button
                    className="button secondary small"
                    onClick={() => choose(p)}
                  >
                    {t("选为今日尝试", "Choose for today")}
                    <ArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    className="icon-button"
                    aria-label={t("查看详情", "View details")}
                    onClick={() => detail(p)}
                  >
                    <ChevronRight size={18} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="card library-empty empty-state">
          <BookOpen size={42} strokeWidth={1.3} />
          <h2 className="empty-title">
            {query
              ? t("没有找到这条国策", "No matching policies")
              : tab === "ready"
                ? t(
                    "为下一次改变，做点准备",
                    "Prepare for your next small change",
                  )
                : tab === "draft"
                  ? t("暂时没有未完成的想法", "No unfinished ideas")
                  : t("这里会留住重新开始的机会", "Room for another beginning")}
          </h2>
          <p className="empty-description">
            {t(
              "名称和一段规则就够了，不必写得完美。",
              "A name and a rule are enough. They don’t have to be perfect.",
            )}
          </p>
          <button className="button primary" onClick={newPolicy}>
            <Plus size={16} />
            {t("新建国策", "New policy")}
          </button>
        </div>
      )}
    </>
  );
}

function Tree({
  state,
  locale,
  detail,
  violate,
  reflect,
  goLibrary,
}: {
  state: PolicyState;
  locale: Locale;
  detail: (p: Policy) => void;
  violate: (p: Policy) => void;
  reflect: (p: Policy) => void;
  goLibrary: () => void;
}) {
  const t = (c: string, e: string) => (locale === "zh" ? c : e);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; sx: number; sy: number } | null>(
    null,
  );
  const active = state.policies.filter((p) => p.status === "active");
  const trial = state.policies.find((p) => p.status === "trial");
  const nodes = [
    ...active,
    ...(trial
      ? [
          {
            ...trial,
            parentId: trial.suggestedParentId,
          },
        ]
      : []),
  ];
  const positions = useMemo(() => {
    const result: {
      policy: Policy;
      x: number;
      y: number;
      parentId: string | null;
    }[] = [];
    let leaf = 0;
    const visited = new Set<string>();
    function visit(p: Policy, depth: number): number {
      if (visited.has(p.id)) return 0;
      visited.add(p.id);
      const children = collapsed.includes(p.id)
        ? []
        : nodes.filter((n) => n.parentId === p.id);
      const childXs = children.map((c) => visit(c, depth + 1));
      const x = childXs.length
        ? childXs.reduce((a, b) => a + b, 0) / childXs.length
        : leaf++ * 250 + 32;
      result.push({ policy: p, x, y: depth * 150 + 45, parentId: p.parentId });
      return x;
    }
    nodes
      .filter((p) => !p.parentId || !nodes.some((n) => n.id === p.parentId))
      .forEach((p) => visit(p, 0));
    return result;
  }, [state.policies, collapsed]);
  const width = Math.max(680, ...positions.map((p) => p.x + 260));
  const height = Math.max(420, ...positions.map((p) => p.y + 140));
  const selectedPolicy =
    state.policies.find((p) => p.id === selected) ?? active[0] ?? trial;
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">SMALL RULES, STRONG ROOTS</p>
          <h1 className="page-title">
            {t("每一条，都有生长的方向。", "Watch your small changes grow.")}
          </h1>
          <p className="page-subtitle">
            {t(
              "父子连线表示退回依赖。选中节点，看看规则和历程。",
              "Connections show return dependencies. Select a policy to explore its rule and history.",
            )}
          </p>
        </div>
        <button className="button secondary" onClick={goLibrary}>
          <BookOpen size={17} />
          {t("去国策库", "Open library")}
        </button>
      </div>
      {nodes.length ? (
        <div className="tree-layout">
          <section className="card tree-canvas">
            <div className="tree-toolbar">
              <span className="meta-row">
                <span className="policy-dot" />
                {t(`生效 ${active.length} 条`, `${active.length} active`)}
                {trial && (
                  <span>· {t("虚线为今日尝试", "Dashed = today’s trial")}</span>
                )}
              </span>
              <div>
                <button
                  className="icon-button"
                  aria-label={t("缩小", "Zoom out")}
                  onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
                >
                  <ZoomOut size={17} />
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setZoom(1);
                    viewport.current?.scrollTo({
                      left: 0,
                      top: 0,
                      behavior: "smooth",
                    });
                  }}
                >
                  {" "}
                  {Math.round(zoom * 100)}%{" "}
                </button>
                <button
                  className="icon-button"
                  aria-label={t("放大", "Zoom in")}
                  onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}
                >
                  <ZoomIn size={17} />
                </button>
              </div>
            </div>
            <div
              className="tree-viewport"
              ref={viewport}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                drag.current = {
                  x: e.clientX,
                  y: e.clientY,
                  sx: e.currentTarget.scrollLeft,
                  sy: e.currentTarget.scrollTop,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (drag.current) {
                  e.currentTarget.scrollLeft =
                    drag.current.sx - (e.clientX - drag.current.x);
                  e.currentTarget.scrollTop =
                    drag.current.sy - (e.clientY - drag.current.y);
                }
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              <div style={{ width: width * zoom, height: height * zoom }}>
                <div
                  className="tree-world"
                  style={{
                    width,
                    height,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                >
                  <svg
                    className="tree-connector"
                    width={width}
                    height={height}
                    aria-hidden="true"
                  >
                    {positions.map((p) => {
                      const parent = positions.find(
                        (n) => n.policy.id === p.parentId,
                      );
                      if (!parent) return null;
                      return (
                        <path
                          key={p.policy.id}
                          d={`M ${parent.x + 105} ${parent.y + 88} C ${parent.x + 105} ${parent.y + 119}, ${p.x + 105} ${p.y - 31}, ${p.x + 105} ${p.y}`}
                          fill="none"
                          stroke={
                            p.policy.status === "trial" ? "#a1b9a3" : "#a9bfaf"
                          }
                          strokeWidth="2"
                          strokeDasharray={
                            p.policy.status === "trial" ? "6 5" : undefined
                          }
                        />
                      );
                    })}
                  </svg>
                  {positions.map((p) => (
                    <div
                      key={p.policy.id}
                      className="tree-node-wrap"
                      style={{ position: "absolute", left: p.x, top: p.y }}
                    >
                      <button
                        className={`tree-node ${selectedPolicy?.id === p.policy.id ? "selected" : ""} ${p.policy.status === "trial" ? "trial" : ""}`}
                        onClick={() => setSelected(p.policy.id)}
                      >
                        <span className="tree-node-status">
                          <span className="policy-dot" />
                          {statusText[p.policy.status][locale === "zh" ? 0 : 1]}
                        </span>
                        <strong>{p.policy.name}</strong>
                      </button>
                      {nodes.some((n) => n.parentId === p.policy.id) && (
                        <button
                          className="branch-toggle"
                          aria-label={
                            collapsed.includes(p.policy.id)
                              ? t("展开分支", "Expand branch")
                              : t("折叠分支", "Collapse branch")
                          }
                          onClick={() =>
                            setCollapsed((ids) =>
                              ids.includes(p.policy.id)
                                ? ids.filter((id) => id !== p.policy.id)
                                : [...ids, p.policy.id],
                            )
                          }
                        >
                          {collapsed.includes(p.policy.id) ? (
                            <Plus size={12} />
                          ) : (
                            <ChevronDown size={12} />
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="tree-caption">
              {t(
                "拖动画布或滚动浏览 · 点击百分比复位",
                "Drag or scroll to explore · Click percentage to reset",
              )}
            </div>
          </section>
          <aside className="card tree-detail">
            {selectedPolicy && (
              <>
                <div className="card-header">
                  <h2 className="section-title">
                    {t("国策详情", "Policy details")}
                  </h2>
                  <span className={`status-badge ${selectedPolicy.status}`}>
                    {statusText[selectedPolicy.status][locale === "zh" ? 0 : 1]}
                  </span>
                </div>
                <h2 className="detail-title">{selectedPolicy.name}</h2>
                <p className="rule-text">{selectedPolicy.rule}</p>
                <div className="detail-divider" />
                <p className="detail-label">{t("父节点", "Parent policy")}</p>
                <p className="detail-value">
                  {state.policies.find(
                    (p) =>
                      p.id ===
                      (selectedPolicy.status === "trial"
                        ? selectedPolicy.suggestedParentId
                        : selectedPolicy.parentId),
                  )?.name ?? t("顶层分支", "Top-level branch")}
                </p>
                <p className="detail-label">{t("点亮日期", "Activated on")}</p>
                <p className="detail-value">
                  {selectedPolicy.activatedAt
                    ? fmtDate(
                        selectedPolicy.activatedAt,
                        locale,
                        state.settings.timezone,
                      )
                    : t("实践后再点亮", "Activate after practice")}
                </p>
                <p className="detail-label">
                  {t("依赖这条国策", "Dependent policies")}
                </p>
                <p className="detail-value">
                  {
                    descendants(state, selectedPolicy.id).filter(
                      (p) => p.status === "active",
                    ).length
                  }{" "}
                  {t("条", "policies")}
                </p>
                <div className="detail-actions">
                  <button
                    className="button secondary full"
                    onClick={() => detail(selectedPolicy)}
                  >
                    <History size={16} />
                    {t("查看完整历程", "View full history")}
                  </button>
                  {selectedPolicy.status === "active" && (
                    <>
                      <button
                        className="button ghost full"
                        onClick={() => reflect(selectedPolicy)}
                      >
                        <FileText size={16} />
                        {t("写一段复盘", "Write a reflection")}
                      </button>
                      <button
                        className="button danger full"
                        onClick={() => violate(selectedPolicy)}
                      >
                        <TriangleAlert size={16} />
                        {t("记录违反", "Record violation")}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      ) : (
        <div className="card empty-state tree-empty">
          <div className="empty-illustration">
            <Trees size={50} strokeWidth={1.2} />
          </div>
          <h2 className="empty-title">
            {t("你的国策树，会从这里生长。", "Your policy tree starts here.")}
          </h2>
          <p className="empty-description">
            {t(
              "先准备一条规则，选为今日尝试。成功实践后，点亮第一条分支。",
              "Prepare a rule and choose it for today. After putting it into practice, activate your first branch.",
            )}
          </p>
          <button className="button primary" onClick={goLibrary}>
            {t("准备一条国策", "Prepare a policy")}
            <ArrowRight size={16} />
          </button>
        </div>
      )}
    </>
  );
}

const eventLabels: Record<HistoryEvent["type"], [string, string]> = {
  created: ["准备了新国策", "Prepared a policy"],
  edited: ["调整了国策", "Edited a policy"],
  chosen: ["选为今日尝试", "Chosen for today"],
  activated: ["点亮了国策", "Activated a policy"],
  violated: ["记录了自身违反", "Recorded a direct violation"],
  dependent_return: ["随祖先连带退回", "Returned with an ancestor"],
  restored: ["重新加入待选库", "Returned to the library"],
  reflection: ["写下了复盘", "Added a reflection"],
  imported: ["导入了备份", "Imported a backup"],
};
function HistoryView({
  state,
  locale,
  reflect,
}: {
  state: PolicyState;
  locale: Locale;
  reflect: (p: Policy) => void;
}) {
  const t = (c: string, e: string) => (locale === "zh" ? c : e);
  const [filter, setFilter] = useState("all");
  const [policyId, setPolicyId] = useState("");
  const events = state.events
    .filter(
      (e) =>
        (filter === "all" ||
          (filter === "returns" &&
            ["violated", "dependent_return"].includes(e.type)) ||
          e.type === filter) &&
        (!policyId || e.policyId === policyId),
    )
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at));
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">EVERY ATTEMPT TELLS YOU SOMETHING</p>
          <h1 className="page-title">
            {t("走过的每一步，都算数。", "Every attempt has a story.")}
          </h1>
          <p className="page-subtitle">
            {t(
              "在记录里找到更适合自己的规则，失败也能成为线索。",
              "Look for rules that fit you better. A setback can be a useful clue.",
            )}
          </p>
        </div>
      </div>
      <div className="library-toolbar">
        <div className="tabs">
          {[
            ["all", "全部", "All"],
            ["activated", "点亮", "Activations"],
            ["returns", "退回", "Returns"],
            ["reflection", "复盘", "Reflections"],
          ].map(([v, c, e]) => (
            <button
              key={v}
              className={`tab ${filter === v ? "active" : ""}`}
              onClick={() => setFilter(v)}
            >
              {t(c, e)}
            </button>
          ))}
        </div>
        <select
          className="select"
          aria-label={t("筛选国策", "Filter by policy")}
          value={policyId}
          onChange={(e) => setPolicyId(e.target.value)}
        >
          <option value="">{t("所有国策", "All policies")}</option>
          {state.policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || t("未命名草稿", "Untitled draft")}
            </option>
          ))}
        </select>
      </div>
      <section className="card history-list">
        {events.length ? (
          events.map((e, i) => (
            <div className="history-entry" key={e.id}>
              {(i === 0 ||
                dayKey(events[i - 1].at, state.settings.timezone) !==
                  dayKey(e.at, state.settings.timezone)) && (
                <h3 className="history-group">
                  {fmtDate(e.at, locale, state.settings.timezone)}
                </h3>
              )}
              <div className="history-item">
                <span className={`history-icon ${e.type}`}>
                  {e.type === "activated" ? (
                    <Sparkles size={18} />
                  ) : ["violated", "dependent_return"].includes(e.type) ? (
                    <GitBranch size={18} />
                  ) : e.type === "reflection" ? (
                    <FileText size={18} />
                  ) : (
                    <Leaf size={18} />
                  )}
                </span>
                <div className="history-main">
                  <p className="history-title">
                    {eventLabels[e.type][locale === "zh" ? 0 : 1]}{" "}
                    <strong>{e.policyName}</strong>
                  </p>
                  {e.note && <p className="history-note">{e.note}</p>}
                  {e.type === "activated" && (
                    <p className="field-help">
                      {t("当时的父节点：", "Parent at the time: ")}
                      {state.policies.find((p) => p.id === e.parentId)?.name ??
                        t("顶层分支", "Top-level branch")}
                    </p>
                  )}
                </div>
                <time className="history-date">
                  {new Intl.DateTimeFormat(
                    locale === "zh" ? "zh-CN" : "en-US",
                    {
                      timeZone: state.settings.timezone,
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  ).format(new Date(e.at))}
                </time>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <History size={38} strokeWidth={1.3} />
            <h2 className="empty-title">
              {t(
                "每个开始，都值得记录。",
                "Every beginning is worth remembering.",
              )}
            </h2>
            <p className="empty-description">
              {t(
                "点亮、退回和复盘会出现在这里。",
                "Your activations, returns, and reflections will appear here.",
              )}
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    (
      ref.current?.querySelector(
        "input:not([type=checkbox]),textarea,select",
      ) as HTMLElement | null
    )?.focus();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current!.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-header">
        <h2 className="modal-title" id="modal-title">
          {title}
        </h2>
        <button
          className="icon-button"
          aria-label="关闭 · Close"
          onClick={close}
        >
          <X size={21} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

function Editor({
  policy,
  state,
  locale,
  submit,
  close,
  notify,
}: {
  policy?: Policy;
  state: PolicyState;
  locale: Locale;
  submit: (
    type: Operation["type"],
    id?: string,
    payload?: Record<string, unknown>,
  ) => Promise<boolean>;
  close: () => void;
  notify: (s: string) => void;
}) {
  const t = (c: string, e: string) => (locale === "zh" ? c : e);
  const [id] = useState(policy?.id ?? uid());
  const [name, setName] = useState(policy?.name ?? "");
  const [rule, setRule] = useState(policy?.rule ?? "");
  const [parent, setParent] = useState(policy?.suggestedParentId ?? "");
  const [saving, setSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [error, setError] = useState("");
  const [template, setTemplate] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ name, rule, parent });
  latest.current = { name, rule, parent };
  const didSave = useRef(false);
  const canAuto = !policy || policy.status === "draft";
  const saveDraft = useRef(async () => {});
  saveDraft.current = async () => {
    const v = latest.current;
    if (
      canAuto &&
      !didSave.current &&
      (policy?.id || v.name.trim() || v.rule.trim())
    ) {
      const ok = await submit("save", id, {
        name: v.name,
        rule: v.rule,
        status: "draft",
        suggestedParentId: v.parent || null,
        reminderTime: "",
      });
      if (ok) setDraftSaved(true);
    }
  };
  useEffect(() => {
    if (canAuto && (policy?.id || name || rule)) {
      timer.current = setTimeout(() => void saveDraft.current(), 900);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [name, rule, parent, canAuto]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void saveDraft.current();
    },
    [],
  );
  async function save() {
    if (!name.trim() || !rule.trim()) {
      setError(
        t(
          "请填写名称和规则；未完成内容会保留为草稿。",
          "Enter a name and a rule. Incomplete content remains a draft.",
        ),
      );
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setSaving(true);
    const ok = await submit("save", id, {
      name,
      rule,
      status: "ready",
      suggestedParentId: parent || null,
      reminderTime: "",
    });
    setSaving(false);
    if (ok) {
      didSave.current = true;
      notify(t("已保存到国策库", "Saved to the library"));
      close();
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="muted">
        {t(
          "一个名称，一段规则。先写下来，之后可以慢慢调整。",
          "A name and a rule. Capture it now; refine it as you go.",
        )}
      </p>
      <div className="field">
        <label className="field-label" htmlFor="policy-name">
          {t("名称", "Name")} <span>*</span>
        </label>
        <input
          id="policy-name"
          className="input"
          maxLength={120}
          autoFocus
          placeholder={t(
            "例如：饭后及时洗碗",
            "e.g. Wash the dishes after dinner",
          )}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDraftSaved(false);
          }}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="policy-rule">
          {t("规则", "Rule")} <span>*</span>
        </label>
        <textarea
          id="policy-rule"
          className="textarea"
          maxLength={10000}
          rows={5}
          placeholder={t(
            "写清什么时候、做什么；需要的话，也可以写下例外。",
            "When does it apply, and what will you do? Include exceptions if useful.",
          )}
          value={rule}
          onChange={(e) => {
            setRule(e.target.value);
            setDraftSaved(false);
          }}
        />
      </div>
      <div className="template-actions">
        <span className="field-help">
          {t("需要一点灵感？", "Need a starting point?")}
        </span>
        <button
          type="button"
          className="button ghost small"
          onClick={() =>
            setTemplate(
              t(
                "当【某件事发生】后，我会在【时间范围】内完成【具体动作】。",
                "After [an event], I will complete [an action] within [a time limit].",
              ),
            )
          }
        >
          {t("事件发生后", "After an event")}
        </button>
        <button
          type="button"
          className="button ghost small"
          onClick={() =>
            setTemplate(
              t(
                "在【适用场景或时间段】内，不进行【具体行为】。",
                "During [a situation or time period], I will not [perform a behavior].",
              ),
            )
          }
        >
          {t("限制某种行为", "Limit a behavior")}
        </button>
      </div>
      {template && (
        <div className="notice">
          <p>{template}</p>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setRule((s) => s + (s ? "\n" : "") + template);
              setTemplate("");
            }}
          >
            {t("追加到规则", "Append to rule")}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t("关闭模板", "Dismiss template")}
            onClick={() => setTemplate("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <details className="optional-settings">
        <summary>
          {t("挂载位置（可选）", "Tree position (optional)")}
        </summary>
        <div className="field">
          <label htmlFor="suggested-parent" className="field-label">
            {t("建议父节点", "Suggested parent")}
          </label>
          <select
            id="suggested-parent"
            className="select"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
          >
            <option value="">
              {t("新建顶层分支", "New top-level branch")}
            </option>
            {state.policies
              .filter((p) => p.status === "active" && p.id !== id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <p className="field-help">
            {t(
              "父节点退回时，这条国策也会退回。正式点亮时可以再确认。",
              "If the parent returns, this policy returns too. Confirm the position at activation.",
            )}
          </p>
        </div>
      </details>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <span className="field-help">
          {canAuto
            ? draftSaved
              ? t("草稿已保存到本机", "Draft saved locally")
              : t("输入后自动保存草稿", "Drafts save automatically")
            : t("更改后点击保存", "Save to apply changes")}
        </span>
        <button type="submit" disabled={saving} className="button primary">
          {saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}{" "}
          {t("加入国策库", "Save to library")}
        </button>
      </div>
    </form>
  );
}

function ActivateForm({
  policy,
  state,
  locale,
  close,
  activate,
}: {
  policy: Policy;
  state: PolicyState;
  locale: Locale;
  close: () => void;
  activate: (parentId: string | null) => void;
}) {
  const t = (c: string, e: string) => (locale === "zh" ? c : e);
  const [parent, setParent] = useState(
    state.policies.some(
      (p) => p.id === policy.suggestedParentId && p.status === "active",
    )
      ? (policy.suggestedParentId ?? "")
      : "",
  );
  const [checked, setChecked] = useState(false);
  return (
    <>
      <p className="eyebrow">
        {t("从实践，走向长期的承诺", "FROM PRACTICE TO A LASTING COMMITMENT")}
      </p>
      <h3 className="detail-title">{policy.name}</h3>
      <p className="rule-text">{policy.rule}</p>
      <div className="field">
        <label className="field-label" htmlFor="activation-parent">
          {t("挂载位置", "Tree position")}
        </label>
        <select
          id="activation-parent"
          className="select"
          value={parent}
          onChange={(e) => setParent(e.target.value)}
        >
          <option value="">{t("新建顶层分支", "New top-level branch")}</option>
          {state.policies
            .filter((p) => p.status === "active")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <p className="field-help">
          {parent
            ? t(
                "这个父节点退回时，本条国策也会随之退回。",
                "If this parent returns, this policy returns too.",
              )
            : t(
                "这是一条独立的顶层分支。",
                "This will be an independent top-level branch.",
              )}
        </p>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>
          {t(
            "我已经按这条规则完成了实践。",
            "I have successfully put this rule into practice.",
          )}
        </span>
      </label>
      <p className="field-help">
        {t(
          "每天最多点亮一条，确认后立即保存到本机。今天不点亮也没关系。",
          "Activate at most one policy per day. Confirmation saves it on this device immediately. Taking today off is fine.",
        )}
      </p>
      <div className="modal-footer">
        <button className="button ghost" onClick={close}>
          {t("再等等", "Not yet")}
        </button>
        <button
          className="button primary"
          disabled={!checked}
          onClick={() => activate(parent || null)}
        >
          <Sparkles size={17} />
          {t("确认成功并点亮", "Confirm success & activate")}
        </button>
      </div>
    </>
  );
}
function ViolationForm({
  policy,
  state,
  locale,
  close,
  confirm,
}: {
  policy: Policy;
  state: PolicyState;
  locale: Locale;
  close: () => void;
  confirm: (note: string) => void;
}) {
  const t = (c: string, e: string) => (locale === "zh" ? c : e);
  const affected = descendants(state, policy.id).filter(
    (p) => p.status === "active",
  );
  const [note, setNote] = useState("");
  return (
    <>
      <p className="muted">
        {t(
          "这次发生了什么？记录下来，是为了找到更合适的下一步。",
          "What happened? Recording it helps you find a more sustainable next step.",
        )}
      </p>
      <div className="affected-list">
        <div className="affected-item">
          <TriangleAlert size={17} />
          <strong>{policy.name}</strong>
          <span className="status-badge returned">
            {t("自身违反", "Direct violation")}
          </span>
        </div>
        {affected.map((p) => (
          <div className="affected-item" key={p.id}>
            <GitBranch size={17} />
            <span>{p.name}</span>
            <span className="status-badge draft">
              {t("连带退回", "Dependent return")}
            </span>
          </div>
        ))}
      </div>
      <div className="notice warning">
        {t(
          `共 ${affected.length + 1} 条国策退出当前树。祖先与兄弟分支保留，全部历程保留。`,
          `${affected.length + 1} policies leave the current tree. Ancestors, siblings, and all history remain.`,
        )}
      </div>
      <div className="field">
        <label className="field-label" htmlFor="violation-note">
          {t("原因（可选）", "What happened? (optional)")}
        </label>
        <textarea
          id="violation-note"
          className="textarea"
          rows={3}
          maxLength={10000}
          placeholder={t(
            "规则太难？环境变化？把这次的线索留下来。",
            "Too demanding? A change of circumstances? Leave a clue for next time.",
          )}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="modal-footer">
        <button className="button ghost" onClick={close}>
          {t("取消", "Cancel")}
        </button>
        <button className="button danger" onClick={() => confirm(note)}>
          {t("确认记录并退回", "Record & return policies")}
        </button>
      </div>
    </>
  );
}
function ReflectionForm({
  locale,
  confirm,
}: {
  locale: Locale;
  confirm: (note: string) => void;
}) {
  const t = (c: string, e: string) => (locale === "zh" ? c : e);
  const [note, setNote] = useState("");
  return (
    <>
      <p className="muted">
        {t(
          "规则是否太难？需要拆小一点，还是换个父节点？",
          "Was the rule too demanding? Could it be smaller, or have a different parent?",
        )}
      </p>
      <label htmlFor="reflection" className="field-label">
        {t("自由记录", "Your thoughts")}
      </label>
      <textarea
        id="reflection"
        className="textarea"
        rows={6}
        maxLength={10000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        autoFocus
        placeholder={t(
          "不用完整的结论，一点发现就够了。",
          "No complete conclusion needed. A small observation is enough.",
        )}
      />
      <div className="modal-footer">
        <button
          className="button primary"
          disabled={!note.trim()}
          onClick={() => confirm(note)}
        >
          <Check size={17} />
          {t("保存复盘", "Save reflection")}
        </button>
      </div>
    </>
  );
}
function PolicyDetail({
  policy,
  state,
  locale,
  edit,
  violate,
  reflect,
  restore,
  choose,
}: {
  policy: Policy;
  state: PolicyState;
  locale: Locale;
  edit: (p: Policy) => void;
  violate: (p: Policy) => void;
  reflect: (p: Policy) => void;
  restore: (p: Policy) => void;
  choose: (p: Policy) => void;
}) {
  const t = (c: string, e: string) => (locale === "zh" ? c : e);
  const events = state.events
    .filter((e) => e.policyId === policy.id)
    .slice()
    .reverse();
  return (
    <>
      <span className={`status-badge ${policy.status}`}>
        {statusText[policy.status][locale === "zh" ? 0 : 1]}
      </span>
      <p className="rule-text">
        {policy.rule || t("规则尚未填写", "Rule not yet written")}
      </p>
      {policy.returnKind && (
        <div className="notice warning">
          {policy.returnKind === "direct"
            ? t(
                "上次因自身违反退回",
                "Previously returned after a direct violation",
              )
            : t("上次随祖先连带退回", "Previously returned with an ancestor")}
        </div>
      )}
      <div className="detail-actions">
        {policy.status === "active" ? (
          <>
            <button
              className="button secondary"
              onClick={() => reflect(policy)}
            >
              <FileText size={16} />
              {t("写复盘", "Reflect")}
            </button>
            <button className="button danger" onClick={() => violate(policy)}>
              {t("记录违反", "Record violation")}
            </button>
          </>
        ) : (
          <>
            {policy.status !== "trial" && (
              <button className="button secondary" onClick={() => edit(policy)}>
                {t("编辑规则", "Edit rule")}
              </button>
            )}
            {policy.status === "trial" && (
              <button
                className="button secondary"
                onClick={() => restore(policy)}
              >
                {t("退回待选库", "Return to Ready")}
              </button>
            )}
            {policy.status === "ready" && (
              <button className="button primary" onClick={() => choose(policy)}>
                {t("选为今日尝试", "Choose for today")}
              </button>
            )}
            {policy.status === "returned" && (
              <button
                className="button primary"
                onClick={() => restore(policy)}
              >
                {t("重新加入待选", "Return to Ready")}
              </button>
            )}
            <button className="button ghost" onClick={() => reflect(policy)}>
              {t("写复盘", "Reflect")}
            </button>
          </>
        )}
      </div>
      <h3 className="section-title detail-history-title">
        {t("这条国策的历程", "This policy’s history")}
      </h3>
      {events.length ? (
        events.map((e) => (
          <div className="detail-event" key={e.id}>
            <div className="split-row">
              <strong>{eventLabels[e.type][locale === "zh" ? 0 : 1]}</strong>
              <time className="field-help">
                {fmtDate(e.at, locale, state.settings.timezone, true)}
              </time>
            </div>
            {e.note && <p className="history-note">{e.note}</p>}
          </div>
        ))
      ) : (
        <p className="muted">{t("还没有历程记录", "No history yet")}</p>
      )}
    </>
  );
}
function InstallGuide({ locale }: { locale: Locale }) {
  const t = (c: string, e: string) => (locale === "zh" ? c : e);
  const [platform, setPlatform] = useState("other");
  useEffect(() => {
    setPlatform(
      /iPhone|iPad|iPod/.test(navigator.userAgent)
        ? "ios"
        : /Mac/.test(navigator.userAgent)
          ? "mac"
          : "other",
    );
  }, []);
  return (
    <>
      <p className="muted">
        {t(
          "无需开发者会员，也不用每七天重新安装。",
          "No Apple developer membership or recurring seven-day installation.",
        )}
      </p>
      <ol className="install-steps">
        {platform === "ios" ? (
          <>
            <li>
              {t("在 Safari 中打开当前网址。", "Open this website in Safari.")}
            </li>
            <li>
              {t(
                "点击分享按钮，选择“添加到主屏幕”。",
                "Tap Share, then Add to Home Screen.",
              )}
            </li>
            <li>
              {t(
                "如有“作为网页 App 打开”开关，请保持开启，然后添加。",
                "If shown, leave Open as Web App enabled, then tap Add.",
              )}
            </li>
          </>
        ) : platform === "mac" ? (
          <>
            <li>
              {t("在 Safari 中打开此网址。", "Open this website in Safari.")}
            </li>
            <li>
              {t(
                "在支持的系统中选择“文件 → 添加到程序坞”；也可以直接收藏网址。",
                "On supported systems, choose File → Add to Dock, or bookmark the website.",
              )}
            </li>
            <li>
              {t(
                "Chrome / Edge 可使用地址栏或菜单中的安装入口。",
                "In Chrome or Edge, use the installation option in the address bar or menu.",
              )}
            </li>
          </>
        ) : (
          <>
            <li>
              {t(
                "用 Chrome 或 Edge 打开此网址。",
                "Open this website in Chrome or Edge.",
              )}
            </li>
            <li>
              {t(
                "使用地址栏或菜单中的“安装应用”；没有入口时仍可在浏览器使用。",
                "Use Install app in the address bar or menu. Browser use remains available if installation is not offered.",
              )}
            </li>
          </>
        )}
      </ol>
      <div className="notice success">
        <ShieldCheck size={18} />
        {t(
          "免登录，数据保存在当前设备。首次打开需要联网，离线可用后可继续记录。",
          "No sign-in. Data stays on this device. Connect on your first visit; keep recording once offline access is ready.",
        )}
      </div>
      <p className="field-help">
        {t(
          "添加主屏幕后请打开检查记录；Safari 与主屏幕 App 的存储可能独立，需要时用备份迁移。请在实际使用的入口定期导出。",
          "Open the Home Screen app and check your records. Its storage may be separate from Safari; transfer a backup if needed. Export regularly from the entry point you use.",
        )}
      </p>
    </>
  );
}
function ImportButton({
  locale,
  importState,
}: {
  locale: Locale;
  importState: (state: PolicyState) => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            checkBackupSize(file.size, locale);
            const state = parseBackup(await file.text(), locale);
            if (
              confirm(
                locale === "zh"
                  ? `合并备份中的 ${state.policies.length} 条国策及历程？同 ID 国策保留本机版本，偏好设置保留当前值。旧提醒和未确认操作不会执行。建议先导出当前记录。`
                  : `Merge ${state.policies.length} policies and their history? Existing policy IDs and current preferences stay unchanged. Old reminders and unconfirmed operations will not run. Export current records first.`,
              )
            ) {
              await importState(state);
              setError("");
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : "Invalid backup");
          } finally {
            if (input.current) input.current.value = "";
          }
        }}
      />
      <button
        className="button secondary"
        onClick={() => input.current?.click()}
      >
        <Upload size={16} />
        {locale === "zh" ? "导入备份" : "Import backup"}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
