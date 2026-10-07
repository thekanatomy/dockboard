(() => {
  const $ = (s) => document.querySelector(s);
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rid = () => Math.random().toString(36).slice(2, 9);

  const MAX_TODAY = 3;
  const SIZES = [null, 'quick', 'medium', 'long'];
  const SIZE_LABEL = { quick: '5 min', medium: '30 min', long: '1 hr+' };
  const PRAISE = ['Nice. One less thing.', 'Done. That counts.', 'Look at you go.', 'Small win. Real win.', 'Brain: 1, Task: 0.'];

  let tasks = load('ot.tasks', []);
  let timer = null; // { id, end }
  const save = () => store('ot.tasks', tasks);

  // ---------- organizing ----------
  const open = () => tasks.filter((t) => !t.done);
  const todayList = () => open().filter((t) => t.today).sort((a, b) => a.order - b.order);
  const laterList = () => open().filter((t) => !t.today).sort((a, b) => b.created - a.created);
  const sizeRank = (t) => (t.size ? SIZES.indexOf(t.size) : 2);

  function add(raw) {
    let title = raw.trim(); if (!title) return;
    // "today" / "now" / "asap" anywhere sends it straight to Today
    const urgent = /\b(today|now|asap)\b/i.test(title);
    const t = { id: rid(), title, size: null, today: false, done: false, steps: [], created: Date.now(), order: Date.now() };
    if (urgent && todayList().length < MAX_TODAY) t.today = true;
    tasks.push(t); save(); render();
    toast(t.today ? 'Added to Today' : 'Saved for later');
  }

  function planDay() {
    // Fill Today up to 3: quick wins first, then oldest. A gentle start, not a wall.
    const room = MAX_TODAY - todayList().length;
    if (room <= 0) return toast('Today is already full. Finish one first.');
    const pool = laterList().sort((a, b) => sizeRank(a) - sizeRank(b) || a.created - b.created).slice(0, room);
    if (!pool.length) return toast('Nothing waiting. Add something!');
    pool.forEach((t) => { t.today = true; t.order = Date.now() + Math.random(); });
    save(); render();
  }

  function complete(id) {
    const t = tasks.find((x) => x.id === id); if (!t) return;
    t.done = true; t.doneAt = Date.now(); t.steps.forEach((s) => (s.done = true));
    if (timer?.id === id) timer = null;
    save(); render(); toast(PRAISE[Math.floor(Math.random() * PRAISE.length)]);
  }
  const reopen = (id) => { const t = tasks.find((x) => x.id === id); t.done = false; t.today = false; save(); render(); };

  function moveToToday(id) {
    const t = tasks.find((x) => x.id === id);
    if (todayList().length >= MAX_TODAY) return toast('Three is plenty for today. Finish one first.');
    t.today = true; t.order = Date.now(); save(); render();
  }
  const moveToLater = (id) => { tasks.find((x) => x.id === id).today = false; save(); render(); };
  const skip = (id) => { // "Not now" sends it to the back of Today
    tasks.find((x) => x.id === id).order = Date.now(); if (timer?.id === id) timer = null; save(); render();
  };

  // ---------- render ----------
  let showSteps = false;
  function render() {
    const hr = new Date().getHours();
    $('#greeting').textContent = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';

    const td = todayList(), lt = laterList(), dn = tasks.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt).slice(0, 10);
    $('#todayCount').textContent = td.length ? `· ${td.length}/${MAX_TODAY}` : '';
    $('#laterCount').textContent = lt.length ? `· ${lt.length}` : '';
    $('#planBtn').hidden = !lt.length || td.length >= MAX_TODAY;

    renderFocus(td[0]);
    $('#today').innerHTML = td.slice(1).map((t) => row(t, 'later')).join('');
    $('#later').innerHTML = lt.map((t) => row(t, 'today')).join('');
    $('#doneWrap').hidden = !dn.length;
    $('#doneCount').textContent = `(${tasks.filter((t) => t.done).length})`;
    $('#done').innerHTML = dn.map((t) => `<li class="d" data-id="${t.id}"><input type="checkbox" class="check" checked aria-label="Undo"><span class="t">${esc(t.title)}</span></li>`).join('');
  }

  function row(t, to) {
    const label = to === 'today' ? 'Today' : 'Later';
    const size = t.size ? SIZE_LABEL[t.size] : '＋ time';
    return `<li data-id="${t.id}"><input type="checkbox" class="check" aria-label="Mark done"><span class="t">${esc(t.title)}</span>
      <button class="chip" data-act="size" aria-label="Set how long it takes">${size}</button>
      <button class="mv" data-act="to-${to}">${to === 'today' ? '↑ Today' : '↓ Later'}</button></li>`;
  }

  function renderFocus(t) {
    const el = $('#focus');
    if (!t) {
      const waiting = laterList().length;
      el.innerHTML = `<div class="card calm"><h3>${waiting ? 'Nothing picked yet.' : 'All clear. Breathe.'}</h3>
        <p class="muted">${waiting ? 'Want me to choose a few easy ones for today?' : 'Type anything above when it pops into your head. You don’t have to sort it now.'}</p>
        ${waiting ? '<div class="actions" style="justify-content:center"><button class="pill blue" data-act="plan">Plan my day</button></div>' : ''}</div>`;
      return;
    }
    const subs = t.steps;
    const running = timer?.id === t.id;
    el.innerHTML = `<div class="card" data-id="${t.id}">
      <div class="eyebrow">Right now</div><h3>${esc(t.title)}</h3>
      ${running ? `<div class="timer" id="timerText">${fmt(timer.end - Date.now())}</div><p class="muted" style="margin:0">Just keep going until it rings.</p>` : ''}
      ${subs.length ? `<ul class="steps">${subs.map((s) => `<li class="${s.done ? 'd' : ''}" data-sid="${s.id}"><input class="check sm" type="checkbox" ${s.done ? 'checked' : ''} aria-label="Step done"><span>${esc(s.text)}</span></li>`).join('')}</ul>` : ''}
      ${showSteps ? `<form class="sub" id="stepForm"><input id="stepInput" placeholder="What's the tiniest first step?" autocomplete="off"><button class="pill blue">Add</button></form>` : ''}
      <div class="actions">
        <button class="pill primary" data-act="done">Done</button>
        ${running ? '<button class="pill" data-act="stop">Stop timer</button>' : '<button class="pill blue" data-act="timer">Start 10 min</button>'}
        <button class="pill" data-act="steps">${showSteps ? 'Hide' : 'Break it down'}</button>
        ${todayList().length > 1 ? '<button class="pill" data-act="skip">Not now</button>' : ''}
      </div></div>`;
    if (showSteps) $('#stepInput')?.focus();
  }

  const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!act) return;
    if (act === 'plan') planDay();
    else if (act === 'done') complete(id);
    else if (act === 'skip') skip(id);
    else if (act === 'steps') { showSteps = !showSteps; render(); }
    else if (act === 'timer') { timer = { id, end: Date.now() + 10 * 60e3 }; render(); }
    else if (act === 'stop') { timer = null; render(); }
    else if (act === 'to-today') moveToToday(id);
    else if (act === 'to-later') moveToLater(id);
    else if (act === 'size') { const t = tasks.find((x) => x.id === id); t.size = SIZES[(SIZES.indexOf(t.size) + 1) % SIZES.length]; save(); render(); }
  });

  document.addEventListener('change', (e) => {
    if (!e.target.classList.contains('check')) return;
    const li = e.target.closest('li'); if (!li) return;
    if (li.dataset.sid) { // step toggle inside focus card
      const card = e.target.closest('[data-id]');
      const s = tasks.find((t) => t.id === card.dataset.id).steps.find((x) => x.id === li.dataset.sid);
      s.done = e.target.checked; save(); render();
    } else if (li.classList.contains('d')) reopen(li.dataset.id);
    else complete(li.dataset.id);
  });

  document.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'addForm') { add($('#addInput').value); $('#addInput').value = ''; }
    else if (e.target.id === 'stepForm') {
      const v = $('#stepInput').value.trim(); if (!v) return;
      const t = todayList()[0]; t.steps.push({ id: rid(), text: v, done: false }); save(); render();
    }
  });
  $('#planBtn').dataset.act = 'plan';

  // ---------- timer + toast ----------
  let toastTimer;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 2200);
  }
  setInterval(() => {
    if (!timer) return;
    const left = timer.end - Date.now();
    if (left <= 0) { timer = null; render(); toast('Time’s up. Keep going or take a break?'); try { navigator.vibrate?.(200); } catch {} }
    else { const el = $('#timerText'); if (el) el.textContent = fmt(left); }
  }, 500);

  render();
})();
