"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { dayKey, descendants, getTodayActivation, policyDays, applyOperation } from "./lib/policy/domain";
import { currentSeatCases } from "./lib/policy/sacred-seats";
import { usePolicyStore } from "./lib/policy/use-policy-store";
import { shareOrDownloadBackup } from "./share-backup";
import { checkBackupSize, parseBackup, serializeBackup } from "./lib/policy/backup";
import type { HistoryEvent, Locale, Operation, Policy, PolicyState, SacredSeat, SeatChain } from "./lib/policy/types";

type Page = "today" | "tree" | "settings" | "seat";
type Text = (cn: string, en: string) => string;
type Act = (type: Operation["type"], id?: string, payload?: Record<string, unknown>, message?: string) => Promise<boolean>;
type RuleDraft = { rule: string; before: string };
type SeatDraft = {
  chain: SeatChain;
  panel: "complete" | "issue" | "edit" | null;
  task: string;
  condition: string;
  name: string;
  rule: string;
  beforeName: string;
  beforeRule: string;
  confirmation?: { chain: SeatChain; count: number; generation: number };
};

function uid() { return crypto.randomUUID(); }
function fmtDate(at: string, locale: Locale, zone: string) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(at));
}
async function exportBackup(state: PolicyState, today: string) {
  const file = new File([serializeBackup(state)], `policy-tree-${today}.json`, { type: "application/json" });
  let canShare = false;
  try { canShare = typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }); } catch { /* Use download below. */ }
  const share = canShare && typeof navigator.share === "function"
    ? () => navigator.share({ files: [file], title: "Policy Tree backup" })
    : undefined;
  return shareOrDownloadBackup(share, () => {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url; link.download = file.name;
    document.body.appendChild(link);
    try { link.click(); } finally {
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  });
}
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function friendlyError(value: string, locale: Locale) {
  if (locale !== "zh") return value;
  const explanations: [RegExp, string][] = [
    [/Only one policy may be activated each day|activation has already been used|add more than one activation on the same day/, "今天已经点亮过一条国策，每天最多点亮一条。"],
    [/trial belongs to another day/, "这条尝试属于之前的日期，请先选择「今天继续尝试」。"],
    [/changed in another tab/, "内容已在其他页面修改。请取消当前编辑，重新打开后再修改。"],
    [/already has an allowed precedent/, "当前链已有允许这种情况的判例，不能将同样情况判定为违规。"],
    [/different day boundary/, "备份使用的日期时区不同，无法直接合并。"],
    [/Only one policy may be tried/, "备份与本机各有一条正在尝试的国策，请先把本机的尝试换回候选库，再导入。"],
    [/This is not a supported Policy Tree backup/, "这不是受支持的国策树 JSON 备份。"],
    [/Choose an active parent|active policy must have an active parent/, "父节点已退回，请重新选择仍在生效的父节点或顶层。"],
    [/no longer exists/, "这条记录已不存在，请重新读取后再操作。"],
    [/Choose a policy from the ready library/, "这条国策不在候选库，请重新选择。"],
    [/Choose and try a policy/, "请先从候选库选择一条国策。"],
    [/Only active policies/, "该节点已退回，不能重复记录违反。"],
    [/Only returned policies or trials/, "这条国策的状态已变化，请重新读取后再操作。"],
    [/Add a name and a rule/, "请填写名称和规则。"],
    [/Write a reflection/, "请先填写复盘内容。"],
    [/most 100 seats/, "最多支持 100 个神圣座位。"],
    [/too many records|snapshot is too large|maximum count|maximum generation/, "记录已达到存储上限，请先导出备份。"],
    [/invalid|must be unique|must contain|must be text|parent is missing|cannot form a cycle|cannot be/, "记录格式或关系无效，未保存或导入。请检查文件或重新打开编辑。"],
    [/Unexpected token|JSON|Expected property|Unterminated string/, "JSON 文件无法解析，请选择完整的国策树备份。"],
  ];
  return explanations.find(([pattern]) => pattern.test(value))?.[1] ?? value;
}

