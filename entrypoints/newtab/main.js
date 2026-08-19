import * as src from '../../lib/sources.js';
import * as db from '../../lib/store.js';
import { PROVIDERS, estimate, stream, listModels, SYSTEM } from '../../lib/llm.js';
import { buildPrompt, ensureAccess } from '../../lib/extract.js';
import { connect as redditConnect, validToken, whoami, redirectURL } from '../../lib/reddit-auth.js';
import { browser } from 'wxt/browser';

// Swap this for the real repository URL once it is published.
const REPO = 'https://github.com/abhishek-ch/trendabc';

const $ = s => document.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
// Quotes matter as much as angle brackets: inline() builds href attributes out
// of summary text, and titles arrive from GitHub, Reddit and arbitrary feeds.
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const n0 = v => (Number.isFinite(Number(v)) ? Number(v).toLocaleString() : '—');
const ago = ts => {
  if (!ts) return 'trending';
  const m = Math.max(0, (Date.now() - ts) / 60000);
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

let S;                       // settings from storage
const rows = {};             // board id -> { rows, at, stale, error }
const ui = { view: 'boards', open: null, filters: new Set(), archive: [] };

// ---------------------------------------------------------------- boards
const BOARDS = {
  gh: {
    name: 'GitHub', mark: 'GH', color: '#1F2328', kind: 'repo',
    params: { since: 'daily', language: '' },
    controls: [
      { key: 'since', options: [['daily', 'today'], ['weekly', 'this week'], ['monthly', 'this month']] },
      { key: 'language', options: [['', 'all languages'], ['python', 'Python'], ['typescript', 'TypeScript'], ['rust', 'Rust'], ['go', 'Go'], ['c++', 'C++']] },
    ],
    fetch: p => src.githubTrending(p),
  },
  hn: {
    name: 'Hacker News', mark: 'Y', color: '#FF6600', kind: 'story',
    params: { tags: 'front_page' },
    controls: [{ key: 'tags', options: [['front_page', 'front page'], ['story', 'new'], ['show_hn', 'show hn'], ['ask_hn', 'ask hn']] }],
    fetch: p => src.hackerNews(p),
  },
  rd: {
    name: 'Reddit', mark: 'R', color: '#FF4500', kind: 'post',
    params: { sub: '', t: 'day' },
    controls: [
      { key: 'sub', subs: true },
      { key: 't', options: [['day', 'top today'], ['week', 'top week'], ['hour', 'top hour']] },
    ],
    // An empty sub means every tracked one at once — Reddit joins them with "+".
    fetch: async p => src.reddit({
      ...p,
      sub: p.sub || S.subs.join('+'),
      token: await redditToken(),
    }),
  },
  lb: {
    name: 'Lobsters', mark: 'L', color: '#A6704A', kind: 'story',
    params: { list: 'hottest' },
    controls: [{ key: 'list', options: [['hottest', 'hottest'], ['newest', 'newest']] }],
    fetch: p => src.lobsters(p),
  },
  ax: {
    name: 'arXiv', mark: 'AX', color: '#A6231C', kind: 'entry',
    params: { cat: 'cs.AI' },
    controls: [{ key: 'cat', options: [['cs.AI', 'cs.AI'], ['cs.CL', 'cs.CL'], ['cs.LG', 'cs.LG'], ['stat.ML', 'stat.ML']] }],
    fetch: p => src.arxiv(p.cat, 40),
  },
  sh: {
    name: 'Show HN', mark: 'S', color: '#FF6600', kind: 'story',
    params: { tags: 'show_hn' }, controls: [],
    fetch: p => src.hackerNews(p),
  },
  rss: {
    name: 'Blogs', mark: 'RS', color: '#E8843C', kind: 'entry',
    params: {}, controls: [],
    fetch: async () => {
      const settled = await Promise.allSettled(S.feeds.map(f => src.feed(f)));
      const ok = settled.filter(r => r.status === 'fulfilled');
      if (!ok.length) {
        throw new Error(S.feeds.length
          ? 'No feed could be read. Open Settings and press Save to grant access to these sites.'
          : 'No feeds configured. Add some in Settings.');
      }
      const rows = ok.flatMap(r => r.value).sort((a, b) => b.ts - a.ts).slice(0, 40);
      const failed = settled.length - ok.length;
      if (failed) rows.note = `${failed} feed${failed > 1 ? 's' : ''} unreadable`;
      return rows;
    },
  },
};

async function loadBoard(id, { force = false } = {}) {
  const b = BOARDS[id];
  if (!force) {
    const hit = await db.cached(id);
    if (hit) { rows[id] = hit; if (!hit.stale) return; }
  }
  try {
    const got = await b.fetch(b.params);
    rows[id] = { rows: got, at: Date.now(), stale: false, error: null };
    await db.putCache(id, got);
  } catch (e) {
    rows[id] = { ...(rows[id] ?? { rows: [] }), error: e.message };
  }
}

function boardRow(id, r) {
  const b = BOARDS[id];
  const n = el('article', 'brow'); n.tabIndex = 0;
  const done = ui.archive.some(a => a.id === r.id) ? '<span class="sumdot">● summarised</span>' : '';
  if (b.kind === 'repo') {
    n.innerHTML = `<p class="rt"><span class="own">${esc(r.owner)} /</span> ${esc(r.name)}</p>
      ${r.desc ? `<p class="rd">${esc(r.desc)}</p>` : ''}
      <div class="rm">
        ${r.lang ? `<span class="lang"><i style="background:${langColor(r.lang)}"></i>${esc(r.lang)}</span>` : ''}
        <span>★ ${n0(r.stars)}</span><span>⑂ ${n0(r.forks)}</span>${done}
        ${r.today ? `<span class="today">+${n0(r.today)} today</span>` : ''}</div>`;
  } else if (b.kind === 'story') {
    let host = ''; try { host = new URL(r.url).host.replace(/^www\./, ''); } catch {}
    n.innerHTML = `<p class="rt">${esc(r.title)} <span class="dom">(${esc(host)})</span></p>
      <div class="rm"><span>${n0(r.points)} points</span><span>${esc(r.by)}</span>
        <span>${ago(r.ts)}</span><span>${n0(r.comments)} comments</span>${done}</div>`;
  } else if (b.kind === 'post') {
    n.innerHTML = `<p class="rt">${esc(r.title)}</p>
      ${r.preview ? `<p class="rd">${esc(r.preview)}</p>` : ''}
      <div class="rm"><span>r/${esc(r.sub)}</span>
        ${r.ups == null ? `<span>${esc(r.by)}</span>` : `<span>▲ ${n0(r.ups)}</span>`}
        ${r.comments == null ? '' : `<span>${n0(r.comments)} comments</span>`}
        <span>${ago(r.ts)}</span>${done}</div>`;
  } else {
    n.innerHTML = `<p class="rt">${esc(r.title)}</p>
      ${r.desc ? `<p class="rd">${esc(r.desc.slice(0, 180))}…</p>` : ''}
      <div class="rm"><span>${esc(r.author || r.site)}</span><span>${ago(r.ts)}</span>
        ${r.revised ? `<span>revised ${ago(r.revised)} ago</span>` : ''}${done}</div>`;
  }
  const link = goLink(r.url);
  if (link) n.append(link);
  const go = () => openItem(r, id);
  n.onclick = go;
  n.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  return n;
}

const LC = { Python: '#3572A5', TypeScript: '#3178c6', Rust: '#dea584', Go: '#00ADD8', 'C++': '#f34b7d', JavaScript: '#f1e05a', Zig: '#ec915c', Java: '#b07219', C: '#555555', Ruby: '#701516' };
const langColor = l => LC[l] ?? 'var(--line-strong)';

// Clicking a row opens the panel. This is the way straight to the source,
// without changing that.
function goLink(url) {
  if (!url) return null;
  const a = document.createElement('a');
  a.className = 'golink';
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  let host = url; try { host = new URL(url).host.replace(/^www\./, ''); } catch {}
  a.title = `Open ${host}`;
  a.setAttribute('aria-label', a.title);
  a.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'
    + '<path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>';
  a.onclick = e => e.stopPropagation();   // never also open the panel
  return a;
}

function drawBoards() {
  const w = $('#boards'); w.innerHTML = '';
  const open = S.boards;
  w.style.gridTemplateColumns = open.length
    ? `repeat(${open.length}, minmax(${open.length >= 4 ? 300 : 340}px, 1fr))` : '1fr';
  if (!open.length) { w.append(el('div', 'empty', 'Every board closed. Add one above.')); drawAddMenu(); return; }

  open.forEach(id => {
    const b = BOARDS[id], state = rows[id];
    const col = el('section', 'board');
    const h = el('div', 'bhead', `<span class="bmark" style="background:${b.color}">${b.mark}</span><h3>${b.name}</h3>`);
    const btns = el('div', 'btns');

    b.controls.forEach(c => {
      const sel = document.createElement('select');
      const opts = c.subs
        ? [['', `all my subs (${S.subs.length})`], ...S.subs.map(x => [x, 'r/' + x]), ['__add', '+ add subreddit…']]
        : c.options;
      opts.forEach(([v, label]) => {
        const o = document.createElement('option'); o.value = v; o.textContent = label; sel.append(o);
      });
      sel.value = b.params[c.key] ?? '';
      sel.onchange = () => {
        if (sel.value === '__add') return addSubInline(sel, id);
        b.params[c.key] = sel.value;
        if (isSubs) state && (state.rows = []);
        refresh(id, col);
      };
      btns.append(sel);
    });

    btns.append(el('span', 'bstale', state?.error ? 'failed'
      : state ? (state.stale ? 'stale' : ago(state.at) + ' ago') : 'loading…'));
    const rf = el('button', 'mini', '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>');
    rf.title = 'Refresh this board';
    rf.onclick = () => refresh(id, col);
    const cx = el('button', 'mini x', '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>');
    cx.title = 'Close board';
    cx.onclick = async () => {
      S.boards = S.boards.filter(x => x !== id);
      await db.save({ boards: S.boards });
      drawBoards();
      toast(`${b.name} closed · ${S.boards.length || 'no'} board${S.boards.length === 1 ? '' : 's'} sharing the width`);
    };
    btns.append(rf, cx); h.append(btns); col.append(h);

    const sc = el('div', 'bscroll');
    if (state?.error) {
      // Do not tell them to hit ↻ twice when the message already says so.
      sc.append(el('div', 'empty', esc(state.error)
        + (/↻/.test(state.error) ? ''
           : '<br><span class="mono" style="font-size:11px">Hit ↻ to try again.</span>')));
    } else if (!state) {
      sc.append(el('div', 'empty', 'Fetching…'));
    } else if (!state.rows.length) {
      sc.append(el('div', 'empty', 'Nothing here right now.'));
    } else {
      state.rows.forEach(r => sc.append(boardRow(id, r)));
    }
    col.append(sc); w.append(col);
  });
  drawAddMenu();
}

async function refresh(id, col) {
  col?.classList.add('loading');
  const stale = col?.querySelector('.bstale');
  if (stale) stale.textContent = 'fetching…';
  await loadBoard(id, { force: true });
  drawBoards();
  if (rows[id]?.error) toast(`${BOARDS[id].name}: ${rows[id].error}`);
}

function addSubInline(sel, boardId) {
  const inp = document.createElement('input');
  inp.placeholder = 'subreddit name'; inp.autocomplete = 'off';
  inp.style.cssText = 'background:var(--bg);border:1px solid var(--signal);border-radius:2px;'
    + 'padding:2px 6px;font-family:"IBM Plex Mono",monospace;font-size:10.5px;width:120px';
  sel.replaceWith(inp); inp.focus();
  let settled = false;
  const done = async ok => {
    if (settled) return; settled = true;
    const v = inp.value.trim().replace(/^\/?r\//, '');
    if (ok && v) {
      if (!S.subs.includes(v)) { S.subs.push(v); await db.save({ subs: S.subs }); }
      BOARDS.rd.params.sub = v;
      await loadBoard('rd', { force: true });
      toast(`Tracking r/${v}`);
    }
    drawBoards();
  };
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); };
  inp.onblur = () => done(true);
}

