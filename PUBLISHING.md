# Publishing TrendABC

Everything you need to get this into both stores. Do Firefox first — it is free,
faster, and its reviewers catch things Chrome's do not.

## Can you skip the stores and just ship from GitHub?

For Chrome, no. For Firefox, yes.

**Chrome only runs extensions Google has signed, and Google only signs what goes
through the Web Store.** Loading a `.crx` from a file or your own server has been
blocked since Chrome 33 on Windows and Chrome 44 on macOS. What is left:

| Route | Who it reaches |
|---|---|
| Chrome Web Store — **Public** | Anyone. Searchable. |
| Chrome Web Store — **Unlisted** | Anyone with the direct link. Not searchable. Same $5, same review. |
| Load unpacked, Developer mode | Only people willing to clone, build, and re-enable it. Chrome nags at every startup. |
| Enterprise policy force-install | Only machines your organisation manages. |

So "download it from GitHub" is a developer distribution channel, not a user one.
Anyone who is not comfortable with `chrome://extensions` will not install it.
This is why devo is in the store rather than telling people to build it — and it
is the same reason to publish TrendABC there.

**Unlisted is the useful middle step.** Pay the $5, submit, publish unlisted,
and you get a real install link to hand to a few people before going public. The
review still happens, so it also flushes out permission objections early.

**Firefox is genuinely different.** Mozilla will sign an add-on you then host
yourself:

```bash
# Get API credentials at addons.mozilla.org/developers/addon/api/key/
npx web-ext sign --source-dir .output/firefox-mv3 \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET" \
  --channel unlisted
```

That returns a signed `.xpi` you can attach to a GitHub release, and users install
it straight from there. It still passes through Mozilla's signing, but it never
appears in the AMO catalogue. `--channel listed` publishes it publicly instead.

Unsigned add-ons only load in Firefox Developer Edition, Nightly, or ESR with
`xpinstall.signatures.required` disabled — not in normal Firefox.

---

```bash
pnpm zip            # → .output/trendabc-0.1.0-chrome.zip
pnpm zip:firefox    # → .output/trendabc-0.1.0-firefox.zip
                    #   + .output/trendabc-0.1.0-sources.zip
```

Before either submission, bump `version` in `package.json`. Both stores reject a
version number that has already been uploaded, and neither lets you reuse one
after a rejection.

---

## Firefox — addons.mozilla.org

Free. No registration fee. Usually reviewed within a day or two.

1. Sign in at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/)
2. **Submit a New Add-on** → *On this site* (listed publicly)
3. Upload `trendabc-0.1.0-firefox.zip`
4. **Upload `trendabc-0.1.0-sources.zip` when asked for source code.** This is
   required, not optional: the build is bundled by Vite, so reviewers cannot read
   the shipped file. Skipping it gets you rejected.
5. Build instructions for the reviewer — paste this:

   ```
   Node 22, pnpm 10.
   pnpm install --frozen-lockfile
   pnpm build:firefox
   Output: .output/firefox-mv3
   ```

6. Fill in the listing (see **Store listing copy** below)
7. Submit

The manifest already declares `browser_specific_settings.gecko.id` and
`data_collection_permissions`, both of which AMO requires. Confirm zero errors
before you upload:

```bash
npx web-ext lint --source-dir .output/firefox-mv3
```

**Updating later:** bump the version, `pnpm zip:firefox`, upload both zips again
under the same add-on.

---

## Chrome Web Store — step by step

Budget: **$5 once**, about 40 minutes of form filling, then days to a couple of
weeks of waiting. The permissions here put this at the slower end.

### Step 0 — before you touch the console

These are the things that actually get extensions rejected. All but two are
already done.

- [x] **No unused permissions.** `alarms` was declared and never called; it has
      been removed. Reviewers check this and reject for it.
- [x] **No remote code.** Fonts are self-hosted in `public/fonts/`. The new tab
      makes zero third-party requests at load.
