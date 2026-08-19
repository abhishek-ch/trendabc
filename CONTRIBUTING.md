# Contributing to TrendABC

Contributions are welcome. This is a small project — keep changes small too.

## Get it running

```bash
pnpm install
pnpm dev            # Chrome
pnpm dev:firefox    # Firefox
```

`pnpm dev` cannot open the browser for you: Chrome 137+ ignores
`--load-extension`. Load it once by hand at `chrome://extensions` → Developer
mode → Load unpacked. `pnpm load` prints the folder to pick.

## Before you open a pull request

```bash
pnpm test           # both suites
pnpm build          # Chrome
pnpm build:firefox  # Firefox
```

Both builds must succeed and all tests must pass.

`tests/sources.test.mjs` hits the live APIs. `tests/extension.test.mjs` loads
the real built extension into a real Chrome and drives it. Neither is mocked,
apart from the AI call, which uses a canned response so tests cost nothing.

Two things about the test harness worth knowing before you trust a red test:

- It runs a **cold, cookie-less Chrome profile**. Sites that tolerate a normal
  signed-in browser can refuse it — Reddit especially. A failure there is
  evidence about the harness first.
- Live sources rate limit. A 429 is not a regression. Wait a minute and re-run.

## House style

- Vanilla JavaScript. No framework, no CSS library.
- Prefer deleting code to adding it. If a few lines will do, use a few lines.
- A new dependency needs a reason a few lines of your own could not cover.
- Comments explain **why**, not what. If a workaround exists because a browser
  or an API forced it, say so — those are the comments that save the next
  person an afternoon.
- Match the surrounding code. It is boring on purpose.

## Adding a source

Most useful contributions are new boards. One goes in `lib/sources.js` as a
function returning rows, plus an entry in the `BOARDS` map in
`entrypoints/newtab/main.js`. Roughly 30 lines.

If the source publishes RSS you may not need any code at all — paste the URL
into Settings → RSS feeds.

Please include a test in `tests/sources.test.mjs` that hits the real endpoint.
Scraped sources especially: that test is how we learn the markup changed.

## Reporting bugs

Say what you saw, what you expected, your browser and version, and which board
or provider was involved. A screenshot beats a description. If a source failed,
the board header and its message are the useful part.

## Scope

TrendABC is a reading surface. It is not a client for posting, voting, or
replying anywhere, and it will not grow into one.