function drawAddMenu() {
  const m = $('#addMenu'); m.innerHTML = '';
  const avail = Object.keys(BOARDS).filter(id => !S.boards.includes(id));
  if (!avail.length) { m.append(el('div', 'none', 'All boards are open.')); return; }
  avail.forEach(id => {
    const b = BOARDS[id];
    const btn = el('button', null, `${b.name}<span>${b.kind}</span>`);
    btn.onclick = async () => {
      S.boards.push(id); await db.save({ boards: S.boards });
      m.classList.remove('on'); drawBoards();
      await loadBoard(id); drawBoards();
      toast(`${b.name} added · ${S.boards.length} columns`);
    };
    m.append(btn);
  });
}

async function redditToken() {
  if (!S.reddit?.access) return null;
  return validToken(S.reddit, async next => {
    S.reddit = next;
    await db.save({ reddit: next });
  });
}

// ---------------------------------------------------------------- signal
// Same story on three sources is the strongest quality signal there is.
const canon = u => { try { const x = new URL(u); return x.host.replace(/^www\./, '') + x.pathname.replace(/\/$/, ''); } catch { return u; } };

function merged() {
  // Raw scores are not comparable across sources — GitHub counts stars per day
  // in the thousands, Hacker News counts points in the hundreds. Normalise each
  // row against the strongest row on its own board first, then combine.
  const peak = {};
  for (const [id, state] of Object.entries(rows))
    peak[id] = Math.max(1, ...(state?.rows ?? []).map(r => r.score || 0));

  const by = new Map();
  for (const [id, state] of Object.entries(rows)) {
    for (const r of state?.rows ?? []) {
      const norm = 0.1 + 0.9 * ((r.score || 0) / peak[id]);
      const k = canon(r.url);
      const hit = by.get(k);
      if (hit) { hit.sources.push({ id, r }); hit.norm += norm; hit.ts = hit.ts ?? r.ts; }
      else by.set(k, { ...r, sources: [{ id, r }], norm });
    }
  }

  const gravity = h => Math.pow(h + 2, 1.5);
  const ranked = [...by.values()]
    .map(i => ({
      ...i,
      // Undated items (GitHub Trending) sit at a neutral age rather than
      // winning or losing the recency term outright.
      rank: i.norm * Math.sqrt(i.sources.length) / gravity(i.ts ? (Date.now() - i.ts) / 36e5 : 10),
    }))
    .sort((a, b) => b.rank - a.rank);

  // The raw rank is a tiny float. Show it as a relative 0-99 signal instead:
  // the number only ever means "how this compares to today's strongest item".
  const top = ranked[0]?.rank || 1;
  return ranked.map(i => ({ ...i, sig: Math.round(99 * i.rank / top) }));
}