export default function PolicyApp() {
  const store = usePolicyStore();
  const { state, ready, submit, error, storageError, reload, updateAvailable, offlineReady, applyUpdate, lastSaved } = store;
  const locale = state.settings.locale;
  const t: Text = (cn, en) => locale === "zh" ? cn : en;
  const zone = state.settings.timezone;
  const [page, setPage] = useState<Page>("today");
  const [now, setNow] = useState(() => new Date().toISOString());
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editor, setEditor] = useState<{ id: string; name: string; rule: string; status: "draft" | "ready" } | null>(null);
  const [placement, setPlacement] = useState(false);
  const [parentChoice, setParentChoice] = useState("");
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, RuleDraft>>({});
  const [violation, setViolation] = useState<{ id: string; note: string } | null>(null);
  const [reflection, setReflection] = useState<{ id: string; note: string } | null>(null);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [seatDrafts, setSeatDrafts] = useState<Record<string, SeatDraft>>({});
  const [newSeat, setNewSeat] = useState<{ id: string; name: string; rule: string } | null>(null);
  const [importState, setImportState] = useState<PolicyState | null>(null);
  const [backupError, setBackupError] = useState("");
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = state.policies.filter(p => p.status === "active");
  const candidates = state.policies.filter(p => p.status === "ready");
  const drafts = state.policies.filter(p => p.status === "draft");
  const returned = state.policies.filter(p => p.status === "returned");
  const trial = state.policies.find(p => p.status === "trial");
  const todayActivation = getTodayActivation(state, now);
  const todayPolicy = todayActivation && state.policies.find(p => p.id === todayActivation.policyId);
  const today = dayKey(now, zone);
  const trialExpired = trial && trial.trialDate !== today;
  const selectedPolicy = active.find(p => p.id === selectedPolicyId);
  const selectedSeat = state.seats.find(s => s.id === selectedSeatId);
  const format = (at: string) => fmtDate(at, locale, zone);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 30_000);
    const refresh = () => setNow(new Date().toISOString());
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  useEffect(() => { document.documentElement.lang = locale === "zh" ? "zh-CN" : "en"; }, [locale]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const act: Act = async (type, id, payload = {}, success) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true);
    try {
      const saved = await submit(type, id, payload);
      if (saved && success) setToast(success);
      return saved;
    } finally { busyRef.current = false; setBusy(false); }
  };
  function navigate(next: Page) {
    setPage(next);
    setPlacement(false); setParentChoice(""); setViolation(null);
    setSeatDrafts(previous => Object.fromEntries(Object.entries(previous).map(([id, draft]) => [id, { ...draft, confirmation: undefined }])));
    window.scrollTo(0, 0);
  }
  function openLibrary() { setLibraryOpen(true); setPlacement(false); setParentChoice(""); }
  async function choose(policy: Policy) {
    if (await act("choose", policy.id)) { setLibraryOpen(false); setPlacement(false); setParentChoice(""); }
  }
  async function chooseAgain(policy: Policy) {
    if (await act("restore", policy.id)) await act("choose", policy.id);
  }
  function editCandidate(policy?: Policy) {
    setEditor({ id: policy?.id ?? uid(), name: policy?.name ?? "", rule: policy?.rule ?? "", status: policy?.status === "draft" ? "draft" : "ready" });
  }
  async function saveCandidate(event: FormEvent, status: "draft" | "ready") {
    event.preventDefault();
    if (!editor) return;
    if (await act("save", editor.id, { name: editor.name, rule: editor.rule, status }, t(status === "ready" ? "已加入候选库" : "草稿已保存", status === "ready" ? "Added to candidates" : "Draft saved"))) setEditor(null);
  }
  function removeRuleDraft(id: string) {
    setRuleDrafts(previous => { const next = { ...previous }; delete next[id]; return next; });
  }
  async function saveRule(event: FormEvent, policy: Policy) {
    event.preventDefault();
    const draft = ruleDrafts[policy.id];
    if (!draft) return;
    if (await act("editRule", policy.id, { rule: draft.rule, expectedRule: draft.before }, t("修改已保存", "Changes saved"))) removeRuleDraft(policy.id);
  }
  function selectSeat(seat: SacredSeat) {
    setSeatDrafts(previous => {
      const next: Record<string, SeatDraft> = Object.fromEntries(Object.entries(previous).map(([id, draft]) => [id, { ...draft, confirmation: undefined }]));
      next[seat.id] ??= { chain: "main", panel: null, task: "", condition: "", name: seat.name, rule: seat.rule, beforeName: seat.name, beforeRule: seat.rule };
      return next;
    });
    setSelectedSeatId(current => current === seat.id ? null : seat.id);
  }
  function patchSeat(id: string, patch: Partial<SeatDraft>) {
    setSeatDrafts(previous => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  }
  const hasOpenForm = !!editor || !!newSeat || !!violation || !!reflection || placement || Object.keys(ruleDrafts).length > 0 || Object.values(seatDrafts).some(d => d.panel !== null);

  if (!ready) return <div className="loading-screen"><p>{t("正在读取本机记录…", "Loading local records…")}</p>{error && <><p role="alert">{error}</p><button className="primary" onClick={reload}>{t("重新读取", "Reload")}</button></>}</div>;

  return <>
    <main className={page === "tree" ? "app-main tree-view" : "app-main"}>
      <header className="app-header">
        {page === "today" && <button className="text-button" onClick={() => setLibraryOpen(open => !open)} aria-expanded={libraryOpen} aria-controls="candidate-library">{t("候选库", "Candidates")}</button>}
      </header>
      {storageError && <div className="notice error" role="alert"><span>{storageError}</span><button className="text-button" onClick={reload}>{t("重新读取", "Reload")}</button></div>}
      {error && <div className="notice error" role="alert">{friendlyError(error, locale)}</div>}
      {updateAvailable && <div className="notice"><span>{t("新版本已准备好。", "An update is ready.")}</span><button className="text-button" onClick={() => hasOpenForm ? setToast(t("请先保存或关闭编辑中的内容", "Save or close open editors first")) : applyUpdate()}>{t("更新", "Update")}</button></div>}

      {page === "today" && <section aria-label={t("今日", "Today")}>
        <section className="today-card">
          {todayActivation ? <>
            <h1>{todayPolicy?.name || todayActivation.policyName}</h1>
            {todayPolicy && <p className="rule-text">{todayPolicy.rule}</p>}
            <div className="actions"><button className="primary" disabled>{t("今天已点亮", "Activated today")}</button></div>
          </> : trial ? <>
            <h1>{trial.name}</h1><p className="rule-text">{trial.rule}</p>
            {trialExpired ? <div className="actions"><button className="primary" disabled={busy} onClick={() => chooseAgain(trial)}>{t("今天继续尝试", "Try again today")}</button><button className="text-button" disabled={busy} onClick={async () => { if (await act("restore", trial.id)) openLibrary(); }}>{t("换一条", "Choose another")}</button></div>
            : placement ? <form className="placement-form" onSubmit={async event => {
              event.preventDefault();
              if (!parentChoice) return;
              if (await act("activate", trial.id, { parentId: parentChoice === "__root__" ? null : parentChoice })) { setPlacement(false); setParentChoice(""); setNow(new Date().toISOString()); }
            }}>
              <label htmlFor="parent-choice">{t("父节点", "Parent")}</label>
              <select id="parent-choice" value={parentChoice} onChange={event => setParentChoice(event.target.value)} required>
                <option value="" disabled>{t("选择挂载位置", "Choose a position")}</option>
                <option value="__root__">{t("顶层（无父节点）", "Top level (no parent)")}</option>
                {active.map(policy => <option key={policy.id} value={policy.id}>{policyPath(policy, state.policies)}</option>)}
              </select>
              <div className="actions"><button className="primary" disabled={busy || !parentChoice}>{t("确认点亮", "Confirm activation")}</button><button type="button" className="text-button" onClick={() => { setPlacement(false); setParentChoice(""); }}>{t("取消", "Cancel")}</button></div>
            </form> : <div className="actions"><button className="primary" onClick={() => { setPlacement(true); setParentChoice(""); setLibraryOpen(false); }}>{t("我做到了", "I did it")}</button><button className="text-button" onClick={openLibrary}>{t("换一条", "Choose another")}</button></div>}
          </> : <>
            <h1>{t("选择一条候选", "Choose a candidate")}</h1>
            <div className="actions"><button className="primary" onClick={() => { openLibrary(); if (!candidates.length) editCandidate(); }}>{t(candidates.length ? "选择" : "写一条", candidates.length ? "Choose" : "Write one")}</button></div>
          </>}
        </section>
        {libraryOpen && <section className="library" id="candidate-library" aria-labelledby="library-title">
          <div className="section-heading"><h2 id="library-title">{t("候选库", "Candidates")}</h2><button className="text-button" onClick={() => editor ? setEditor(null) : editCandidate()} aria-expanded={!!editor}>{t("写一条", "Write one")}</button></div>
          <ul className="choices">{candidates.map(policy => <li key={policy.id}><div className="choice-row"><button className="choice" disabled={busy || !!todayActivation} onClick={() => choose(policy)}>{policy.name}</button><button className="text-button compact" aria-label={t(`修改 ${policy.name}`, `Edit ${policy.name}`)} onClick={() => editCandidate(policy)}>{t("修改", "Edit")}</button></div></li>)}</ul>
          {!candidates.length && <p className="empty-note">{t("暂无候选", "No candidates yet")}</p>}
          {editor && <form onSubmit={event => saveCandidate(event, "ready")}>
            <label htmlFor="candidate-name">{t("名称", "Name")}</label><input id="candidate-name" maxLength={160} value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} required placeholder={t("想做的一件小事", "A small thing to do")} />
            <label htmlFor="candidate-rule">{t("规则", "Rule")}</label><textarea id="candidate-rule" maxLength={20000} value={editor.rule} onChange={e => setEditor({ ...editor, rule: e.target.value })} required placeholder={t("用自己的话写清楚就好", "Describe it in your own words")} />
            <details className="template-hints"><summary>{t("模板提示", "Writing prompts")}</summary><p>{t("当……时，我会……。如果……，则……。", "When …, I will …. If …, then ….")}</p></details>
            <div className="actions"><button className="primary" disabled={busy || !editor.name.trim() || !editor.rule.trim()}>{t("放进候选库", "Add to candidates")}</button><button className="text-button" type="button" disabled={busy} onClick={event => saveCandidate(event, "draft")}>{t("存为草稿", "Save draft")}</button><button className="text-button" type="button" onClick={() => setEditor(null)}>{t("取消", "Cancel")}</button></div>
          </form>}
          {!!drafts.length && <details className="plain-disclosure"><summary>{t("草稿", "Drafts")}</summary><ul className="choices">{drafts.map(policy => <li key={policy.id}><div className="choice-row"><button className="choice" onClick={() => editCandidate(policy)}>{policy.name || t("未命名", "Untitled")}</button><button className="text-button danger-link compact" disabled={busy} onClick={() => { if (window.confirm(t("删除这条草稿？", "Delete this draft?"))) void act("deleteDraft", policy.id); }}>{t("删除", "Delete")}</button></div></li>)}</ul></details>}
          {!!returned.length && <details className="plain-disclosure"><summary>{t("已退回", "Returned")}</summary><ul className="returned-list">{returned.map(policy => <li key={policy.id}><strong>{policy.name}</strong><p>{policy.rule}</p><div className="actions"><button className="text-button" disabled={busy} onClick={() => act("restore", policy.id, {}, t("已放回候选库", "Returned to candidates"))}>{t("放回候选库", "Return to candidates")}</button><button className="text-button" onClick={() => setReflection({ id: policy.id, note: "" })}>{t("复盘", "Reflect")}</button></div>{reflection?.id === policy.id && <ReflectionForm value={reflection.note} onChange={note => setReflection({ id: policy.id, note })} onCancel={() => setReflection(null)} onSave={async event => { event.preventDefault(); if (await act("reflect", policy.id, { note: reflection.note })) setReflection(null); }} busy={busy} t={t} />}</li>)}</ul></details>}
        </section>}
      </section>}

      {page === "tree" && <section className="simple-page" aria-labelledby="tree-title">
        <h1 id="tree-title">My Tree</h1>
        {active.length ? <div className="tree-scroll" tabIndex={0} role="region" aria-label={t("国策树，可横向滚动", "Policy tree, scroll horizontally")}>
          <ul className="policy-tree"><li><span className="tree-root">{t("起点", "Root")}</span><ul>{active.filter(policy => !policy.parentId).map(policy => <TreeNode key={policy.id} policy={policy} active={active} selectedId={selectedPolicyId} onSelect={id => { setSelectedPolicyId(previous => previous === id ? null : id); setViolation(null); }} now={now} zone={zone} t={t} />)}</ul></li></ul>
        </div> : <p className="empty-note">{t("还没有点亮的节点", "No activated policies yet")}</p>}
        {selectedPolicy && <section className="node-detail" aria-label={t("节点详情", "Policy details")}>
          <dl className="node-meta"><div className="detail-wide"><dt className="detail-content-heading"><span>{t("内容", "Content")}</span>{!ruleDrafts[selectedPolicy.id] && <button className="text-button" onClick={() => setRuleDrafts(previous => ({ ...previous, [selectedPolicy.id]: { rule: selectedPolicy.rule, before: selectedPolicy.rule } }))}>{t("修改", "Edit")}</button>}</dt><dd>
            {ruleDrafts[selectedPolicy.id] ? <form className="rule-editor" onSubmit={event => saveRule(event, selectedPolicy)}><label className="visually-hidden" htmlFor="node-rule">{t("修改内容", "Edit content")}</label><textarea id="node-rule" maxLength={20000} required value={ruleDrafts[selectedPolicy.id].rule} onChange={event => setRuleDrafts(previous => ({ ...previous, [selectedPolicy.id]: { ...previous[selectedPolicy.id], rule: event.target.value } }))} /><div className="actions"><button className="primary" disabled={busy || !ruleDrafts[selectedPolicy.id].rule.trim() || ruleDrafts[selectedPolicy.id].rule.trim() === selectedPolicy.rule}>{t("保存", "Save")}</button><button type="button" className="text-button" onClick={() => removeRuleDraft(selectedPolicy.id)}>{t("取消", "Cancel")}</button></div></form> : <p className="detail-rule">{selectedPolicy.rule}</p>}
          </dd></div><div><dt>{t("点亮时间", "Activated")}</dt><dd>{selectedPolicy.activatedAt ? format(selectedPolicy.activatedAt) : "—"}</dd></div><div><dt>{t("已坚持", "Kept for")}</dt><dd>{policyDays(selectedPolicy, now, zone)} {t("天", "days")}</dd></div><div className="detail-wide"><dt>{t("修改记录", "Changes")}</dt><dd><Changes events={state.events.filter(event => event.policyId === selectedPolicy.id && event.type === "edited")} format={format} t={t} /></dd></div></dl>
          <div className="actions detail-actions"><button className="text-button danger-link" onClick={() => setViolation(violation?.id === selectedPolicy.id ? null : { id: selectedPolicy.id, note: "" })}>{t("记录违反", "Record a violation")}</button><button className="text-button" onClick={() => setReflection(reflection?.id === selectedPolicy.id ? null : { id: selectedPolicy.id, note: "" })}>{t("复盘", "Reflect")}</button></div>
          {violation?.id === selectedPolicy.id && <form className="violation-form" onSubmit={async event => { event.preventDefault(); if (await act("violate", selectedPolicy.id, { note: violation.note }, t("已记录违反", "Violation recorded"))) { setViolation(null); setSelectedPolicyId(null); } }}><p>{t("以下节点会退回候选流程，需要重新点亮：", "These policies will be returned and need to be activated again:")}</p><ul className="affected-list">{[selectedPolicy, ...descendants(state, selectedPolicy.id).filter(p => p.status === "active")].map(policy => <li key={policy.id}>{policy.name}</li>)}</ul><label htmlFor="violation-note">{t("情况（选填）", "Note (optional)")}</label><textarea id="violation-note" maxLength={20000} value={violation.note} onChange={event => setViolation({ ...violation, note: event.target.value })} /><div className="actions"><button className="primary danger-button" disabled={busy}>{t("确认退回", "Confirm return")}</button><button type="button" className="text-button" onClick={() => setViolation(null)}>{t("取消", "Cancel")}</button></div></form>}
          {reflection?.id === selectedPolicy.id && <ReflectionForm value={reflection.note} onChange={note => setReflection({ id: selectedPolicy.id, note })} onCancel={() => setReflection(null)} onSave={async event => { event.preventDefault(); if (await act("reflect", selectedPolicy.id, { note: reflection.note })) setReflection(null); }} busy={busy} t={t} />}
        </section>}
        {!!state.events.length && <details className="history-disclosure"><summary>{t("记录", "Records")}</summary><ul className="record-list">{[...state.events].reverse().map(event => <li key={event.id}><time dateTime={event.at}>{format(event.at)}</time><strong>{event.policyName} · {eventLabel(event, t)}</strong>{event.note && <p>{event.note}</p>}{(event.before !== undefined || event.after !== undefined) && <VersionChange before={event.before} after={event.after} t={t} />}</li>)}</ul></details>}
      </section>}

      {page === "settings" && <section className="simple-page" aria-labelledby="settings-title"><h1 id="settings-title">{t("设置", "Settings")}</h1><div className="settings-list">
        <button className="settings-row" disabled={exporting} onClick={async () => { setExporting(true); setBackupError(""); try { const result = await exportBackup(state, today); if (result !== "cancelled") setToast(t(result === "shared" ? "请在分享菜单中存储 JSON 备份" : "已发起 JSON 下载，请确认文件已保存", result === "shared" ? "Save the JSON backup from the share menu" : "JSON download started; confirm that the file was saved")); } catch (caught) { setBackupError(friendlyError(message(caught), locale)); } finally { setExporting(false); } }}><span>{t("导出 JSON", "Export JSON")}</span><span aria-hidden="true">›</span></button>
        <button className="settings-row" onClick={() => fileInput.current?.click()} disabled={busy}><span>{t("导入 JSON", "Import JSON")}</span><span aria-hidden="true">›</span></button>
      </div><input className="visually-hidden" ref={fileInput} type="file" accept=".json,application/json" aria-label={t("选择 JSON 备份", "Choose a JSON backup")} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ""; setImportState(null); setBackupError(""); if (!file) return;
        try {
          if (!/\.json$/i.test(file.name)) throw new Error(t("请选择 .json 文件", "Choose a .json file"));
          checkBackupSize(file.size, locale);
          const incoming = parseBackup(await file.text(), locale);
          const at = new Date().toISOString();
          applyOperation(state, { id: uid(), type: "import", at, payload: { state: incoming } }, at);
          setImportState(incoming);
        } catch (caught) { setBackupError(friendlyError(message(caught), locale)); }
      }} />
      {importState && <section className="import-review"><p>{t("备份已校验。", "Backup validated.")} {t(`包含 ${importState.policies.length} 条国策、${importState.seats.length} 个神圣座位。`, `Contains ${importState.policies.length} policies and ${importState.seats.length} sacred seats.`)}</p><p>{t("导入会合并新增记录；相同 ID 的国策和座位保留本机版本。", "Import merges new records; policies and seats with matching IDs keep the local version.")}</p><div className="actions"><button className="primary" disabled={busy} onClick={async () => { if (await act("import", undefined, { state: importState }, t("备份已合并", "Backup merged"))) {
            setImportState(null); setEditor(null); setPlacement(false); setParentChoice("");
            setRuleDrafts({}); setSeatDrafts({}); setNewSeat(null); setSelectedSeatId(null);
            setSelectedPolicyId(null); setReflection(null); setViolation(null);
          } }}>{t("导入", "Import")}</button><button className="text-button" onClick={() => setImportState(null)}>{t("取消", "Cancel")}</button></div></section>}
      {backupError && <p className="field-error" role="alert">{backupError}</p>}
      <p className="storage-caption">{t("数据保存在当前设备", "Data stays on this device")}{lastSaved && ` · ${t("已保存", "Saved")}`}{offlineReady && ` · ${t("可离线使用", "Available offline")}`}</p>
      </section>}

      {page === "seat" && <section className="simple-page" aria-labelledby="seat-title"><div className="seat-page-heading"><h1 id="seat-title">{t("神圣座位", "Sacred seats")}</h1><button className="text-button" onClick={() => setNewSeat(current => current ? null : { id: uid(), name: "", rule: "" })} aria-expanded={!!newSeat}>{t("新增", "Add")}</button></div>
        <div className="seat-picker" role="group" aria-label={t("选择神圣座位", "Choose a sacred seat")}>{state.seats.map(seat => <button key={seat.id} className="seat-choice" aria-pressed={seat.id === selectedSeatId} aria-expanded={seat.id === selectedSeatId} aria-controls={seat.id === selectedSeatId ? "seat-detail" : undefined} onClick={() => selectSeat(seat)}><span className="seat-choice-name">{seat.name}</span><span className="seat-choice-count" aria-label={t(`主链成功 ${seat.main.count} 次`, `${seat.main.count} main chain successes`)}>{seat.main.count}</span></button>)}</div>
        {!state.seats.length && !newSeat && <p className="empty-note">{t("还没有神圣座位", "No sacred seats yet")}</p>}
        {newSeat && <form className="seat-create" onSubmit={async event => { event.preventDefault(); if (await act("seatSave", newSeat.id, { name: newSeat.name, rule: newSeat.rule }, t("已新增", "Seat added"))) setNewSeat(null); }}><label htmlFor="seat-new-name">{t("名称", "Name")}</label><input id="seat-new-name" value={newSeat.name} onChange={event => setNewSeat({ ...newSeat, name: event.target.value })} maxLength={100} required placeholder={t("例如：阅读角", "For example: Reading corner")} /><label htmlFor="seat-new-rule">{t("规则", "Rule")}</label><textarea id="seat-new-rule" value={newSeat.rule} onChange={event => setNewSeat({ ...newSeat, rule: event.target.value })} maxLength={20000} required placeholder={t("写下触发标志和要遵守的规则", "Describe the trigger and the rule")} /><div className="actions"><button className="primary" disabled={busy || !newSeat.name.trim() || !newSeat.rule.trim()}>{t("新增", "Add")}</button><button type="button" className="text-button" onClick={() => setNewSeat(null)}>{t("取消", "Cancel")}</button></div></form>}
        {selectedSeat && seatDrafts[selectedSeat.id] && <SeatDetail seat={selectedSeat} draft={seatDrafts[selectedSeat.id]} patch={patch => patchSeat(selectedSeat.id, patch)} act={act} busy={busy} format={format} t={t} />}
      </section>}
    </main>
    <nav className="bottom-nav" aria-label={t("主导航", "Main navigation")}>
      <button aria-current={page === "today" ? "page" : undefined} onClick={() => navigate("today")}>{t("今日", "Today")}</button>
      <button aria-current={page === "tree" ? "page" : undefined} aria-label="My Tree" title="My Tree" onClick={() => navigate("tree")}><svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="2.5" width="6" height="5" rx="1.5" /><path d="M12 7.5V12M5 16v-4h14v4" /><rect x="2" y="16" width="6" height="5" rx="1.5" /><rect x="16" y="16" width="6" height="5" rx="1.5" /></svg></button>
      <button aria-current={page === "settings" ? "page" : undefined} onClick={() => navigate("settings")}>{t("设置", "Settings")}</button>
      <button aria-current={page === "seat" ? "page" : undefined} aria-label={t("神圣座位", "Sacred seats")} title={t("神圣座位", "Sacred seats")} onClick={() => navigate("seat")}><svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 12V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v7M7 17v4M17 17v4" /><rect x="5" y="12" width="14" height="5" rx="1.5" /></svg></button>
    </nav>
    {toast && <div className="toast" role="status">{toast}</div>}
  </>;
}

