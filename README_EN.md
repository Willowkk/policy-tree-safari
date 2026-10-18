# Policy Tree · Safari Local Edition

[简体中文](README_CN.md) · [Product design](../design/v0.1/DESIGN_EN.md)

A personal PWA with no login and local storage. Policies and Sacred Seat records stay in the current browser, with offline use and JSON export/import. There is no cloud sync, account binding, focus timer, or system reminder.

Published address: [Open Policy Tree](https://willowkk.github.io/policy-tree-safari/). Version 0.4 retains this address and adopts the approved HTML design.

## Four Destinations

Bottom navigation is **Today · tree icon · Settings · chair icon**. The tree opens My Tree; the chair opens Sacred Seats. Pages no longer have a top-left brand heading.

### Today

- Prepare or select a rule through Candidate Library in the top-right corner. Enter a name and free-text content; older Draft and Returned records remain accessible.
- Choose one trial. After successfully practicing it, tap “I did it,” explicitly choose an Active parent or top-level position, and confirm activation.
- Each local data space uses **midnight in Asia/Shanghai (Beijing time)**. Activate at most once per day; daily activation is optional. Top-level, child, and reactivated nodes all consume the allowance.
- Changing trials, editing content, and preparing candidates do not consume it. Returning a policy on the activation day does not restore it.
- There are no replenishment prompts or motivational slogans.

### My Tree

- Actual parent-child connectors form a tree. Wide branches scroll horizontally.
- A node shows only its name and a number: adherence days since its latest activation. **The activation date is 1, the next date is 2**, using Beijing calendar dates.
- Click to expand details, click the same node again to collapse, or another to switch.
- Details contain only Content, Activated At, Maintained, and Changes. Creation time is not shown.
- Active rule content can be edited. Record edit time and before/after text without changing activation time, adherence days, or the parent.
- Preview a violation's effects before confirming. Return only that node and its Active descendants; retain ancestors, siblings, and history. Revise and restore it to Ready for another attempt. Reactivation starts at 1 again.

Not opening the app, not recording a result, or not triggering a rule does not automatically fail it. Adherence days are not a daily check-in count or independently verified behavior.


#### History Display Update (October 18, 2026)

My Tree's Records shows activations, violations, dependent returns, reflections, and readable edits. Creation, selection, restoration to Ready, and import bookkeeping are hidden.

Show an edit only if its trimmed note is nonempty, or its trimmed before/after content differs with at least one nonempty side. A node's Changes uses the same rule and shows “No changes yet” when none qualify. This changes display only: all raw events remain in local storage and JSON backups, with activation allowances and old-data compatibility unchanged. Sacred Seat history is unchanged.

### Sacred Seats

This page manually records results that already happened outside the app. **There is no countdown, Start/reservation workflow, or automatic outcome.**

- Choose Add and enter a name and rule. Manage multiple independent seats.
- A collapsed card shows only its name and current main-chain success count. Click to expand rules, actions, precedents, and history; click again to collapse.
- Select Main or Reservation, record a completion, optionally describe it, and save to add 1 to that chain.
- Record Situation lets you allow a case and save a precedent, or confirm a violation. A violation resets only the selected chain in this seat; the other chain and other seats are unaffected.
- A condition already allowed in the current generation cannot become a violation in that generation. Allowing a situation does not automatically count as completing a task. Breaking a chain retains history and archives old-generation precedents; the new chain starts at 0.
- The main chain tracks task completion. The reservation chain tracks starting as promised. Inactivity, not making a reservation, or returning after several days does not automatically break either chain.
- Editing the seat name or rule records before/after content and does not reset counts.
- You can switch seats while recording a situation or editing. Each seat retains its own text and selected chain within the current page. A pending violation confirmation does not transfer between seats. Drafts are not saved records; preserving unsubmitted drafts across reload is not guaranteed.

Seats and policies run separately. Failure on one side does not automatically affect the other.

### Settings

Only two routine actions: **Export JSON and Import JSON**. Relevant save errors and update notices remain available.

## Save, Export, and Restore

An action succeeds only after its local write succeeds, including offline. Failed writes show an error and are not completed operations.

Settings → Export JSON includes policies, relationships, activation/return history, content changes, reflections, all seats, both chains, precedents, and seat records. On iPhone, select Save to Files in the share sheet, or locate a downloaded file in Safari or Files. Canceling sharing is not a completed backup.

Settings → Import JSON accepts JSON files only, validates them, requests confirmation, and merges safely:

| Situation | Behavior |
| --- | --- |
| New policy, event, or seat IDs | Add to local records |
| Existing IDs | Keep current local versions |
| Contradictory relationships, same-day activations, or chain data after merge | Reject the entire import without partial writes |
| Invalid/oversized file or failed write | Show an error and retain saved data |
| Older production backup without seats | Read compatibly without adding demo seats |
| Compatible old cloud snapshot | Migrate saved data; do not replay queued operations, confirm pending activations, or restore reminders |
| HTML prototype `policy-tree-preview` v1 | Convert strictly, then validate and merge under production rules instead of replacing everything |

Import is not two-way synchronization. Editing a rule on a computer and importing it to a phone does not overwrite the phone's existing same-ID policy. A complete import into an empty space is the preferred replacement-device flow. Prototype backups with multiple activations on one day or invalid records are rejected in full. The app never changes dates or drops nodes to bypass the rules; keep the original file. Import and export files are limited to 20 MiB.

Export after substantial edits, before changing devices, and before clearing website data. The file contains private original text; keep it in a trusted place. The app never uploads the backup to iCloud or another service automatically.

## Use on iPhone

1. Connect to the internet and open the [published address](https://willowkk.github.io/policy-tree-safari/) in Safari.
2. Choose Share → Add to Home Screen. If Open as Web App is shown, keep it enabled, then Add. See [Apple's instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios).
3. Open the Home Screen icon once while online so the offline cache can become ready.
4. Core record functions can be used offline when the cache is available.

Choose a primary entry point for long-term use. A Safari tab and a Home Screen app may have separate storage. If data is missing after installation, export from the original entry and import into the new one. Installation is not a backup and needs no Apple developer membership or seven-day renewal.

Modern Mac and Windows browsers can use the same website; devices store separate records without automatic sync.

## Upgrade and URL Migration

Existing production records at this address are read compatibly rather than reset for the new design. Reading old data does not itself write; the next successful save upgrades the local storage envelope. Existing creation timestamps may remain as compatibility fields without display; new nodes do not collect a separate creation time.

The local envelope advances to version 2, and the new client can read versions 1 and 2. Old-version tabs still open must refresh before editing upgraded data; they cannot overwrite the new seat records. Business JSON continues to use compatible `schemaVersion: 1`, which is separate from the local envelope version.

Different URLs use separate local storage. To move from the old ChatGPT-hosted site, export from its original browser or Home Screen entry, import at this address, and check the tree and history. Old Home Screen icons retain the previous URL and need to be replaced.

## Local Storage and Offline Limits

Ordinary same-origin tabs can share records. Different devices, browsers, private windows, origins, and Home Screen entries cannot be assumed to share them. Friends opening the same URL use their own spaces and cannot see your rules.

Static hosting serves the application; runtime does not send policy or seat text. First access and an unprepared cache require a network connection. Application caching and personal-data storage are separate. Clearing or reclaiming browser storage requires a previously exported JSON for recovery; there is no server copy. See [WebKit's storage explanation](https://webkit.org/blog/14403/updates-to-storage-policy/).

Users choose when to apply updates and should save forms before refreshing. Updates retain records; exporting beforehand remains sensible.

The app charges no membership fee and has no paid cloud-sync dependency. Hosting and network availability still depend on the environment. The user confirmed access to the current address; this does not guarantee every region or provider.

## Development and Validation

From `safari/`:

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Build includes TypeScript checks and outputs static files to `dist/`. The default deploys at a domain root. For the GitHub Pages project path:

```sh
POLICY_TREE_BASE=/policy-tree-safari/ npm run build
```

Validate Service Worker behavior against a production build and HTTPS. Do not double-click `dist/index.html` as an installation entry. GitHub Actions keeps publishing to the original address.

Local validation on October 18, 2026: **82/82 tests passed**, as did TypeScript checking and the GitHub project-path production build. The desktop in-app browser at `390 × 844` verified selection, explicit parenting, day-1 counting, content changes, node collapse, per-seat drafts/precedents, and independent chains. A downloaded JSON restored 5 policies and 2 seats into an empty local entry. Reload worked after stopping the server; an offline record survived another reload, and a Service Worker update retained existing data.

These are local results, not an online release record. Physical iPhone Home Screen installation, system sharing, and file recovery have not been device-tested; a simulated viewport is not a substitute.

This directory is the current implementation; `../web/` and `../wechat/` are historical versions.

History refinement validation: the UI displayed activation, an actual content edit, and a reflection while hiding legacy operation noise. Node changes use the same filter. The JSON downloaded through the browser retained all 11 raw events while the UI displayed 3.