// The provider's own list once we have fetched it; our curated one until then.
const catalog = (p = S.provider) => S.models?.[p]?.length ? S.models[p] : PROVIDERS[p].models;
const priceOf = id => catalog().find(m => m.id === id);

const hay = i => (i.title + ' ' + (i.desc ?? '') + ' ' + (i.sub ?? '') + ' ' + (i.lang ?? '')).toLowerCase();

function drawFeed() {
  const f = $('#feed'); f.innerHTML = '';
  let list = merged();
  if (ui.filters.size) list = list.filter(i => [...ui.filters].some(t => hay(i).includes(t.toLowerCase())));
  $('#feedCount').textContent =
    `${list.length} items · ${ui.filters.size ? 'filtered' : 'all topics'} · deduped across ${S.boards.length} sources`;
  if (!list.length) { f.append(el('div', 'empty', 'Nothing yet. Open some boards, or clear the topic filter.')); return; }

  list.slice(0, 60).forEach((it, i) => {
    const r = el('article', 'row' + (ui.open === it.id ? ' is-open' : ''));
    r.style.animationDelay = Math.min(i, 10) * 22 + 'ms';
    r.tabIndex = 0;
    const dots = it.sources.map(() => '<i class="on"></i>')
      .concat(Array(Math.max(0, 3 - it.sources.length)).fill('<i></i>')).join('');
    const saved = ui.archive.some(a => a.id === it.id);
    const multi = it.sources.length > 1;
    r.innerHTML = `
      <div class="sig${it.sig >= 70 ? ' hot' : ''}"><div class="n">${it.sig}</div><div class="dots">${dots}</div></div>
      <div>
        <h3>${esc(it.title)}</h3>
        ${it.desc ? `<p class="blurb">${esc(it.desc.slice(0, 200))}</p>` : ''}
        <div class="tags">
          ${it.sources.map(s => `<span class="src${multi ? ' corr' : ''}"><b>${BOARDS[s.id].mark}</b>${sourceMeta(s)}</span>`).join('')}
          ${multi ? `<span class="src corr">${it.sources.length}× corroborated</span>` : ''}
        </div>
      </div>
      <div class="rowmeta"><span class="age">${ago(it.ts)}</span>
        ${saved ? '<span class="savedmark">summarised</span>' : ''}</div>`;
    const link = goLink(it.url);
    if (link) r.append(link);
    const go = () => openItem(it, it.sources[0].id);
    r.onclick = go;
    r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    f.append(r);
  });
}