function policyPath(policy: Policy, policies: Policy[]) {
  const names = [policy.name]; const visited = new Set([policy.id]); let parentId = policy.parentId;
  while (parentId && !visited.has(parentId)) { visited.add(parentId); const parent = policies.find(p => p.id === parentId); if (!parent) break; names.unshift(parent.name); parentId = parent.parentId; }
  return names.join(" › ");
}
function TreeNode({ policy, active, selectedId, onSelect, now, zone, t }: { policy: Policy; active: Policy[]; selectedId: string | null; onSelect: (id: string) => void; now: string; zone: string; t: Text }) {
  const children = active.filter(p => p.parentId === policy.id);
  const days = policyDays(policy, now, zone);
  return <li><button className="tree-node" aria-pressed={selectedId === policy.id} aria-expanded={selectedId === policy.id} aria-label={t(`${policy.name}，已坚持 ${days} 天`, `${policy.name}, kept for ${days} days`)} onClick={() => onSelect(policy.id)}><span>{policy.name}</span><span className="node-days" aria-hidden="true">{days}</span></button>{!!children.length && <ul>{children.map(child => <TreeNode key={child.id} policy={child} active={active} selectedId={selectedId} onSelect={onSelect} now={now} zone={zone} t={t} />)}</ul>}</li>;
}
function VersionChange({ before, after, t }: { before?: string; after?: string; t: Text }) {
  return <>{before !== undefined && <div className="change-version"><span>{t("修改前", "Before")}</span><p>{before}</p></div>}{after !== undefined && <div className="change-version"><span>{t("修改后", "After")}</span><p>{after}</p></div>}</>;
}
function Changes({ events, format, t }: { events: HistoryEvent[]; format: (at: string) => string; t: Text }) {
  if (!events.length) return <span className="muted">{t("暂无修改", "No changes yet")}</span>;
  return <ul className="change-list">{[...events].reverse().map(event => <li key={event.id}><time dateTime={event.at}>{format(event.at)}</time>{event.before !== undefined || event.after !== undefined ? <VersionChange before={event.before} after={event.after} t={t} /> : <p className="muted">{event.note || t("历史修改未记录前后内容", "This older change has no before/after content")}</p>}</li>)}</ul>;
}
function ReflectionForm({ value, onChange, onCancel, onSave, busy, t }: { value: string; onChange: (value: string) => void; onCancel: () => void; onSave: (event: FormEvent) => void; busy: boolean; t: Text }) {
  return <form onSubmit={onSave}><label htmlFor="reflection-note">{t("复盘", "Reflection")}</label><textarea id="reflection-note" value={value} onChange={event => onChange(event.target.value)} maxLength={20000} required /><div className="actions"><button className="primary" disabled={busy || !value.trim()}>{t("保存", "Save")}</button><button type="button" className="text-button" onClick={onCancel}>{t("取消", "Cancel")}</button></div></form>;
}
function eventLabel(event: HistoryEvent, t: Text) {
  const labels: Record<HistoryEvent["type"], [string, string]> = { created: ["新增", "Created"], edited: ["修改", "Edited"], chosen: ["选择尝试", "Chosen"], activated: ["点亮", "Activated"], violated: ["违反", "Violation"], dependent_return: ["随父节点退回", "Returned with parent"], restored: ["放回候选库", "Returned to candidates"], reflection: ["复盘", "Reflection"], imported: ["导入", "Imported"] };
  return t(...labels[event.type]);
}

