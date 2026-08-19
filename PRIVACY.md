# Privacy Policy — TrendABC

Last updated: 19 August 2026

TrendABC is a browser extension that displays public developer-news content and,
at your request, sends selected content to an AI provider you choose.

## What is collected

**Nothing is collected by TrendABC.** There is no server, no analytics, no
telemetry, no crash reporting, and no account. The developer of this extension
receives no data of any kind about you or your usage.

## What is stored, and where

All of it stays on your device, in the browser's extension storage
(`storage.local`). None of it is synced to Google, Mozilla, or anyone else.

- Your settings: topics, subreddits, RSS feed URLs, open boards, chosen provider
  and model.
- **API keys** for the AI provider you configure.
- An **optional Reddit access token**, only if you choose to connect a Reddit
  account.
- Cached content fetched from the news sources, refreshed roughly every 30
  minutes.
- Summaries and chat threads you have generated, kept until you remove the
  extension.

Removing the extension deletes all of it.

## What is transmitted, and to whom

**News sources.** The extension fetches public listings from github.com,
hn.algolia.com, reddit.com, lobste.rs, export.arxiv.org, huggingface.co, and any
RSS feed you add. These are ordinary read requests. No personal information is
attached.

**AI providers.** When *you* click summarise or send a message, the extension
sends the item's title, URL, page text, and any related discussion to the
provider you selected — Anthropic, OpenAI, or OpenRouter — authenticated with
your own API key. This happens only on your explicit action. Nothing is sent in
the background, and nothing is sent automatically. That provider's own privacy
policy and data-retention terms then apply.

**Reddit.** If you connect a Reddit account, the extension uses the resulting
token to read listings on your behalf. It never posts, votes, or comments.

## Article access

Reading an article's text requires permission for that website, which is
requested the first time you summarise something. You can decline: summaries
still work from the title, the metrics and the discussion thread.

## Your control

- Delete a stored key at any time from Settings.
- Disconnect Reddit at any time from Settings, and revoke the app at
  [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps).
- Remove the extension to erase everything it has stored.

## Contact

Open an issue on the project's GitHub repository.