function sourceMeta({ id, r }) {
  if (id === 'gh') return `★ ${n0(r.stars)} · +${n0(r.today)}`;
  if (id === 'rd') return r.ups == null ? `r/${esc(r.sub)}` : `r/${esc(r.sub)} · ▲ ${n0(r.ups)}`;
  if (r.points != null) return `${n0(r.points)} pts · ${n0(r.comments)} comments`;
  return esc(r.site ?? '');
}

// ---------------------------------------------------------------- archive
function drawArchive() {
  const w = $('#archive'); w.innerHTML = '';
  const q = $('#arcSearch').value.trim().toLowerCase();
  $('#arcCount').textContent = ui.archive.length || '';
  const hits = ui.archive.filter(a => !q || (a.title + a.summary).toLowerCase().includes(q));
  if (!ui.archive.length) {
    w.append(el('div', 'empty', 'No summaries yet. Open a headline and hit Summarise — it lands here.'));
    return;
  }
  if (!hits.length) { w.append(el('div', 'empty', `Nothing archived matches “${esc(q)}”.`)); return; }
  hits.forEach(a => {
    const n = el('article', 'arc'); n.tabIndex = 0;
    n.innerHTML = `<div class="when">${new Date(a.at).toLocaleString()} · ${esc(a.model)} · $${a.cost.toFixed(3)}</div>
      <h3>${esc(a.title)}</h3><p>${esc(a.summary.replace(/\*\*/g, '').replace(/\n/g, ' '))}</p>`;
    n.onclick = () => { setView('boards'); openItem(a.item, a.board); };
    w.append(n);
  });
}

