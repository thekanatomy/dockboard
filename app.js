(() => {
  const $ = (s) => document.querySelector(s);
  const H = 3600e3;
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const state = {
    clientId: load('db.clientId', ''),
    mapping: load('db.mapping', {}),     // calendarId -> category name
    progress: load('db.progress', {}),   // eventId -> { done, subs:[{id,text,done}], seeded }
    calendars: load('db.calendars', []), // [{id, summary}]
    events: load('db.events', []),
    demo: load('db.demo', true),
    filter: 'All',
    token: null,
  };

  // ---------- squircle clip-path (superellipse, n=5) ----------
  (function buildSquircle() {
    const n = 5, steps = 120, pts = [];
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
      const x = 0.5 + 0.5 * Math.sign(c) * Math.abs(c) ** (2 / n);
      const y = 0.5 + 0.5 * Math.sign(s) * Math.abs(s) ** (2 / n);
      pts.push(`${x.toFixed(4)} ${y.toFixed(4)}`);
    }
    $('#squirclePath').setAttribute('d', 'M' + pts.join('L') + 'Z');
  })();

  // ---------- urgency: continuous green -> yellow -> red ----------
  function urgency(end) {
    const h = (end - Date.now()) / H;
    // 0 = calm, 1 = urgent
    let u = h >= 168 ? 0 : h <= 0 ? 1 : h > 48 ? 0.5 * (1 - (h - 48) / 120) : 0.5 + 0.5 * (1 - h / 48);
    const stops = [[52,199,89],[255,204,0],[255,59,48]];
    const p = u * 2, i = Math.min(1, Math.floor(p)), f = p - i;
    const rgb = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
    return { h, u, rgb: rgb.join(','), yellowish: u > 0.3 && u < 0.7, breath: (4.8 - 3.2 * u).toFixed(2) + 's' };
  }

  function fmtWhen(h, start) {
    if (h <= 0) return h > -24 ? 'Overdue' : `${Math.ceil(-h / 24)}d overdue`;
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} min left`;
    if (h < 24) return `${Math.round(h)}h left`;
    const d = Math.ceil(h / 24);
    return d === 1 ? 'Tomorrow' : `${d} days left`;
  }
  const fmtDate = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- data ----------
  function demoEvents() {
    const now = Date.now();
    const mk = (id, title, cat, hrs, desc) => ({ id, title, category: cat, end: now + hrs * H, description: desc, link: '' });
    return [
      mk('d1', 'Submit tax documents', 'Life Admin', 5, '- Find W-2\n- Upload to portal\n- Confirm receipt email'),
      mk('d2', 'Prepare quarterly review', 'Work', 30, 'Slides for Thursday.\n- Pull the numbers\n- Draft 5 slides\n- Rehearse once'),
      mk('d3', 'Book dentist appointment', 'Health', 96, 'Call before 5pm.'),
      mk('d4', 'Plan mom’s birthday dinner', 'Family', 200, '- Pick restaurant\n- Make reservation\n- Order cake'),
      mk('d5', 'Renew passport', 'Life Admin', 400, ''),
      mk('d6', 'Reply to landlord', 'Life Admin', -3, '- Read the email\n- Send reply'),
    ];
  }

  const categories = () => [...new Set(state.events.map((e) => e.category))].sort();

  // ---------- render ----------
  function render() {
    const now = Date.now();
    const all = state.events.filter((e) => state.filter === 'All' || e.category === state.filter);
    const open = all.filter((e) => !state.progress[e.id]?.done).sort((a, b) => a.end - b.end);
    const done = all.filter((e) => state.progress[e.id]?.done);

    $('#filters').innerHTML = ['All', ...categories()].map((c) => `<button class="chip ${c === state.filter ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    $('#subtitle').textContent = open.length ? `${open.length} thing${open.length > 1 ? 's' : ''} on your plate. Start with the one that's glowing the most.` : 'Nothing pending. Breathe.';
    $('#syncBtn').textContent = state.token ? 'Refresh' : state.demo ? 'Connect Google Calendar' : 'Sync';

    $('#board').innerHTML = open.length ? open.map((e) => block(e)).join('') : '<div class="empty">All clear.</div>';
    $('#doneBoard').innerHTML = done.map((e) => block(e)).join('');
    $('#doneWrap').hidden = !done.length;
    $('#doneCount').textContent = `(${done.length})`;
  }

  function block(e) {
    const u = urgency(e.end), p = state.progress[e.id], isDone = p?.done;
    const subs = p?.subs ?? [], dn = subs.filter((s) => s.done).length;
    return `<button class="block-wrap ${u.yellowish ? 'yellowish' : ''} ${isDone ? 'is-done' : ''}" data-id="${esc(e.id)}" style="--c:${u.rgb};--breath:${u.breath}">
      <div class="block"><div class="cat">${esc(e.category)}</div><div class="title">${esc(e.title)}</div>
      <div class="when"><span>${isDone ? 'Done' : fmtWhen(u.h)}</span>${subs.length ? `<span class="mini">${dn}/${subs.length}</span>` : ''}</div></div></button>`;
  }

  // ---------- sheet ----------
  let openId = null;
  function parseSubs(desc) {
    return (desc || '').split(/\r?\n|<br\s*\/?>/i).map((l) => l.replace(/<[^>]+>/g, '').trim())
      .filter((l) => /^([-*•]|\[ \]|\d+[.)])\s+/.test(l)).map((l) => l.replace(/^([-*•]|\[ \]|\d+[.)])\s+/, ''));
  }
  const rid = () => Math.random().toString(36).slice(2, 9);

  function openSheet(id) {
    const e = state.events.find((x) => x.id === id); if (!e) return;
    openId = id;
    const p = (state.progress[id] ??= { done: false, subs: [], seeded: false });
    if (!p.seeded) { p.subs = parseSubs(e.description).map((text) => ({ id: rid(), text, done: false })); p.seeded = true; save('db.progress', state.progress); }
    $('#sheet').hidden = false;
    renderSheet();
    $('#sheet .close').focus();
  }

  function renderSheet() {
    const e = state.events.find((x) => x.id === openId), p = state.progress[openId], u = urgency(e.end);
    const sheet = $('#sheet .sheet'); sheet.style.setProperty('--c', u.rgb);
    $('#sheetBadge').textContent = e.category;
    $('#sheetTitle').textContent = e.title;
    $('#sheetMeta').textContent = `Due ${fmtDate(e.end)} · ${fmtWhen(u.h)}`;
    const plain = (e.description || '').split(/\r?\n/).filter((l) => !/^([-*•]|\[ \]|\d+[.)])\s+/.test(l.trim())).join('\n').replace(/<[^>]+>/g, '').trim();
    $('#sheetNotes').textContent = plain; $('#sheetNotes').hidden = !plain;
    const dn = p.subs.filter((s) => s.done).length, pct = p.subs.length ? (dn / p.subs.length) * 100 : p.done ? 100 : 0;
    $('#progressBar').style.width = pct + '%';
    $('#progressText').textContent = p.subs.length ? `${dn} of ${p.subs.length} steps done` : 'Break it into small steps — the first one should take under 5 minutes.';
    $('#subtasks').innerHTML = p.subs.map((s) => `<li class="${s.done ? 'done' : ''}" data-sid="${s.id}"><input class="check" type="checkbox" ${s.done ? 'checked' : ''} aria-label="Done"><span>${esc(s.text)}</span><button class="rm" aria-label="Remove">×</button></li>`).join('');
    $('#doneBtn').textContent = p.done ? 'Reopen' : 'Mark as done';
    $('#openCal').hidden = !e.link; if (e.link) $('#openCal').href = e.link;
  }

  function closeSheets() { $('#sheet').hidden = true; $('#settings').hidden = true; openId = null; render(); }

  // ---------- events ----------
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const blk = t.closest('.block-wrap'); if (blk) return openSheet(blk.dataset.id);
    const chip = t.closest('.chip'); if (chip) { state.filter = chip.dataset.cat; return render(); }
    if (t.matches('[data-close]') || t.classList.contains('overlay')) return closeSheets();
    const li = t.closest('#subtasks li');
    if (li) {
      const p = state.progress[openId];
      if (t.classList.contains('rm')) p.subs = p.subs.filter((s) => s.id !== li.dataset.sid);
      else if (t.classList.contains('check')) { const s = p.subs.find((x) => x.id === li.dataset.sid); s.done = t.checked; }
      else return;
      save('db.progress', state.progress); renderSheet();
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

  $('#subForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#subInput').value.trim(); if (!v) return;
    state.progress[openId].subs.push({ id: rid(), text: v, done: false });
    $('#subInput').value = ''; save('db.progress', state.progress); renderSheet();
  });
  $('#doneBtn').addEventListener('click', () => {
    const p = state.progress[openId]; p.done = !p.done;
    if (p.done) p.subs.forEach((s) => (s.done = true));
    save('db.progress', state.progress); closeSheets();
  });

  // ---------- settings ----------
  function renderMapping() {
    $('#clientId').value = state.clientId;
    $('#mapping').innerHTML = state.calendars.length
      ? state.calendars.map((c) => `<div class="maprow"><span title="${esc(c.summary)}">${esc(c.summary)}</span><input data-cal="${esc(c.id)}" placeholder="Category (e.g. Work)" value="${esc(state.mapping[c.id] || '')}"></div>`).join('')
      : '<p class="muted tiny">Connect Google Calendar to see your calendars.</p>';
  }
  $('#settingsBtn').addEventListener('click', () => { renderMapping(); $('#settings').hidden = false; });
  $('#saveSettings').addEventListener('click', () => {
    state.clientId = $('#clientId').value.trim(); save('db.clientId', state.clientId);
    document.querySelectorAll('[data-cal]').forEach((i) => { const v = i.value.trim(); if (v) state.mapping[i.dataset.cal] = v; else delete state.mapping[i.dataset.cal]; });
    save('db.mapping', state.mapping);
    if (!state.demo && state.token) return sync().then(closeSheets);
    closeSheets();
  });
  $('#demoBtn').addEventListener('click', () => { state.demo = true; state.events = demoEvents(); save('db.demo', true); closeSheets(); });

  // ---------- Google Calendar ----------
  function loadGIS() {
    return new Promise((res, rej) => {
      if (window.google?.accounts) return res();
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = rej; document.head.append(s);
    });
  }
  async function api(path) {
    const r = await fetch('https://www.googleapis.com/calendar/v3/' + path, { headers: { Authorization: 'Bearer ' + state.token } });
    if (!r.ok) throw new Error('Calendar API ' + r.status);
    return r.json();
  }
  async function sync() {
    const cals = (await api('users/me/calendarList')).items || [];
    state.calendars = cals.map((c) => ({ id: c.id, summary: c.summaryOverride || c.summary }));
    save('db.calendars', state.calendars);
    const mapped = state.calendars.filter((c) => state.mapping[c.id]);
    if (!mapped.length) { renderMapping(); $('#settings').hidden = false; $('#subtitle').textContent = 'Map at least one calendar to a category to see tasks.'; return; }
    const min = new Date(Date.now() - 7 * 24 * H).toISOString(), max = new Date(Date.now() + 60 * 24 * H).toISOString();
    const out = [];
    for (const c of mapped) {
      const d = await api(`calendars/${encodeURIComponent(c.id)}/events?singleEvents=true&orderBy=startTime&maxResults=100&timeMin=${min}&timeMax=${max}`);
      for (const e of d.items || []) {
        const end = e.end?.dateTime || e.end?.date; if (!end) continue;
        out.push({ id: c.id + ':' + e.id, title: e.summary || '(No title)', category: state.mapping[c.id], end: new Date(end).getTime(), description: e.description || '', link: e.htmlLink || '' });
      }
    }
    state.events = out; state.demo = false; save('db.events', out); save('db.demo', false); render();
  }
  $('#syncBtn').addEventListener('click', async () => {
    if (!state.clientId) { renderMapping(); $('#settings').hidden = false; $('#clientId').focus(); return; }
    try {
      await loadGIS();
      if (state.token) return await sync();
      google.accounts.oauth2.initTokenClient({
        client_id: state.clientId, scope: 'https://www.googleapis.com/auth/calendar.readonly',
        callback: async (r) => { if (r.access_token) { state.token = r.access_token; try { await sync(); } catch (err) { alert(err.message); } } },
      }).requestAccessToken();
    } catch (err) { alert('Could not connect: ' + err.message); }
  });

  // ---------- boot ----------
  if (state.demo || !state.events.length) { state.events = demoEvents(); state.demo = true; }
  render();
  setInterval(() => { if ($('#sheet').hidden && $('#settings').hidden) render(); }, 60 * 1000);
})();