- [x] **Icons** at 16/32/48/96/128 in `public/`.
- [x] **Screenshots** at exactly 1280×800 in `store/screenshots/` — regenerate
      any time with `pnpm shots`.
- [ ] **Privacy policy at a public URL.** `PRIVACY.md` exists; it needs to be
      reachable over HTTPS. Easiest: push the repo public, enable GitHub Pages,
      and use `https://abhishek-ch.github.io/trendabc/PRIVACY`. A raw GitHub URL works
      too.
- [ ] **Placeholder URLs replaced** — `REPO` in `entrypoints/newtab/main.js`,
      and `repository` / `homepage` / `bugs` in `package.json`.

Then build the upload:

```bash
pnpm test        # must be green
pnpm build
pnpm zip         # → .output/trendabc-0.1.0-chrome.zip
```

### Step 1 — register (one time, $5)

1. Go to [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
2. Sign in with the Google account that should **own** this extension forever.
   Transferring later is painful — do not use a throwaway.
3. Pay the $5 developer registration fee. One time, covers the account, not
   per-extension.
4. Fill in your developer account details. **A contact email is mandatory and
   must be verified**, or you cannot publish.

### Step 2 — create the item

1. **Add new item**
2. Drag in `.output/trendabc-0.1.0-chrome.zip`
3. It parses the manifest and creates a draft. Nothing is public yet.

### Step 3 — Store listing tab

| Field | What to enter |
|---|---|
| Name | `TrendABC` |
| Summary | `What's trending on GitHub, Hacker News, Reddit and arXiv — in one tab. Summarise anything with your own AI key.` |
| Description | the block under **Store listing copy** below |
| Category | **Productivity** |
| Language | English |

**Screenshots** — upload all five from `store/screenshots/`, in this order. The
first is what people see in search results, so it leads with the product:

1. `1-boards.png` — the columns
2. `2-signal-ranked.png` — merged and ranked
3. `3-summary.png` — a summary streaming in
4. `4-dark.png` — dark theme
5. `5-settings.png` — bring your own key

**Store icon** — 128×128, use `public/icon-128.png`.

**Small promo tile** — 440×280, optional. It affects whether you can be
featured. Skip it for v0.1.

### Step 4 — Privacy tab (this is where submissions die)

**Single purpose** — paste exactly:

> Replace the new tab page with a view of what is currently trending across
> developer news sources, and let the user summarise or ask questions about any
> item using their own AI provider API key.

**Permission justifications** — one box per permission. Copy these:

| Permission | Paste this |
|---|---|
| `storage` | Stores the user's settings, cached source listings, and saved summaries locally on their device. |
| `unlimitedStorage` | Saved summaries accumulate without bound over time and would otherwise hit the default quota. |
| `identity` | Optional Reddit sign-in through Reddit's own OAuth consent screen, so the user can read their subscribed and private subreddits. Never invoked unless the user explicitly chooses to connect an account. |
| `declarativeNetRequestWithHostAccess` | Removes the cross-origin Origin header from requests to reddit.com only, because Reddit's bot filter rejects requests carrying it. The rule is static, declared in reddit-rules.json, and matches no other host. |
| Host permissions — github.com, hn.algolia.com, reddit.com, lobste.rs, export.arxiv.org, huggingface.co | These are the news sources the extension displays. All access is read-only and the content is public. |
| Host permissions — api.anthropic.com, api.openai.com, openrouter.ai | The AI providers the user may choose between. Requests are made only with the user's own API key and only when the user clicks summarise or sends a message. |
| Optional host permission `*://*/*` | Requested at runtime, only when the user asks for a summary of a specific article, so the extension can read that one page's text. Never requested at install time. |

**Data usage** — declare exactly these two, and nothing else:

- ☑ **Website content** — "Page text of an article is sent to the AI provider
  the user selected, only when the user clicks summarise or sends a message."
- ☑ **Authentication information** — "The user's own AI provider API key and
  optional Reddit token, stored locally on their device and never transmitted
  anywhere except to the service they belong to."

Leave everything else unticked. No personally identifiable information, no
location, no health, no financial, no personal communications, no web history,
no user activity.

Then tick all three certifications — all three are true here:

- ☑ I do not sell or transfer user data to third parties, outside of approved use cases
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL** — required because you declared data collection above.
Paste the public URL of `PRIVACY.md`.

> **Do not claim you collect nothing.** The extension stores API keys and
> transmits page text. Declaring that plainly is what passes review; a mismatch
> between your declaration and what the code does is the fastest rejection.

### Step 5 — Distribution tab

- **Visibility: Unlisted** for the first submission. It still gets fully
  reviewed, so permission objections surface, but it is not in search while you
  find the rough edges. Anyone with the link can install it.
- Regions: all
- **Submit for review**

Flip to **Public** later from the same tab; that flip needs another short review.

### Step 6 — after submitting

- Status shows **Pending review**. Days is normal; the optional `*://*/*`
  permission can push it to a couple of weeks.
- If rejected you get an email naming the policy section. Fix it, **bump the
  version in `package.json`**, `pnpm zip`, and upload again. A version number
  that has already been submitted cannot be reused.
- Once approved, the install link is
  `https://chromewebstore.google.com/detail/trendabc/<your-extension-id>`. Put
  it at the top of the README.

### Things reviewers may come back on

| Question | Answer |
|---|---|
| Why override the new tab page? | That is the product. The content is the new tab. |
| Why request access to all sites? | Optionally, at runtime, only to read the article the user asked to summarise. It is not in `host_permissions`; it is `optional_host_permissions` and requested on click. |
| Is there a backend? | No. No server, no analytics, no telemetry. Every request goes from the user's browser to the source or to their own AI provider. |
| Whose API key is used? | The user's. None is bundled. Without a key, the summarise and chat features simply do not run. |
| Why modify request headers? | One static rule stripping `Origin` for reddit.com, because Reddit rejects requests carrying it. No other host is touched, and nothing is blocked or redirected. |

---

## Store listing copy

Same text works for both.

**Name:** TrendABC

**Summary (132 chars max):**
> What's trending on GitHub, Hacker News, Reddit and arXiv — in one tab. Summarise anything with your own AI key.

**Description:**
> TrendABC turns your new tab into a view of what is happening across developer
> news, right now.
>
> BOARDS — one column per source: GitHub Trending, Hacker News, Show HN,
> Lobsters, Reddit, arXiv, and any RSS feed you add. Close a column and the rest
> share the width. Add one and they divide again.
>
> SIGNAL — every board merged, deduplicated and ranked, so a story appearing on
> several sources at once rises to the top and is marked corroborated.
>
> ASK ANYTHING — click any item to summarise it or ask questions about it, using
> your own API key for Anthropic, OpenAI or OpenRouter. Summaries are cached
> forever and free to reopen. Your key is stored locally and is sent to nobody
> but the provider you chose.
>
> No account required. No server. No tracking. No telemetry. Open source, MIT
> licensed.

**Category:** Productivity (Chrome) · Other (Firefox)

**Assets** — all generated, nothing left to draw:

- **Screenshots**: five at exactly 1280×800 in `store/screenshots/`. Rebuild any
  time with `pnpm shots` — it drives the real extension, stubs only the AI call,
  and resamples from 2× so the text stays sharp.
- **Icons**: 16/32/48/96/128 in `public/`.
- **Promo tile** (440×280) is the one optional asset not generated. It only
  affects the chance of being featured.

---

## Before you submit either

- [ ] `REPO` in `entrypoints/newtab/main.js` points at the real repository
- [ ] `repository`, `homepage` and `bugs` in `package.json` are real URLs
- [ ] The GitHub URL in `README.md` is real
- [ ] `version` bumped in `package.json`
- [ ] `pnpm test` passes
- [ ] `npx web-ext lint --source-dir .output/firefox-mv3` reports zero errors
- [ ] `PRIVACY.md` published somewhere with a stable URL
