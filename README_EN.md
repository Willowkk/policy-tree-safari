# Policy Tree · Safari Local Edition

[简体中文](README_CN.md) · [Product design](../design/v0.1/DESIGN_EN.md)

This is a responsive PWA with no login. Policies and history stay in the current browser on your device. You can export and import JSON backups. The app does not upload policy data or require a cloud sync database, ChatGPT, QQ, or WeChat login.

Published URL: [Open Policy Tree](https://willowkk.github.io/policy-tree-safari/).

## Moving from the previous URL

Different origins have separate local storage. Export JSON from the old browser or Home Screen entry first. Open the new URL, add it to the Home Screen, then import the backup from the new entry. Check policies and history before using the new icon daily; the old icon continues to open the previous URL.

Friends use independent data on their own devices and cannot see your policies. GitHub Pages hosting is free, but mainland China availability needs actual network testing and is not guaranteed across providers or regions.

## Use it on iPhone

1. Connect to the internet and open the published URL in Safari.
2. Open Share and select “Add to Home Screen.” If “Open as Web App” is shown, enable it, then tap Add. See [Apple's instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios).
3. Open the Home Screen icon once while online so the app can prepare its offline cache.
4. With the cache available, you can read, edit, activate policies, record violations, and reflect offline.

Add the app to the Home Screen before starting your main records. A Safari tab and the Home Screen app may have separate storage. If your existing records do not appear, export a backup from the original entry point and import it into the new one. Adding to the Home Screen is not a backup. It requires no Apple Developer Program membership or recurring seven-day signing renewal.

On Mac, use a browser, or add the website to the Dock in a supported Safari version. See [Apple's Mac instructions](https://support.apple.com/104996). Modern Windows browsers can open the same responsive app. Each device stores its own data.

## Daily workflow

- Prepare policies when convenient with a name and a free-text rule. Save incomplete ideas as drafts.
- Choose one Ready policy as Today's Trial. After practicing it successfully, confirm its parent and activate it.
- Each local data space uses **midnight in Asia/Shanghai (Beijing time)** as the daily boundary. Activate at most one policy per day; daily activation is optional. Returning a policy on its activation day does not restore the allowance.
- An in-app replenishment prompt appears below 5 Ready policies. Drafts, Today's Trial, and Returned policies do not count as Ready.
- Preview the affected branch before recording a violation. The violated node and its Active descendants return to the library; ancestors and siblings remain Active, and history is retained.
- Write a free-text reflection, revise a Returned policy, and prepare it for another attempt.

A successful local save makes an activation formal, including offline. There is no cloud confirmation step. Failed saves show an error and must not be presented as completed operations. There are no scheduled reminders, calendar reminders, or system push notifications.

## Export and restore

Choose “Export backup” in Settings and keep the generated JSON file. On iPhone, use “Save to Files” if the system share sheet appears. If the file downloads, locate it in Safari's download list or the Files app. Export after substantial edits, before changing devices, and before clearing website data.

To restore or transfer records, open “Settings → Import backup” in the destination browser or app, choose the JSON file, and confirm.

Import merges records by ID:

- New policies and history events are added.
- Policies and events whose IDs already exist retain their current local contents. Older backup versions do not overwrite them.
- Incompatible formats, tree relationships, or same-day activation histories cause the entire import to be rejected while current data remains intact. Read the error before retrying.
- Compatible snapshots from the earlier cloud PWA can migrate saved records. Old queued operations are not replayed, pending activations do not become Active automatically, and reminder settings are not migrated.

Import supports recovery and adding records; **it is not two-way synchronization**. Editing a policy on a computer and importing it back into an iPhone does not replace that iPhone's existing policy with the same ID. Keep one primary place for daily use. Importing a full backup into an empty data space is the clearest way to restore on a new device.

Backup files contain the full text of policies and reflections. Store them somewhere you trust. Saving them to iCloud Drive or another service is your choice; the app does not upload them automatically.

## Local storage boundaries

Ordinary tabs in the same browser, at the same origin and within the same browser profile, share local records. Different devices, browsers, private windows, URLs, and Home Screen apps may have separate data spaces and do not synchronize. The daily activation allowance applies within one local data space; it cannot verify independent copies across devices.

The first visit and an unprepared offline cache require connectivity. If website data is cleared or reclaimed, there is no server copy to restore. Recovery requires a backup you previously exported. See [WebKit's storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

The public URL serves the application. Someone else opening it sees records from their own browser, not yours. Loading files and checking for updates still request program assets from the host; runtime requests do not send policy contents.

The app charges no membership fee and has no paid cloud sync dependency. Static hosting policies and availability can change, so permanent free hosting and permanent browser storage are not guaranteed.

## Updates

When an update is available, choose “Update now” or “Later.” Save your current edits first. Updates do not forcibly reload a page while you are writing. Application caches and personal records are handled separately; exporting a backup before updating remains useful.

## Run and build locally

From `safari/`:

```sh
npm install
npm run dev
```

Other commands:

```sh
npm test
npm run build
npm run preview
```

The production build creates static files in `dist/`, suitable for HTTPS static hosting. Offline caching uses a Service Worker. The development server does not represent production offline behavior; verify the built preview and actual HTTPS deployment. Opening `dist/index.html` directly from the file system is not the installation path.

This directory is the current main version. `../web/` and `../wechat/` retain historical implementations. 56 automated tests pass. Creation, activation, reload and offline startup after stopping the server have been checked in a desktop browser. System sharing and Home Screen installation have not yet been tested on a physical iPhone.
