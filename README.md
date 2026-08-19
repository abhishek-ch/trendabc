# TrendABC

What's trending across GitHub, Hacker News, Reddit, Lobsters and arXiv — in the
tab you already open a hundred times a day. Then ask an AI about any of it,
using your own API key.

Chrome and Firefox from one source tree. MIT licensed.

**Repository:** https://github.com/abhishek-ch/trendabc *(replace with the real URL)*

---

## Why this exists

I used [devo](https://github.com/karakanb/devo) for years and it stopped being
maintained. I wanted the same thing — a new tab that shows me what's happening —
so I built it.

It is not a clone. Reading devo's source changed the design in two ways:

- **devo depends on a server.** Its GitHub and Hacker News columns fetch
  pre-scraped JSON from the author's own host. When that box goes away, those
  columns go with it. TrendABC talks to every source directly from your browser.
  Nothing sits in the middle.
- **devo shows you sources. TrendABC also shows you signal.** *Boards* is the
  familiar column view. *Signal* merges every board, deduplicates by URL, and
  ranks — so a story on Hacker News *and* Lobsters *and* GitHub rises, marked
  `corroborated`.

Then there's the part devo never had: click anything and summarise it, or just
ask about it, with your own key.

## Vibe coded

Worth saying plainly, since you might run this on your own machine.

**This was vibe coded.** Nearly all of it was written by Claude, in
conversation, in a couple of sittings. I directed it, used it, complained when
it was wrong, and shipped it. I did not hand-review every line.

What that means for you:

- It works, and it is tested — 39 tests drive the real built extension in a real
  Chrome against live APIs. That is not a substitute for a careful human read.
- Your API keys live in `storage.local` and go only to the provider you chose.
  You can verify that yourself: it is one file, [`lib/llm.js`](lib/llm.js).
- The scraping and parsing will break when a source changes its markup. That is
  expected. The tests are designed to tell you when.
- If you would rather not run AI-written code that holds an API key, that is a
  completely reasonable position. Read it first — it is about 1,800 lines.

Contributions, hand-written or otherwise, are welcome.

---

## Install

Not in the stores yet, so it has to be loaded unpacked. Chrome only runs
extensions Google has signed, so until it is published this is developer-mode
only — see [PUBLISHING.md](PUBLISHING.md).

```bash
pnpm install
pnpm build            # → .output/chrome-mv3
pnpm build:firefox    # → .output/firefox-mv3
```

**Chrome, Edge, Brave** — `chrome://extensions` → turn on Developer mode →
**Load unpacked** → pick `.output/chrome-mv3`. `pnpm load` prints the path.

**Firefox** — `about:debugging#/runtime/this-firefox` → **Load Temporary
Add-on** → pick `manifest.json` inside `.output/firefox-mv3`.

Open a new tab. **Chrome will ask whether to keep your new tab page changed —
click Keep it**, or Chrome silently reverts and the extension looks broken.

> `pnpm dev` gives you hot reload but cannot open the browser itself: Chrome
> 137+ ignores `--load-extension`. Load it by hand once; rebuilds are picked up.

## Use it

**Boards** — one column per source, unfiltered, whatever is top right now. Close
one with × and the rest immediately share the width; add one from **+ board** and
they divide again. It is `repeat(n, 1fr)`, not a set of preset layouts. Hover any
row for a link straight to the source; clicking the row opens the detail panel.

**Signal** — every board merged, deduplicated, ranked. Scores are not comparable
across sources — GitHub counts stars per day in the thousands, Hacker News counts
points in the hundreds — so each row is normalised against the strongest row on
its own board first. Anything appearing on two sources is marked `corroborated`
and ranks higher. The number is a relative 0–99, not an absolute.

**Archive** — every summary you have paid for, searchable, free to reopen.

Topic chips filter Signal only. Boards stay unfiltered — that is the point of them.

## Sources

| Board | How | Account |
|---|---|---|
| GitHub | scrapes `github.com/trending` — no API has ever existed | no |
| Hacker News | Algolia front page, plus full comment trees | no |
| Show HN | same API, `tags=show_hn` | no |
| Lobsters | `lobste.rs/hottest.json` | no |
| arXiv | the API — its RSS only carries announcement dates, not submission dates | no |
| Blogs | RSS, one URL per line in Settings | no |
| Reddit | public Atom feeds | no |

Adding a blog needs no code: paste its feed URL into Settings.

**Reddit** reads public feeds and needs no account. Those feeds refuse cold
browser profiles with no reddit.com cookies, and Reddit throttles hard, so the
fetcher retries once then says what happened. Connecting an account is an
optional upgrade tucked behind *Connect account* — it swaps in Reddit's OAuth
API, which adds scores and comment counts and reaches private subreddits.

**Feeds live on arbitrary hosts**, so the first time you press **Save** in
Settings, the browser asks for access to those sites. Decline and the Blogs board
says so rather than sitting empty.

## Summaries and chat

Bring your own key: **Anthropic**, **OpenAI**, or **OpenRouter**. Each provider
keeps its own key, so you can switch without re-pasting.

Save a key and TrendABC asks that provider which models your account can actually
reach, rather than shipping a list that goes stale. OpenRouter's catalogue also
carries live per-token prices. Models with no known price say *price unknown*
instead of quietly billing you nothing.

Open anything and ask — no summary required. Answers use the page text plus the
discussion thread where there is one. Enter sends, Shift+Enter is a newline.

Summarising is always a click, never automatic. Each summary is cached forever;
reopening from Archive is free. Today's spend sits in the header, computed from
the token counts the provider reports.

### Where your data goes

- **Keys** live in `storage.local`. Never `storage.sync`, so they are never
  uploaded to Google or Mozilla. They go only to the provider you picked.
- **Page text** is sent to that provider when *you* click summarise or ask.
  Nothing is sent in the background.
- **Nothing is collected by this extension.** There is no server, no analytics,
  no telemetry. There is nowhere for your data to go that you did not choose.

Reading an article needs permission for that site, requested the first time you
summarise something. Decline and the summary still runs — from the title,
metrics and discussion instead of the page body.

## Tests

```bash
pnpm test           # both suites
pnpm test:sources   # live endpoints, Node
pnpm test:ui        # the built extension in a real Chrome
```

`tests/extension.test.mjs` loads the actual build into Chrome and drives it: 39
tests covering boards, layout, ranking, panel, chat, settings, key persistence,
streaming, archive, theming, and markup injection from hostile source titles.
Only the AI call is stubbed — a canned SSE body exercises the streaming parser
without spending anything.

The GitHub test is the one that matters most: it fails the day GitHub changes
their trending markup.

Two Chrome facts the harness works around, documented in `tests/harness.mjs`:
`--load-extension` is ignored in Chrome 137+, and Puppeteer passes
`--disable-extensions` unless you set `enableExtensions: true`.

## Layout

```
entrypoints/newtab/   the page: boards, signal, archive, panel, settings
public/fonts/         self-hosted type — the new tab makes no third-party request
lib/sources.js        one fetcher per source, all returning a common shape
lib/llm.js            streaming client over three providers
lib/extract.js        article text, outbound links, HN comments
lib/store.js          storage.local wrappers and the board cache
lib/reddit-auth.js    optional Reddit OAuth
```

There is no background service worker. Chrome's MV3 worker has no `DOMParser`,
which the GitHub scrape and RSS both need, and Firefox has no offscreen
documents to work around it. Fetching happens in the new-tab page, which opens
often enough to keep the 30-minute cache warm.

## Publishing

[PUBLISHING.md](PUBLISHING.md) is a step-by-step walkthrough of both stores — permission
justifications, the privacy declarations Chrome requires, and the source-code
upload Firefox rejects you for skipping. [PRIVACY.md](PRIVACY.md) is the policy
both stores ask for.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New sources are the most useful thing to
add and take about 30 lines.

## Licence

[MIT](LICENSE). Do what you like with it.

`mock.html` is the original clickable prototype, kept as the design reference the
UI was built from.