function SeatDetail({ seat, draft, patch, act, busy, format, t }: { seat: SacredSeat; draft: SeatDraft; patch: (value: Partial<SeatDraft>) => void; act: Act; busy: boolean; format: (at: string) => string; t: Text }) {
  const chainName = draft.chain === "main" ? t("主链", "Main chain") : t("预约链", "Reservation chain");
  const cases = currentSeatCases(seat, draft.chain);
  const priorCase = cases.find(item => item.condition === draft.condition.trim());
  const cancelPanel = () => patch({ panel: null, task: "", condition: "", name: seat.name, rule: seat.rule, beforeName: seat.name, beforeRule: seat.rule, confirmation: undefined });
  const recordTitles: Record<string, string> = { completed: t("完成", "Completed"), reservation_success: t("预约成功", "Reservation fulfilled"), allowed: t("允许判例", "Allowed precedent"), failed: t("违规", "Violation"), edited: t("修改规则", "Rule edited"), reserved: t("历史预约", "Legacy reservation"), started: t("历史开始", "Legacy start") };
  return <div id="seat-detail">
    <section className="seat-card" aria-label={`${seat.name} ${t("详情", "details")}`}>
      <div className="seat-heading"><button className="seat-name" aria-expanded={draft.panel === "edit"} onClick={() => draft.panel === "edit" ? cancelPanel() : patch({ panel: "edit", name: seat.name, rule: seat.rule, beforeName: seat.name, beforeRule: seat.rule, confirmation: undefined })}><span>{seat.name}</span><span aria-hidden="true">›</span></button></div>
      <p className="seat-rule-summary">{seat.rule}</p>
      {draft.panel === "edit" && <form className="seat-editor" onSubmit={async event => { event.preventDefault(); if (await act("seatSave", seat.id, { name: draft.name, rule: draft.rule, expectedName: draft.beforeName, expectedRule: draft.beforeRule }, t("修改已保存", "Changes saved"))) cancelPanel(); }}><label htmlFor="seat-edit-name">{t("名称", "Name")}</label><input id="seat-edit-name" value={draft.name} maxLength={100} required onChange={e => patch({ name: e.target.value })} /><label htmlFor="seat-edit-rule">{t("规则", "Rule")}</label><textarea id="seat-edit-rule" value={draft.rule} maxLength={20000} required onChange={e => patch({ rule: e.target.value })} /><div className="actions"><button className="primary" disabled={busy || !draft.name.trim() || !draft.rule.trim() || (draft.name.trim() === seat.name && draft.rule.trim() === seat.rule)}>{t("保存", "Save")}</button><button type="button" className="text-button" onClick={cancelPanel}>{t("取消", "Cancel")}</button></div></form>}
      <div className="seat-metric"><div className="seat-chain-tabs" role="group" aria-label={t("记录对象", "Chain to record")}><button aria-pressed={draft.chain === "main"} onClick={() => patch({ chain: "main", confirmation: undefined })}>{t("主链", "Main chain")}</button><button aria-pressed={draft.chain === "aux"} onClick={() => patch({ chain: "aux", confirmation: undefined })}>{t("预约链", "Reservation chain")}</button></div><div className="seat-value" aria-label={`${chainName} ${seat[draft.chain].count}`}>{seat[draft.chain].count}</div></div>
      {!draft.panel && <div className="actions"><button className="primary" onClick={() => patch({ panel: "complete", confirmation: undefined })}>{t("记录完成", "Record completion")}</button><button className="text-button" onClick={() => patch({ panel: "issue", confirmation: undefined })}>{t("记录情况", "Record a situation")}</button></div>}
      {draft.panel === "complete" && <form className="seat-completion" onSubmit={async event => { event.preventDefault(); if (await act("seatComplete", seat.id, { chain: draft.chain, task: draft.task }, t("已记录完成", "Completion recorded"))) cancelPanel(); }}><label htmlFor="seat-task">{t("内容（选填）", "Content (optional)")}</label><textarea id="seat-task" maxLength={20000} value={draft.task} onChange={event => patch({ task: event.target.value })} placeholder={t("本次完成了什么", "What did you complete?")} /><div className="actions"><button className="primary" disabled={busy}>{t("保存记录", "Save record")}</button><button className="text-button" type="button" onClick={cancelPanel}>{t("取消", "Cancel")}</button></div></form>}
      {draft.panel === "issue" && <form className="seat-issue" onSubmit={async event => { event.preventDefault(); if (await act("seatAllow", seat.id, { chain: draft.chain, condition: draft.condition }, t("已记录判例", "Precedent recorded"))) cancelPanel(); }}>
        {!!cases.length && <><label htmlFor="seat-precedent">{t("已有判例", "Existing precedent")}</label><select id="seat-precedent" value={priorCase?.id ?? ""} onChange={event => { const existing = cases.find(item => item.id === event.target.value); if (existing) patch({ condition: existing.condition, confirmation: undefined }); }}><option value="">{t("选择判例（选填）", "Choose a precedent (optional)")}</option>{cases.map(item => <option key={item.id} value={item.id}>{item.condition}</option>)}</select></>}
        <label htmlFor="seat-condition">{t("情况", "Situation")}</label><textarea id="seat-condition" required maxLength={20000} value={draft.condition} onChange={event => patch({ condition: event.target.value, confirmation: undefined })} placeholder={t("发生了什么？适用条件是什么？", "What happened? Under what conditions?")} />
        <div className="actions"><button className="primary" disabled={busy || !draft.condition.trim()}>{t("允许并记为判例", "Allow and record precedent")}</button><button className="text-button danger-link" type="button" disabled={busy || !draft.condition.trim() || !!priorCase} onClick={() => patch({ confirmation: { chain: draft.chain, ...seat[draft.chain] } })}>{t("判定违规", "Mark as violation")}</button><button className="text-button" type="button" onClick={cancelPanel}>{t("取消", "Cancel")}</button></div>
        {priorCase && <p className="field-help">{t("同一轮中这个情况已有允许判例。", "This situation already has an allowed precedent in this chain generation.")}</p>}
        {draft.confirmation && <div className="seat-failure"><p>{t(`将清零${chainName}的 ${draft.confirmation.count} 次成功记录，历史会保留。`, `Reset ${draft.confirmation.count} successes in the ${chainName.toLowerCase()}. History is retained.`)}</p><div className="actions"><button className="primary danger-button" type="button" disabled={busy} onClick={async () => { const confirm = draft.confirmation; if (!confirm) return; if (await act("seatFail", seat.id, { chain: confirm.chain, condition: draft.condition, expectedCount: confirm.count, expectedGeneration: confirm.generation }, t("已记录违规", "Violation recorded"))) cancelPanel(); }}>{t("确认违规", "Confirm violation")}</button><button className="text-button" type="button" onClick={() => patch({ confirmation: undefined })}>{t("取消", "Cancel")}</button></div></div>}
      </form>}
    </section>
    <div className="seat-footnotes">
      <details className="seat-disclosure"><summary>{t("判例", "Precedents")}</summary><ul>{seat.cases.length ? [...seat.cases].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map(item => <li key={item.id}><time dateTime={item.at}>{format(item.at)}</time><small>{item.chain === "main" ? t("主链", "Main chain") : t("预约链", "Reservation chain")}{item.generation !== seat[item.chain].generation && ` · ${t("历史", "Archived")}`}</small><p>{item.condition}</p></li>) : <li className="empty-note">{t("暂无判例", "No precedents yet")}</li>}</ul></details>
      <details className="seat-disclosure"><summary>{t("记录", "Records")}</summary><ul>{seat.records.length ? [...seat.records].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map(item => <li key={item.id}><time dateTime={item.at}>{format(item.at)}</time><div className="record-title">{recordTitles[item.type]} · {item.chain === "main" ? t("主链", "Main chain") : t("预约链", "Reservation chain")}</div>{item.task && <p>{item.task}</p>}{item.note && <p>{item.note}</p>}{(item.before !== undefined || item.after !== undefined) && <VersionChange before={item.before} after={item.after} t={t} />}</li>) : <li className="empty-note">{t("暂无记录", "No records yet")}</li>}</ul></details>
    </div>
  </div>;
}