// ---------------------------------------------------------------- panel
function md(t) {
  return t.split(/\n\n+/).map(block => {
    if (block.trim().startsWith('- '))
      return '<ul>' + block.split('\n').map(l => `<li>${inline(l.replace(/^- /, ''))}</li>`).join('') + '</ul>';
    return '<p>' + inline(block).replace(/\n/g, '<br>') + '</p>';
  }).join('');
}
const inline = t => esc(t)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`(.+?)`/g, '<code class="mono">$1</code>')
  .replace(/(https?:\/\/\S+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

function openItem(item, boardId) {
  ui.open = item.id;
  ui.item = item; ui.board = boardId;
  let host = ''; try { host = new URL(item.url).host.replace(/^www\./, ''); } catch {}
  const marks = item.sources ? item.sources.map(s => BOARDS[s.id].mark) : [BOARDS[boardId].mark];
  $('#pSources').textContent = marks.join(' + ');
  $('#pTitle').textContent = item.title;
  $('#pDom').textContent = host;
  $('#panel').classList.add('on'); $('#panel').setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('on');
  drawPanel(item, boardId);
  if (ui.view === 'feed') drawFeed(); else drawBoards();
}
function closePanel() {
  $('#panel').classList.remove('on'); $('#panel').setAttribute('aria-hidden', 'true');
  $('#scrim').classList.remove('on');
  ui.open = null; ui.item = null;
}

function drawPanel(item, boardId) {
  const b = $('#pBody'); b.innerHTML = '';
  const cached = ui.archive.find(a => a.id === item.id);
  const model = S.model ?? PROVIDERS[S.provider].default;

  const acts = el('div', 'pacts');
  const sum = el('button', 'btn pri', cached ? 'Re-open summary' : 'Summarise');
  const open = el('button', 'btn', 'Open original ↗');
  open.onclick = () => window.open(item.url, '_blank', 'noopener');
  acts.append(sum, open);
  if (item.discussion) {
    const disc = el('button', 'btn', 'Discussion ↗');
    disc.onclick = () => window.open(item.discussion, '_blank', 'noopener');
    acts.append(disc);
  }
  b.append(acts);

  const facts = [];
  if (item.sources?.length > 1) facts.push(`${item.sources.length}× corroborated`);
  for (const s of item.sources ?? [{ id: boardId, r: item }]) facts.push(sourceMeta(s));
  facts.push(ago(item.ts));
  b.append(el('div', 'panelmeta', facts.filter(Boolean).map(f => `<span>${f}</span>`).join('')));

  const out = el('div', 'sum'); b.append(out);

  if (cached) {
    out.innerHTML = md(cached.summary);
    b.append(el('div', 'streamnote',
      `cached ${new Date(cached.at).toLocaleDateString()} · ${esc(cached.model)} · reopening is free`));
  }
  // Chat is always available — you should not have to summarise to ask a question.
  showChat(item, cached?.thread ?? []);

  sum.onclick = () => {
    if (cached) return drawPanel(item, boardId);
    if (!S.keys[S.provider]) return askKey(out);
    // Permission request must fire inside this gesture, before any await.
    const granted = ensureAccess(item.url);
    runSummary(item, boardId, out, b, sum, model, granted);
  };
}

function askKey(out) {
  out.innerHTML = '';
  const p = PROVIDERS[S.provider];
  const model = S.model ?? p.default;
  const n = el('div', 'notice', `<h4>Add your ${p.name} API key first</h4>
    <p>Summaries call ${p.name} straight from this browser with your own key — nothing is proxied through a
    server. ${(() => { const c = estimate(S.provider, model, catalog());
      return c == null ? 'Billed to your account at that model\u2019s rates.'
                       : `Roughly ${(c * 100).toFixed(1)}\u00a2 per summary on this model, billed to your account.`; })()}</p>`);
  const btn = el('button', 'btn pri', 'Open settings');
  btn.onclick = openModal; n.append(btn);
  out.append(n);
}

async function runSummary(item, boardId, out, body, sumBtn, model, granted) {
  sumBtn.disabled = true; sumBtn.textContent = 'Streaming…';
  out.innerHTML = '';
  const note = el('div', 'streamnote', '<span>reading the page…</span><span class="cursor"></span>');
  const text = el('div');
  out.append(note, text);

  try {
    // Never let an unanswered permission prompt hold the summary hostage. If
    // the user ignores it, extraction fails and we summarise from the metadata
    // and the discussion thread instead.
    await Promise.race([granted, new Promise(r => setTimeout(() => r(false), 10000))]);
    const prompt = await buildPrompt(item);
    note.innerHTML = `<span>${esc(model)} · streaming</span>`;

    let acc = '';
    const usage = await stream({
      provider: S.provider, key: S.keys[S.provider], model,
      system: SYSTEM, prompt,
      onToken: t => {
        acc += t;
        text.innerHTML = md(acc) + '<span class="cursor"></span>';
        $('#pBody').scrollTop = $('#pBody').scrollHeight;
      },
    });
    text.innerHTML = md(acc);

    const cost = await bill(model, usage);
    note.innerHTML = `<span>done · ${esc(model)} · ${n0(usage.in ?? 0)} in / ${n0(usage.out ?? 0)} out`
      + `${cost == null ? '' : ` · $${cost.toFixed(4)}`}</span>`;

    const rec = { id: item.id, item, board: boardId, title: item.title, summary: acc,
                  at: Date.now(), model, cost: cost ?? 0, thread: ui.thread ?? [] };
    ui.archive = await db.addToArchive(rec);
    $('#arcCount').textContent = ui.archive.length;
    sumBtn.disabled = false; sumBtn.textContent = 'Re-open summary';
    toast('Saved to archive · reopening is free');
    showChat(item, rec.thread);
    if (ui.view === 'feed') drawFeed(); else drawBoards();
  } catch (e) {
    note.innerHTML = '';
    text.innerHTML = '';
    const err = el('div', 'notice', `<h4>Could not summarise this</h4><p>${esc(e.message)}</p>`);
    out.append(err);
    sumBtn.disabled = false; sumBtn.textContent = 'Try again';
  }
}

// ---------------------------------------------------------------- chat
const SUGGEST = [
  'What is this, in two lines?',
  'Why is it getting attention today?',
  'Is this hype, or does it matter?',
  'What would I use it instead of?',
];

// Page text is expensive to fetch and needs a permission, so read it once per
// item and reuse it for the summary and every follow-up question.
const ctx = new Map();
async function context(item) {
  if (!ctx.has(item.id)) ctx.set(item.id, await buildPrompt(item));
  return ctx.get(item.id);
}

function showChat(item, thread) {
  const b = $('#pBody');
  let box = b.querySelector('.thread');
  if (!box) { box = el('div', 'thread'); b.append(box); }
  box.innerHTML = '';
  ui.thread = thread;
  thread.forEach(m => box.append(el('div', 'msg ' + m.r, m.r === 'a' ? md(m.t) : esc(m.t))));
  if (!thread.length) box.append(zeroState(item));
  $('#chint').textContent = S.keys[S.provider]
    ? `${PROVIDERS[S.provider].name} · ${S.model ?? PROVIDERS[S.provider].default}`
    : 'Add an API key in Settings to chat';
}

function zeroState(item) {
  const z = el('div', 'chatzero',
    `<h4>Ask about this</h4>Answers use the page itself, plus the discussion thread where there is one.`);
  const sg = el('div', 'suggest');
  SUGGEST.forEach(q => {
    const btn = el('button', null, q);
    btn.type = 'button';
    btn.onclick = () => ask(item, ui.thread, q);
    sg.append(btn);
  });
  z.append(sg);
  return z;
}

let busy = false;
async function ask(item, thread, q) {
  if (busy || !q.trim()) return;
  if (!S.keys[S.provider]) { toast(`Add your ${PROVIDERS[S.provider].name} key in Settings first`); return openModal(); }

  busy = true; $('#send').disabled = true;
  const box = $('#pBody').querySelector('.thread');
  box.querySelector('.chatzero')?.remove();
  thread.push({ r: 'u', t: q });
  box.append(el('div', 'msg u', esc(q)));

  const a = el('div', 'msg a', '<span class="thinking"><i></i><i></i><i></i></span>');
  box.append(a);
  $('#pBody').scrollTop = $('#pBody').scrollHeight;

  const model = S.model ?? PROVIDERS[S.provider].default;
  try {
    const source = await context(item);
    const summary = ui.archive.find(x => x.id === item.id)?.summary;
    const history = thread.slice(0, -1)
      .map(m => `${m.r === 'u' ? 'User' : 'You'}: ${m.t}`).join('\n\n');

    let acc = '';
    const usage = await stream({
      provider: S.provider, key: S.keys[S.provider], model,
      system: 'You are answering questions about one item from a developer news feed. '
        + 'Use the source material below. Be direct and brief — two or three short paragraphs at most. '
        + 'When the source does not settle the question, say so plainly instead of guessing.',
      prompt: [source,
               summary ? `\nEARLIER SUMMARY:\n${summary}` : '',
               history ? `\nCONVERSATION SO FAR:\n${history}` : '',
               `\nUser: ${q}`].filter(Boolean).join('\n'),
      onToken: t => {
        acc += t;
        a.innerHTML = md(acc) + '<span class="cursor"></span>';
        $('#pBody').scrollTop = $('#pBody').scrollHeight;
      },
    });
    a.innerHTML = md(acc);
    thread.push({ r: 'a', t: acc });
    await bill(model, usage);

    const rec = ui.archive.find(x => x.id === item.id);
    if (rec) { rec.thread = thread; await db.addToArchive(rec); }
  } catch (e) {
    a.className = 'msg err';
    a.textContent = e.message;
  } finally {
    busy = false; $('#send').disabled = !$('#ask').value.trim();
    $('#pBody').scrollTop = $('#pBody').scrollHeight;
  }
}

// Only bill when we actually know the model's price.
async function bill(model, usage) {
  const m = catalog().find(x => x.id === model);
  if (!m || m.in == null || !usage.in) return null;
  const cost = (usage.in * m.in + usage.out * m.out) / 1e6;
  $('#spend').textContent = '$' + (await db.spent(cost)).toFixed(2);
  return cost;
}

// ---------------------------------------------------------------- views
function setView(v) {
  ui.view = v;
  $('#viewBoards').hidden = v !== 'boards';
  $('#viewFeed').hidden = v !== 'feed';
  $('#viewArchive').hidden = v !== 'archive';
  document.body.classList.toggle('wide', v === 'boards');
  document.querySelector('.topics').hidden = v !== 'feed';
  $('#addWrap').hidden = v !== 'boards';
  document.querySelectorAll('.views button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === v));
  if (v === 'boards') drawBoards();
  if (v === 'feed') drawFeed();
  if (v === 'archive') drawArchive();
}

function drawTopics() {
  const w = $('#topicStrip'); w.innerHTML = '';
  w.append(el('span', 'lab', 'Topics'));
  S.topics.forEach(t => {
    const b = el('button', 'chip', esc(t));
    b.setAttribute('aria-pressed', ui.filters.has(t));
    b.onclick = () => { ui.filters.has(t) ? ui.filters.delete(t) : ui.filters.add(t); drawTopics(); drawFeed(); };
    w.append(b);
  });
  const add = el('button', 'chip add', '+ topic');
  add.onclick = () => { openModal(); setTimeout(() => $('#topicInput').focus(), 220); };
  w.append(add);
}

// ---------------------------------------------------------------- settings
function drawProviders() {
  const w = $('#providerTabs'); w.innerHTML = '';
  Object.entries(PROVIDERS).forEach(([k, p]) => {
    const b = el('button', 'provider' + (S.keys[k] ? ' has-key' : ''), p.name);
    b.setAttribute('aria-pressed', S.provider === k);
    b.onclick = async () => {
      S.provider = k; S.model = null;
      await db.save({ provider: k, model: null });
      drawProviders(); drawKeyRow(); drawModels();
    };
    w.append(b);
  });
  const p = PROVIDERS[S.provider];
  $('#providerHelp').innerHTML =
    `Stored in <span class="mono">storage.local</span> — never synced, never sent anywhere except `
    + `<span class="mono">${p.name}</span>. Get a key at <a href="${p.keyUrl}" target="_blank" rel="noopener">${new URL(p.keyUrl).host}</a>.`;
}

function drawKeyRow() {
  const w = $('#keyRow'); w.innerHTML = '';
  const p = PROVIDERS[S.provider];
  const key = S.keys[S.provider];
  if (key) {
    const r = el('div', 'keyset', `<span class="ok">✓ key saved</span>
      <span style="color:var(--faint)">••••••••${esc(key.slice(-4))}</span>`);
    const rep = el('button', 'btn', 'Replace');
    rep.onclick = async () => { delete S.keys[S.provider]; await db.save({ keys: S.keys }); drawKeyRow(); };
    r.append(rep); w.append(r);
  } else {
    const f = el('div', 'field');
    const i = document.createElement('input');
    i.type = 'password'; i.placeholder = p.placeholder; i.autocomplete = 'off';
    const b = el('button', 'btn pri', 'Save key');
    const commit = async () => {
      const v = i.value.trim();
      if (!v) return toast('Paste a key first');
      S.keys[S.provider] = v; await db.save({ keys: S.keys });
      drawKeyRow(); drawProviders(); toast(`${p.name} key stored locally`);
      refreshModels();
    };
    b.onclick = commit;
    i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } };
    f.append(i, b); w.append(f);
  }
}

function drawModels() {
  const sel = $('#modelSelect'); sel.innerHTML = '';
  const p = PROVIDERS[S.provider];
  const list = catalog();
  const model = S.model ?? p.default;
  const curated = new Set(p.models.map(m => m.id));

  const groups = [
    ['Recommended', list.filter(m => curated.has(m.id) && m.tier !== 'advanced')],
    ['Advanced', list.filter(m => curated.has(m.id) && m.tier === 'advanced')],
    [S.models?.[S.provider]?.length ? `All ${p.name} models` : '', list.filter(m => !curated.has(m.id))],
  ];
  for (const [label, items] of groups) {
    if (!items.length || !label) continue;
    const g = document.createElement('optgroup'); g.label = label;
    items.forEach(m => {
      const o = document.createElement('option');
      o.value = m.id; o.textContent = m.label;
      g.append(o);
    });
    sel.append(g);
  }
  if (!list.some(m => m.id === model)) {
    const o = document.createElement('option');
    o.value = model; o.textContent = model; sel.prepend(o);
  }
  sel.value = model;

  const cost = estimate(S.provider, model, list);
  $('#modelEstimate').textContent = cost == null ? 'price unknown' : `≈ $${cost.toFixed(3)} / summary`;
  $('#modelHint').textContent = !S.keys[S.provider]
    ? `Save a key and press ↻ to load every model your ${p.name} account can reach.`
    : S.models?.[S.provider]?.length
      ? `${list.length} models from your ${p.name} account. Lightweight ones are plenty for summarising.`
      : 'Press ↻ to load the full list from your account.';
  sel.onchange = async () => { S.model = sel.value; await db.save({ model: S.model }); drawModels(); };
}

async function refreshModels({ quiet = false } = {}) {
  const p = S.provider;
  const key = S.keys[p];
  if (!key && p !== 'openrouter') {
    if (!quiet) toast(`Save a ${PROVIDERS[p].name} key first`);
    return;
  }
  const btn = $('#modelRefresh');
  btn.classList.add('syncing');
  try {
    const list = await listModels(p, key);
    S.models = { ...(S.models ?? {}), [p]: list };
    await db.save({ models: S.models });
    // A model that vanished from the account should not stay selected.
    if (S.model && !list.some(m => m.id === S.model)) { S.model = null; await db.save({ model: null }); }
    drawModels();
    if (!quiet) toast(`${list.length} ${PROVIDERS[p].name} models loaded`);
  } catch (e) {
    if (!quiet) toast(e.message);
  } finally {
    btn.classList.remove('syncing');
  }
}

function drawSubChips() {
  const w = $('#subChips'); w.innerHTML = '';
  S.subs.forEach(sub => {
    const c = el('span', 'subchip', 'r/' + esc(sub));
    const x = el('button', null, '×');
    x.onclick = async () => {
      S.subs = S.subs.filter(v => v !== sub);
      await db.save({ subs: S.subs });
      drawSubChips(); drawBoards();
    };
    c.append(x); w.append(c);
  });
  if (!S.subs.length) w.append(el('span', 'help', 'No subreddits set — the Reddit board shows r/all.'));
}

const ACCTS = [
  { k: 'github', el: '#acctGithub', nm: 'GitHub', off: 'anonymous · trending is public',
    on: 'token saved · higher search limits', act: 'Add token' },
];

function drawAccts() {
  drawReddit();
  ACCTS.forEach(a => {
    const on = !!S.githubToken;
    const w = $(a.el); if (!w) return;
    w.innerHTML = '';
    w.append(el('div', 'grow', `<div class="nm">${a.nm}</div><div class="st${on ? ' on' : ''}">${on ? '✓ ' + a.on : a.off}</div>`));
    const b = el('button', 'btn' + (on ? '' : ' pri'), on ? 'Turn off' : a.act);
    b.onclick = async () => {
      if (on) S.githubToken = '';
      else {
        const tk = prompt('Fine-grained GitHub token (revoke any time at github.com/settings/tokens):');
        if (!tk) return;
        S.githubToken = tk.trim();
      }
      await db.save({ githubToken: S.githubToken });
      drawAccts();
      toast(on ? 'GitHub token removed' : 'GitHub token saved');
    };
    w.append(b);
  });
}

// Reddit works with no account. Connecting one is an optional upgrade — it adds
// scores and comment counts and reaches private subreddits — so it lives behind
// a disclosure rather than blocking the board.
function drawReddit() {
  const w = $('#acctReddit'); if (!w) return;
  w.innerHTML = '';
  w.style.display = 'block';

  const head = el('div', null, '');
  head.style.cssText = 'display:flex;align-items:center;gap:11px';
  const on = !!S.reddit?.access;
  head.append(el('div', 'grow', `<div class="nm">Reddit</div>`
    + `<div class="st${on ? ' on' : ''}">`
    + (on ? `✓ connected${S.reddit.user ? ' as u/' + esc(S.reddit.user) : ''} · scores and private subs`
          : 'public feeds · no account needed')
    + '</div>'));

  if (on) {
    const off = el('button', 'btn', 'Disconnect');
    off.onclick = async () => {
      S.reddit = null; await db.save({ reddit: null });
      drawReddit();
      if (S.boards.includes('rd')) { await loadBoard('rd', { force: true }); drawBoards(); }
      toast('Reddit disconnected · back to public feeds');
    };
    head.append(off);
    w.append(head);
    return;
  }

  const toggle = el('button', 'btn', 'Connect account');
  head.append(toggle);
  w.append(head);

  const panel = el('div', null, '');
  panel.id = 'redditConnect';
  panel.hidden = true;
  panel.style.marginTop = '12px';
  toggle.onclick = () => {
    panel.hidden = !panel.hidden;
    toggle.textContent = panel.hidden ? 'Connect account' : 'Cancel';
  };

  panel.append(el('p', 'help', `Optional. Adds scores and comment counts, reaches private subreddits, and
    avoids rate limits. Reddit only issues tokens to registered apps, so this needs one of your own — free,
    no review. Open <a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noopener">reddit.com/prefs/apps</a>,
    choose <b>installed app</b>, and paste this as the redirect URI:`));

  const uri = el('div', 'keyset');
  uri.style.margin = '8px 0';
  const code = el('span', 'mono', esc(redirectURL()));
  code.style.cssText = 'flex:1;min-width:0;overflow:auto;white-space:nowrap;background:var(--bg);'
    + 'border:1px solid var(--line);border-radius:2px;padding:6px 9px;font-size:11.5px';
  const copy = el('button', 'btn', 'Copy');
  copy.onclick = async () => { await navigator.clipboard.writeText(redirectURL()); toast('Redirect URI copied'); };
  uri.append(code, copy);
  panel.append(uri);
  panel.append(el('p', 'help', 'That string is generated by your browser for this install — it looks odd, '
    + 'but Reddit needs to see it exactly.'));

  const f = el('div', 'field');
  const inp = document.createElement('input');
  inp.placeholder = 'client ID (the string under your app name)';
  inp.autocomplete = 'off';
  const go = el('button', 'btn pri', 'Connect');
  go.onclick = async () => {
    go.disabled = true; go.textContent = 'Connecting…';
    try {
      const auth = await redditConnect(inp.value.trim());
      auth.user = await whoami(auth.access).catch(() => null);
      S.reddit = auth; await db.save({ reddit: auth });
      drawReddit();
      toast(`Reddit connected${auth.user ? ' as u/' + auth.user : ''}`);
      if (S.boards.includes('rd')) { await loadBoard('rd', { force: true }); drawBoards(); }
    } catch (e) {
      toast(e.message);
      go.disabled = false; go.textContent = 'Connect';
    }
  };
  f.append(inp, go);
  panel.append(f);
  w.append(panel);
}

function drawSrcToggles() {
  const w = $('#srcToggles'); w.innerHTML = '';
  Object.entries(BOARDS).forEach(([id, b]) => {
    const on = S.boards.includes(id);
    const l = el('label', 'tg',
      `<input type="checkbox" ${on ? 'checked' : ''}><span>${b.name}</span>
       <span class="cnt">${rows[id]?.rows?.length ?? 0} items</span>`);
    l.querySelector('input').onchange = async e => {
      S.boards = e.target.checked ? [...S.boards, id] : S.boards.filter(x => x !== id);
      await db.save({ boards: S.boards });
      if (e.target.checked) await loadBoard(id);
      drawBoards(); drawSrcToggles();
    };
    w.append(l);
  });
}

function openModal() {
  $('#modal').classList.add('on');
  $('#modal').querySelector('.sheet').scrollTop = 0;
  drawProviders(); drawKeyRow(); drawModels(); drawSubChips(); drawAccts(); drawSrcToggles();
  $('#feeds').value = S.feeds.join('\n');
}
const closeModal = () => $('#modal').classList.remove('on');

// ---------------------------------------------------------------- chrome
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 3000);
}
function tick() {
  const d = new Date();
  $('#clock').innerHTML = `<b>${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b> · `
    + d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------- boot
(async function boot() {
  S = await db.load();
  ui.archive = await db.archive();
  BOARDS.rd.params.sub = S.subs[0] ?? '';

  document.querySelectorAll('.views button').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('#arcSearch').oninput = drawArchive;
  $('#pClose').onclick = closePanel;
  $('#scrim').onclick = closePanel;
  $('#btnSettings').onclick = openModal;
  $('#modelRefresh').onclick = () => refreshModels();

  // The composer is bound once, at boot, and always calls preventDefault.
  // Binding it lazily meant an unbound form did a native submit and reloaded
  // the whole page — which looked exactly like the chat silently resetting.
  const ask$ = $('#ask');
  const grow = () => { ask$.style.height = 'auto'; ask$.style.height = Math.min(ask$.scrollHeight, 150) + 'px'; };
  const send = () => {
    const v = ask$.value.trim();
    if (!v || !ui.item) return;
    ask$.value = ''; grow(); $('#send').disabled = true;
    ask(ui.item, ui.thread ?? [], v);
  };
  $('#composer').addEventListener('submit', e => { e.preventDefault(); send(); });
  ask$.addEventListener('input', () => { grow(); $('#send').disabled = !ask$.value.trim(); });
  ask$.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#mClose').onclick = closeModal;
  $('#mCancel').onclick = closeModal;
  $('#modal').onclick = e => { if (e.target === $('#modal')) closeModal(); };
  $('#repoLink').href = REPO;
  $('#mSave').onclick = async () => {
    const feeds = $('#feeds').value.split('\n').map(s => s.trim()).filter(Boolean);
    // Fire the permission request first: an await before it loses the gesture.
    const origins = [...new Set(feeds.map(f => { try { return new URL(f).origin + '/*'; } catch { return null; } }).filter(Boolean))];
    const granted = origins.length ? browser.permissions.request({ origins }) : Promise.resolve(true);

    S.feeds = feeds;
    await db.save({ feeds });
    closeModal();
    const ok = await granted.catch(() => false);
    toast(ok ? 'Settings saved' : 'Saved — but feeds need site access to load');
    if (S.boards.includes('rss')) { await loadBoard('rss', { force: true }); drawBoards(); }
  };
  $('#addBoardBtn').onclick = e => { e.stopPropagation(); $('#addMenu').classList.toggle('on'); };
  document.addEventListener('click', e => { if (!e.target.closest('.addwrap')) $('#addMenu').classList.remove('on'); });
  $('#topicInput').onkeydown = async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.target.value.trim();
    if (v && !S.topics.includes(v)) { S.topics.push(v); await db.save({ topics: S.topics }); drawTopics(); toast(`Tracking “${v}”`); }
    e.target.value = '';
  };
  $('#subInput').onkeydown = async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.target.value.trim().replace(/^\/?r\//, '');
    if (v && !S.subs.includes(v)) { S.subs.push(v); await db.save({ subs: S.subs }); drawSubChips(); drawBoards(); toast('Tracking r/' + v); }
    e.target.value = '';
  };
  $('#btnTheme').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    db.save({ theme: dark ? 'light' : 'dark' });
  };
  $('#btnSync').onclick = async () => {
    const b = $('#btnSync');
    if (b.classList.contains('syncing')) return;
    b.classList.add('syncing');
    $('#syncAge').textContent = `syncing ${S.boards.length} sources…`;
    await Promise.all(S.boards.map(id => loadBoard(id, { force: true })));
    b.classList.remove('syncing');
    $('#syncAge').textContent = 'synced just now';
    drawBoards();
    const failed = S.boards.filter(id => rows[id]?.error);
    toast(failed.length ? `${failed.length} source${failed.length > 1 ? 's' : ''} failed — see the board headers` : 'All sources refreshed');
  };
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('#modal').classList.contains('on')) closeModal();
    else if ($('#panel').classList.contains('on')) closePanel();
  });

  if (S.theme) document.documentElement.setAttribute('data-theme', S.theme);
  $('#spend').textContent = '$' + (S.spend[new Date().toISOString().slice(0, 10)] ?? 0).toFixed(2);
  $('#arcCount').textContent = ui.archive.length || '';
  tick(); setInterval(tick, 20000);
  drawTopics();
  setView('boards');

  // Cache first so the tab is instant, then revalidate what went stale.
  await Promise.all(S.boards.map(id => loadBoard(id)));
  drawBoards();
  $('#syncAge').textContent = 'synced just now';
})();
