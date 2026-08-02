const app = document.getElementById('app');
const TOPICS = JSON.parse(document.getElementById('topics-data').textContent);

const state = {
  difficulty: null,
  topic: null,
  qtype: null,
  practice: localStorage.getItem('practiceMode') === '1',
  mode: ['blitz', 'take5', 'ladder'].includes(localStorage.getItem('mode')) ? localStorage.getItem('mode') : 'qotd',
};

const QUESTION_TYPES = [
  { value: 'mcq', label: 'Multiple choice' },
  { value: 'fill-in-blank', label: 'Fill in the blank' },
  { value: 'drag-and-drop', label: 'Drag and drop' },
  { value: 'dropdown-order', label: 'Dropdown order' },
  { value: 'coding', label: 'Coding' },
];

const BLITZ_QUESTION_TYPES = QUESTION_TYPES.filter(t => t.value !== 'coding');
const BLITZ_DURATION_SECONDS = 60;
const TAKE5_LENGTH = 5;

async function api(path, opts) {
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.detail) || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function clear() { app.innerHTML = ''; }

// ── init ─────────────────────────────────────────────────────────────────────

async function init() {
  if (state.mode === 'blitz') {
    const stats = await api('/api/stats');
    renderBlitzSelector(stats);
    return;
  }
  if (state.mode === 'take5') {
    const stats = await api('/api/stats');
    renderTake5Selector(stats);
    return;
  }
  if (state.mode === 'ladder') {
    const stats = await api('/api/stats');
    renderLadderSelector(stats);
    return;
  }
  const [stateData, stats] = await Promise.all([
    api('/api/state' + (state.practice ? '?practice=1' : '')),
    api('/api/stats'),
  ]);
  if (stateData.locked) {
    renderLocked(stateData, stats);
  } else {
    renderSelector(stats);
  }
}

function boot() {
  init().catch(err => {
    clear();
    app.appendChild(el('div', { class: 'panel error-text' }, 'Failed to load: ' + err.message));
  });
}

// ── practice mode toggle ─────────────────────────────────────────────────────

const practiceToggle = document.getElementById('practice-toggle');

function updatePracticeToggleUI() {
  practiceToggle.textContent = `Practice Mode: ${state.practice ? 'On' : 'Off'}`;
  practiceToggle.classList.toggle('active', state.practice);
}

practiceToggle.addEventListener('click', () => {
  state.practice = !state.practice;
  localStorage.setItem('practiceMode', state.practice ? '1' : '0');
  updatePracticeToggleUI();
  boot();
});

updatePracticeToggleUI();

// ── mode tabs ────────────────────────────────────────────────────────────────

const modeTabs = document.getElementById('mode-tabs');

function updateModeTabsUI() {
  [...modeTabs.children].forEach(btn => btn.classList.toggle('active', btn.dataset.mode === state.mode));
  practiceToggle.style.display = state.mode === 'qotd' ? '' : 'none';
}

modeTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-tab');
  if (!btn || btn.dataset.mode === state.mode) return;
  state.mode = btn.dataset.mode;
  localStorage.setItem('mode', state.mode);
  updateModeTabsUI();
  boot();
});

updateModeTabsUI();

// ── locked view ──────────────────────────────────────────────────────────────

function renderLocked(stateData, stats) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h2', {}, "Today's question is done — come back tomorrow"));

  panel.appendChild(makeCountdownEl(stateData.seconds_until_reset));

  const today = stateData.today;
  panel.appendChild(el('div', { class: 'question-meta' }, [
    el('span', { class: 'badge' }, today.topic),
    el('span', { class: 'badge' }, today.difficulty),
    el('span', { class: 'badge' }, today.type),
  ]));
  panel.appendChild(el('div', { class: 'result-banner ' + (today.correct ? 'correct' : 'incorrect') },
    today.correct ? 'You got it right!' : 'Not quite.'));
  panel.appendChild(resultDetail('Question', today.prompt));
  panel.appendChild(resultDetail('Your answer', formatAnswer(today.user_answer, today.type)));
  panel.appendChild(resultDetail('Correct answer', formatAnswer(today.correct_answer, today.type)));
  if (today.explanation) panel.appendChild(resultDetail('Explanation', today.explanation));
  if (today.llm_feedback) panel.appendChild(resultDetail('Feedback', today.llm_feedback));

  app.appendChild(panel);
  app.appendChild(renderStatsPanel(stats));
}

function resultDetail(label, value) {
  const block = el('div', { class: 'result-block' });
  block.appendChild(el('h3', {}, label));
  block.appendChild(el('p', {}, value == null ? '—' : String(value)));
  return block;
}

function formatAnswer(answer, type) {
  if (Array.isArray(answer)) return answer.join(' → ');
  if (typeof answer === 'string' && (type === 'drag-and-drop' || type === 'dropdown-order')) {
    try {
      const parsed = JSON.parse(answer);
      if (Array.isArray(parsed)) return parsed.join(' → ');
    } catch (e) { /* not JSON, fall through */ }
  }
  return answer;
}

function formatCountdown(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function makeCountdownEl(seconds) {
  const countdown = el('div', { class: 'countdown' }, formatCountdown(seconds));
  let remaining = seconds;
  const interval = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    countdown.textContent = formatCountdown(remaining);
    if (remaining <= 0) clearInterval(interval);
  }, 1000);
  return countdown;
}

// ── stats panel ──────────────────────────────────────────────────────────────

function renderStatsPanel(stats) {
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h2', {}, 'Your stats'));
  panel.appendChild(el('div', { class: 'stats-grid' }, [
    statTile(stats.streak, 'Day streak'),
    statTile(stats.overall_pct != null ? stats.overall_pct + '%' : '—', 'Overall correct'),
    statTile(stats.total_attempts, 'Total answered'),
    statTile(stats.best_blitz_score != null ? stats.best_blitz_score : '—', 'Best blitz score'),
    statTile(stats.best_take5_score != null ? stats.best_take5_score + '/5' : '—', 'Best Take 5 score'),
    statTile(stats.best_ladder_score != null ? stats.best_ladder_score : '—', 'Best ladder score'),
  ]));

  panel.appendChild(el('div', { class: 'step-label' }, 'By difficulty'));
  panel.appendChild(breakdownList(stats.by_difficulty));

  const topicLabel = el('div', { class: 'step-label' }, 'By topic');
  topicLabel.style.marginTop = '1rem';
  panel.appendChild(topicLabel);
  panel.appendChild(breakdownList(stats.by_topic));

  panel.appendChild(renderResetControl());

  return panel;
}

function renderResetControl() {
  const wrap = el('div', { class: 'reset-control' });

  const resetBtn = el('button', { class: 'btn-danger' }, 'Reset progress…');
  const confirmRow = el('div', { class: 'reset-confirm', style: 'display:none' });
  const errBox = el('div', { class: 'error-text' });

  const cancelBtn = el('button', { class: 'btn-secondary' }, 'Cancel');
  const confirmBtn = el('button', { class: 'btn-danger' }, 'Yes, wipe everything');

  resetBtn.addEventListener('click', () => {
    resetBtn.style.display = 'none';
    confirmRow.style.display = '';
  });

  cancelBtn.addEventListener('click', () => {
    confirmRow.style.display = 'none';
    resetBtn.style.display = '';
  });

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.textContent = 'Wiping…';
    errBox.textContent = '';
    try {
      await api('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      boot();
    } catch (e) {
      errBox.textContent = e.message;
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      confirmBtn.textContent = 'Yes, wipe everything';
    }
  });

  confirmRow.appendChild(
    el('p', { class: 'reset-warning' },
      'This permanently deletes every attempt, stat, and streak. Questions are unaffected. This cannot be undone.')
  );
  confirmRow.appendChild(el('div', { class: 'reset-confirm-actions' }, [cancelBtn, confirmBtn]));
  confirmRow.appendChild(errBox);

  wrap.appendChild(resetBtn);
  wrap.appendChild(confirmRow);
  return wrap;
}

function statTile(value, label) {
  return el('div', { class: 'stat-tile' }, [
    el('div', { class: 'value' }, String(value)),
    el('div', { class: 'label' }, label),
  ]);
}

function breakdownList(groups) {
  const list = el('div', { class: 'breakdown-list' });
  const names = Object.keys(groups);
  if (!names.length) {
    list.appendChild(el('div', { class: 'breakdown-row' }, [el('span', {}, 'No data yet')]));
    return list;
  }
  for (const name of names) {
    const g = groups[name];
    list.appendChild(el('div', { class: 'breakdown-row' }, [
      el('span', {}, name),
      el('span', {}, `${g.pct}% (${g.correct}/${g.total})`),
    ]));
  }
  return list;
}

// ── selector flow ────────────────────────────────────────────────────────────

function renderSelector(stats) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h2', {}, "Today's question"));
  panel.appendChild(el('div', { class: 'step-label' }, 'Step 1 — Difficulty'));

  const step2 = el('div', { id: 'step2' });
  const step3 = el('div', { id: 'step3' });

  const diffGrid = el('div', { class: 'choice-grid' });
  ['Easy', 'Medium', 'Hard', 'Random'].forEach(label => {
    const value = label.toLowerCase();
    const btn = el('button', { class: 'choice-btn' }, label);
    btn.addEventListener('click', () => {
      [...diffGrid.children].forEach(c => c.classList.remove('selected'));
      btn.classList.add('selected');
      state.difficulty = value;
      renderTopicStep(step2, step3, stats);
    });
    diffGrid.appendChild(btn);
  });
  panel.appendChild(diffGrid);
  panel.appendChild(step2);
  panel.appendChild(step3);

  app.appendChild(panel);
  app.appendChild(renderStatsPanel(stats));
}

function renderTopicStep(step2, step3, stats) {
  step2.innerHTML = '';
  const label = el('div', { class: 'step-label' }, 'Step 2 — Topic');
  label.style.marginTop = '1.25rem';
  step2.appendChild(label);

  const select = el('select', { class: 'topic-select' });
  select.appendChild(el('option', { value: 'Random' }, 'Random (any topic)'));
  TOPICS.forEach(t => select.appendChild(el('option', { value: t }, t)));
  if (stats && stats.weakest_eligible) {
    select.appendChild(el('option', { value: 'Weakest' }, 'Weakest topic'));
  }
  select.addEventListener('change', () => {
    state.topic = select.value;
    renderTypeStep(step3);
  });
  step2.appendChild(select);

  state.topic = select.value;
  renderTypeStep(step3);
}

function renderTypeStep(step3) {
  step3.innerHTML = '';
  const label = el('div', { class: 'step-label' }, 'Step 3 — Question type');
  label.style.marginTop = '1.25rem';
  step3.appendChild(label);

  const select = el('select', { class: 'topic-select' });
  select.appendChild(el('option', { value: 'Random' }, 'Random (any type)'));
  QUESTION_TYPES.forEach(t => select.appendChild(el('option', { value: t.value }, t.label)));
  step3.appendChild(select);

  const errBox = el('div', { class: 'error-text' });
  const startBtn = el('button', { class: 'btn' }, 'Start');
  startBtn.style.marginTop = '1rem';
  startBtn.addEventListener('click', () => startQuestion(select.value, errBox));
  step3.appendChild(startBtn);
  step3.appendChild(errBox);
}

async function startQuestion(qtype, errBox) {
  state.qtype = qtype;
  try {
    const question = await api(
      `/api/question?difficulty=${encodeURIComponent(state.difficulty)}` +
      `&topic=${encodeURIComponent(state.topic)}&qtype=${encodeURIComponent(qtype)}` +
      (state.practice ? '&practice=1' : '')
    );
    renderQuestion(question);
  } catch (e) {
    errBox.textContent = e.message;
  }
}

// ── question view ────────────────────────────────────────────────────────────

function buildAnswerInput(q, panel) {
  let getAnswer = () => null;

  if (q.type === 'mcq') {
    const list = el('div', { class: 'mcq-options' });
    let selected = null;
    q.options.forEach(opt => {
      const radio = el('input', { type: 'radio', name: 'mcq', value: opt });
      const row = el('label', { class: 'mcq-option' }, [radio, el('span', {}, opt)]);
      radio.addEventListener('change', () => {
        [...list.children].forEach(c => c.classList.remove('selected'));
        row.classList.add('selected');
        selected = opt;
      });
      list.appendChild(row);
    });
    panel.appendChild(list);
    getAnswer = () => selected;

  } else if (q.type === 'fill-in-blank') {
    const input = el('input', { type: 'text', placeholder: 'Your answer' });
    panel.appendChild(input);
    getAnswer = () => input.value.trim();

  } else if (q.type === 'drag-and-drop') {
    let order = [...q.options];
    const list = el('ul', { class: 'dnd-list' });
    let dragIndex = null;

    function renderItems() {
      list.innerHTML = '';
      order.forEach((item, i) => {
        const li = el('li', { class: 'dnd-item', draggable: 'true' }, [
          el('span', { class: 'dnd-handle' }, '⠿'),
          el('span', {}, item),
        ]);
        li.addEventListener('dragstart', () => { dragIndex = i; li.classList.add('dragging'); });
        li.addEventListener('dragend', () => li.classList.remove('dragging'));
        li.addEventListener('dragover', (e) => e.preventDefault());
        li.addEventListener('drop', (e) => {
          e.preventDefault();
          if (dragIndex === null || dragIndex === i) return;
          const [moved] = order.splice(dragIndex, 1);
          order.splice(i, 0, moved);
          renderItems();
        });
        list.appendChild(li);
      });
    }
    renderItems();
    panel.appendChild(list);
    panel.appendChild(el('p', { class: 'spinner-text' }, 'Drag items to reorder them, top to bottom.'));
    getAnswer = () => JSON.stringify(order);

  } else if (q.type === 'dropdown-order') {
    const selects = q.options.map((_, i) => {
      const select = el('select', { class: 'dropdown-order-select' });
      select.appendChild(el('option', { value: '' }, `— position ${i + 1} —`));
      q.options.forEach(opt => select.appendChild(el('option', { value: opt }, opt)));
      return select;
    });
    const list = el('div', { class: 'dropdown-order-list' },
      selects.map((select, i) => el('div', { class: 'dropdown-order-row' }, [
        el('span', { class: 'dropdown-order-index' }, String(i + 1)),
        select,
      ]))
    );
    panel.appendChild(list);
    panel.appendChild(el('p', { class: 'spinner-text' }, 'Pick which item belongs at each position.'));
    getAnswer = () => {
      const values = selects.map(s => s.value);
      if (values.some(v => !v)) return null;
      return JSON.stringify(values);
    };

  } else if (q.type === 'coding') {
    const textarea = el('textarea', { class: 'code-input', placeholder: 'Write your solution here…' });
    panel.appendChild(textarea);
    getAnswer = () => textarea.value.trim();
  }

  return getAnswer;
}

function renderQuestion(q) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('div', { class: 'question-meta' }, [
    el('span', { class: 'badge' }, q.topic),
    el('span', { class: 'badge' }, q.difficulty),
    el('span', { class: 'badge' }, q.type),
  ]));
  panel.appendChild(el('div', { class: 'prompt-text' }, q.prompt));

  const getAnswer = buildAnswerInput(q, panel);

  const submitBtn = el('button', { class: 'btn' }, 'Submit');
  const errBox = el('div', { class: 'error-text' });

  submitBtn.addEventListener('click', async () => {
    const answer = getAnswer();
    if (!answer) {
      errBox.textContent = 'Please provide an answer.';
      return;
    }
    errBox.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = q.type === 'coding' ? 'Grading…' : 'Submitting…';
    try {
      const result = await api('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: q.id, user_answer: answer, practice: state.practice }),
      });
      renderResult(q, answer, result);
    } catch (e) {
      errBox.textContent = e.message;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
    }
  });

  panel.appendChild(submitBtn);
  panel.appendChild(errBox);
  app.appendChild(panel);
}

// ── result view ──────────────────────────────────────────────────────────────

function renderResult(q, userAnswer, result) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('div', { class: 'result-banner ' + (result.correct ? 'correct' : 'incorrect') },
    result.correct ? 'Correct!' : 'Not quite.'));
  panel.appendChild(resultDetail('Your answer', formatAnswer(userAnswer, q.type)));
  panel.appendChild(resultDetail('Correct answer', formatAnswer(result.correct_answer, q.type)));
  if (result.explanation) panel.appendChild(resultDetail('Explanation', result.explanation));
  if (result.llm_feedback) panel.appendChild(resultDetail('Feedback', result.llm_feedback));

  if (state.practice) {
    panel.appendChild(el('p', { class: 'spinner-text' }, 'Practice mode is on — answer another whenever you like.'));
    const nextBtn = el('button', { class: 'btn' }, 'Next question');
    nextBtn.style.marginTop = '0.5rem';
    nextBtn.addEventListener('click', () => {
      api('/api/stats').then(renderSelector).catch(() => renderSelector({ by_difficulty: {}, by_topic: {} }));
    });
    panel.appendChild(nextBtn);
  } else {
    panel.appendChild(el('p', { class: 'spinner-text' }, "That's your one question for today — see you tomorrow."));
    const countdownSlot = el('div', {});
    panel.appendChild(countdownSlot);
    api('/api/state').then(stateData => {
      if (stateData.locked) countdownSlot.appendChild(makeCountdownEl(stateData.seconds_until_reset));
    }).catch(() => {});
  }

  app.appendChild(panel);

  api('/api/stats').then(stats => app.appendChild(renderStatsPanel(stats))).catch(() => {});
}

// ── blitz mode ───────────────────────────────────────────────────────────────

function formatBlitzTime(seconds) {
  return `0:${String(seconds).padStart(2, '0')}`;
}

function renderBlitzSelector(stats) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h2', {}, 'Blitz — 60 seconds, answer as many as you can'));
  panel.appendChild(el('div', { class: 'step-label' }, 'Step 1 — Difficulty'));

  const step2 = el('div', { id: 'blitz-step2' });
  const step3 = el('div', { id: 'blitz-step3' });
  const selection = { difficulty: null, topic: null };

  const diffGrid = el('div', { class: 'choice-grid' });
  ['Easy', 'Medium', 'Hard', 'Random'].forEach(label => {
    const value = label.toLowerCase();
    const btn = el('button', { class: 'choice-btn' }, label);
    btn.addEventListener('click', () => {
      [...diffGrid.children].forEach(c => c.classList.remove('selected'));
      btn.classList.add('selected');
      selection.difficulty = value;
      renderBlitzTopicStep(step2, step3, stats, selection);
    });
    diffGrid.appendChild(btn);
  });
  panel.appendChild(diffGrid);
  panel.appendChild(step2);
  panel.appendChild(step3);

  app.appendChild(panel);
  app.appendChild(renderStatsPanel(stats));
}

function renderBlitzTopicStep(step2, step3, stats, selection) {
  step2.innerHTML = '';
  const label = el('div', { class: 'step-label' }, 'Step 2 — Topic');
  label.style.marginTop = '1.25rem';
  step2.appendChild(label);

  const select = el('select', { class: 'topic-select' });
  select.appendChild(el('option', { value: 'Random' }, 'Random (any topic)'));
  TOPICS.forEach(t => select.appendChild(el('option', { value: t }, t)));
  if (stats && stats.weakest_eligible) {
    select.appendChild(el('option', { value: 'Weakest' }, 'Weakest topic'));
  }
  select.addEventListener('change', () => {
    selection.topic = select.value;
    renderBlitzTypeStep(step3, selection);
  });
  step2.appendChild(select);

  selection.topic = select.value;
  renderBlitzTypeStep(step3, selection);
}

function renderBlitzTypeStep(step3, selection) {
  step3.innerHTML = '';
  const label = el('div', { class: 'step-label' }, 'Step 3 — Question type');
  label.style.marginTop = '1.25rem';
  step3.appendChild(label);

  const select = el('select', { class: 'topic-select' });
  select.appendChild(el('option', { value: 'Random' }, 'Random (any type)'));
  BLITZ_QUESTION_TYPES.forEach(t => select.appendChild(el('option', { value: t.value }, t.label)));
  step3.appendChild(select);

  const errBox = el('div', { class: 'error-text' });
  const startBtn = el('button', { class: 'btn' }, 'Start Blitz');
  startBtn.style.marginTop = '1rem';
  startBtn.addEventListener('click', () => startBlitzRun(selection.difficulty, selection.topic, select.value));
  step3.appendChild(startBtn);
  step3.appendChild(errBox);
}

function startBlitzRun(difficulty, topic, qtype) {
  const run = {
    difficulty, topic, qtype,
    secondsLeft: BLITZ_DURATION_SECONDS,
    score: 0,
    total: 0,
    seenIds: [],
    active: true,
    pending: false,
    timeUp: false,
    finished: false,
  };
  renderBlitzShell(run);
}

function renderBlitzShell(run) {
  clear();
  const panel = el('div', { class: 'panel blitz-panel' });

  const header = el('div', { class: 'blitz-header' });
  const timerEl = el('div', { class: 'blitz-timer' }, formatBlitzTime(run.secondsLeft));
  const scoreEl = el('div', { class: 'blitz-score' }, `Score: ${run.score}`);
  header.appendChild(timerEl);
  header.appendChild(scoreEl);
  panel.appendChild(header);

  const slot = el('div', { id: 'blitz-question-slot' }, [el('div', { class: 'loading' }, 'Loading…')]);
  panel.appendChild(slot);

  app.appendChild(panel);

  run.timerEl = timerEl;
  run.scoreEl = scoreEl;
  run.timerHandle = setInterval(() => {
    run.secondsLeft = Math.max(0, run.secondsLeft - 1);
    timerEl.textContent = formatBlitzTime(run.secondsLeft);
    if (run.secondsLeft <= 0) {
      clearInterval(run.timerHandle);
      run.active = false;
      run.timeUp = true;
      if (!run.pending) finalizeBlitz(run);
    }
  }, 1000);

  loadNextBlitzQuestion(run);
}

async function loadNextBlitzQuestion(run) {
  const slot = document.getElementById('blitz-question-slot');
  if (!slot) return;
  slot.innerHTML = '';
  slot.appendChild(el('div', { class: 'loading' }, 'Loading…'));
  try {
    const q = await api(
      `/api/blitz/question?difficulty=${encodeURIComponent(run.difficulty)}` +
      `&topic=${encodeURIComponent(run.topic)}&qtype=${encodeURIComponent(run.qtype)}` +
      `&exclude=${run.seenIds.slice(-30).join(',')}`
    );
    if (!run.active || run.finished) return;
    renderBlitzQuestionInto(slot, run, q);
  } catch (e) {
    if (!run.active || run.finished) return;
    slot.innerHTML = '';
    slot.appendChild(el('div', { class: 'error-text' }, 'Failed to load question: ' + e.message));
  }
}

function renderBlitzQuestionInto(slot, run, q) {
  slot.innerHTML = '';
  slot.appendChild(el('div', { class: 'question-meta' }, [
    el('span', { class: 'badge' }, q.topic),
    el('span', { class: 'badge' }, q.difficulty),
    el('span', { class: 'badge' }, q.type),
  ]));
  slot.appendChild(el('div', { class: 'prompt-text' }, q.prompt));

  const getAnswer = buildAnswerInput(q, slot);

  const submitBtn = el('button', { class: 'btn' }, 'Submit');
  const errBox = el('div', { class: 'error-text' });

  submitBtn.addEventListener('click', async () => {
    const answer = getAnswer();
    if (!answer) {
      errBox.textContent = 'Please provide an answer.';
      return;
    }
    if (run.pending || run.finished) return;
    errBox.textContent = '';
    submitBtn.disabled = true;
    run.pending = true;
    run.seenIds.push(q.id);

    try {
      const result = await api('/api/blitz/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: q.id, user_answer: answer }),
      });
      run.total += 1;
      if (result.correct) run.score += 1;
      run.pending = false;
      run.scoreEl.textContent = `Score: ${run.score}`;

      if (run.timeUp || !run.active) {
        finalizeBlitz(run);
        return;
      }
      loadNextBlitzQuestion(run);
    } catch (e) {
      run.pending = false;
      errBox.textContent = e.message;
      submitBtn.disabled = false;
      if (run.timeUp) finalizeBlitz(run);
    }
  });

  slot.appendChild(submitBtn);
  slot.appendChild(errBox);
}

async function finalizeBlitz(run) {
  if (run.finished) return;
  run.finished = true;

  let bestInfo = { best_score: null, is_new_best: false };
  try {
    bestInfo = await api('/api/blitz/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        difficulty: run.difficulty, topic: run.topic, qtype: run.qtype,
        score: run.score, total: run.total,
      }),
    });
  } catch (e) { /* still show local result even if persisting the run failed */ }

  renderBlitzResult(run, bestInfo);
}

function renderBlitzResult(run, bestInfo) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h2', {}, "Time's up!"));

  if (bestInfo.is_new_best && run.score > 0) {
    panel.appendChild(el('div', { class: 'result-banner correct' }, 'New best blitz score!'));
  }

  panel.appendChild(el('div', { class: 'question-meta' }, [
    el('span', { class: 'badge' }, run.difficulty),
    el('span', { class: 'badge' }, run.topic),
    el('span', { class: 'badge' }, run.qtype),
  ]));

  panel.appendChild(el('div', { class: 'stats-grid' }, [
    statTile(run.score, 'Correct'),
    statTile(run.total, 'Answered'),
    statTile(bestInfo.best_score != null ? bestInfo.best_score : run.score, 'Best blitz score'),
  ]));

  const againBtn = el('button', { class: 'btn' }, 'Play again');
  againBtn.style.marginTop = '1.25rem';
  againBtn.addEventListener('click', () => {
    api('/api/stats').then(renderBlitzSelector).catch(() => renderBlitzSelector({ by_difficulty: {}, by_topic: {} }));
  });
  panel.appendChild(againBtn);

  app.appendChild(panel);
  api('/api/stats').then(stats => app.appendChild(renderStatsPanel(stats))).catch(() => {});
}

// ── take 5 mode ──────────────────────────────────────────────────────────────

function renderTake5Selector(stats) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h2', {}, 'Take 5 — five questions, no clock'));
  panel.appendChild(el('div', { class: 'step-label' }, 'Step 1 — Difficulty'));

  const step2 = el('div', { id: 'take5-step2' });
  const step3 = el('div', { id: 'take5-step3' });
  const selection = { difficulty: null, topic: null };

  const diffGrid = el('div', { class: 'choice-grid' });
  ['Easy', 'Medium', 'Hard', 'Random'].forEach(label => {
    const value = label.toLowerCase();
    const btn = el('button', { class: 'choice-btn' }, label);
    btn.addEventListener('click', () => {
      [...diffGrid.children].forEach(c => c.classList.remove('selected'));
      btn.classList.add('selected');
      selection.difficulty = value;
      renderTake5TopicStep(step2, step3, stats, selection);
    });
    diffGrid.appendChild(btn);
  });
  panel.appendChild(diffGrid);
  panel.appendChild(step2);
  panel.appendChild(step3);

  app.appendChild(panel);
  app.appendChild(renderStatsPanel(stats));
}

function renderTake5TopicStep(step2, step3, stats, selection) {
  step2.innerHTML = '';
  const label = el('div', { class: 'step-label' }, 'Step 2 — Topic');
  label.style.marginTop = '1.25rem';
  step2.appendChild(label);

  const select = el('select', { class: 'topic-select' });
  select.appendChild(el('option', { value: 'Random' }, 'Random (any topic)'));
  TOPICS.forEach(t => select.appendChild(el('option', { value: t }, t)));
  if (stats && stats.weakest_eligible) {
    select.appendChild(el('option', { value: 'Weakest' }, 'Weakest topic'));
  }
  select.addEventListener('change', () => {
    selection.topic = select.value;
    renderTake5TypeStep(step3, selection);
  });
  step2.appendChild(select);

  selection.topic = select.value;
  renderTake5TypeStep(step3, selection);
}

function renderTake5TypeStep(step3, selection) {
  step3.innerHTML = '';
  const label = el('div', { class: 'step-label' }, 'Step 3 — Question type');
  label.style.marginTop = '1.25rem';
  step3.appendChild(label);

  const select = el('select', { class: 'topic-select' });
  select.appendChild(el('option', { value: 'Random' }, 'Random (any type)'));
  QUESTION_TYPES.forEach(t => select.appendChild(el('option', { value: t.value }, t.label)));
  step3.appendChild(select);

  const errBox = el('div', { class: 'error-text' });
  const startBtn = el('button', { class: 'btn' }, 'Start Take 5');
  startBtn.style.marginTop = '1rem';
  startBtn.addEventListener('click', () => startTake5Run(selection.difficulty, selection.topic, select.value));
  step3.appendChild(startBtn);
  step3.appendChild(errBox);
}

function startTake5Run(difficulty, topic, qtype) {
  const run = {
    difficulty, topic, qtype,
    index: 0,
    score: 0,
    seenIds: [],
  };
  loadNextTake5Question(run);
}

async function loadNextTake5Question(run) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('div', { class: 'loading' }, 'Loading…'));
  app.appendChild(panel);
  try {
    const q = await api(
      `/api/take5/question?difficulty=${encodeURIComponent(run.difficulty)}` +
      `&topic=${encodeURIComponent(run.topic)}&qtype=${encodeURIComponent(run.qtype)}` +
      `&exclude=${run.seenIds.join(',')}`
    );
    renderTake5Question(run, q);
  } catch (e) {
    clear();
    const errPanel = el('div', { class: 'panel' });
    errPanel.appendChild(el('div', { class: 'error-text' }, 'Failed to load question: ' + e.message));
    app.appendChild(errPanel);
  }
}

function renderTake5Question(run, q) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('div', { class: 'step-label' }, `Question ${run.index + 1} of ${TAKE5_LENGTH}`));
  panel.appendChild(el('div', { class: 'question-meta' }, [
    el('span', { class: 'badge' }, q.topic),
    el('span', { class: 'badge' }, q.difficulty),
    el('span', { class: 'badge' }, q.type),
  ]));
  panel.appendChild(el('div', { class: 'prompt-text' }, q.prompt));

  const getAnswer = buildAnswerInput(q, panel);

  const submitBtn = el('button', { class: 'btn' }, 'Submit');
  const errBox = el('div', { class: 'error-text' });

  submitBtn.addEventListener('click', async () => {
    const answer = getAnswer();
    if (!answer) {
      errBox.textContent = 'Please provide an answer.';
      return;
    }
    errBox.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = q.type === 'coding' ? 'Grading…' : 'Submitting…';
    run.seenIds.push(q.id);

    try {
      const result = await api('/api/take5/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: q.id, user_answer: answer }),
      });
      if (result.correct) run.score += 1;
      renderTake5Result(run, q, answer, result);
    } catch (e) {
      errBox.textContent = e.message;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
    }
  });

  panel.appendChild(submitBtn);
  panel.appendChild(errBox);
  app.appendChild(panel);
}

function renderTake5Result(run, q, userAnswer, result) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('div', { class: 'step-label' }, `Question ${run.index + 1} of ${TAKE5_LENGTH}`));
  panel.appendChild(el('div', { class: 'result-banner ' + (result.correct ? 'correct' : 'incorrect') },
    result.correct ? 'Correct!' : 'Not quite.'));
  panel.appendChild(resultDetail('Your answer', formatAnswer(userAnswer, q.type)));
  panel.appendChild(resultDetail('Correct answer', formatAnswer(result.correct_answer, q.type)));
  if (result.explanation) panel.appendChild(resultDetail('Explanation', result.explanation));
  if (result.llm_feedback) panel.appendChild(resultDetail('Feedback', result.llm_feedback));

  run.index += 1;
  const nextBtn = el('button', { class: 'btn' }, run.index < TAKE5_LENGTH ? 'Next question' : 'See results');
  nextBtn.style.marginTop = '1rem';
  nextBtn.addEventListener('click', () => {
    if (run.index < TAKE5_LENGTH) {
      loadNextTake5Question(run);
    } else {
      finalizeTake5(run);
    }
  });
  panel.appendChild(nextBtn);
  app.appendChild(panel);
}

async function finalizeTake5(run) {
  let bestInfo = { best_score: null, is_new_best: false };
  try {
    bestInfo = await api('/api/take5/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        difficulty: run.difficulty, topic: run.topic, qtype: run.qtype,
        score: run.score, total: TAKE5_LENGTH,
      }),
    });
  } catch (e) { /* still show local result even if persisting the run failed */ }

  renderTake5Final(run, bestInfo);
}

function renderTake5Final(run, bestInfo) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h2', {}, 'Take 5 complete'));

  if (bestInfo.is_new_best && run.score > 0) {
    panel.appendChild(el('div', { class: 'result-banner correct' }, 'New best Take 5 score!'));
  }

  panel.appendChild(el('div', { class: 'question-meta' }, [
    el('span', { class: 'badge' }, run.difficulty),
    el('span', { class: 'badge' }, run.topic),
    el('span', { class: 'badge' }, run.qtype),
  ]));

  panel.appendChild(el('div', { class: 'stats-grid' }, [
    statTile(`${run.score}/${TAKE5_LENGTH}`, 'Score'),
    statTile(bestInfo.best_score != null ? bestInfo.best_score + '/5' : run.score + '/5', 'Best Take 5 score'),
  ]));

  const againBtn = el('button', { class: 'btn' }, 'Play again');
  againBtn.style.marginTop = '1.25rem';
  againBtn.addEventListener('click', () => {
    api('/api/stats').then(renderTake5Selector).catch(() => renderTake5Selector({ by_difficulty: {}, by_topic: {} }));
  });
  panel.appendChild(againBtn);

  app.appendChild(panel);
  api('/api/stats').then(stats => app.appendChild(renderStatsPanel(stats))).catch(() => {});
}

// ── ladder mode ──────────────────────────────────────────────────────────────

const LADDER_DIFFICULTY_ORDER = ['easy', 'medium', 'hard'];

function renderLadderSelector(stats) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h2', {}, 'Ladder — climb each subject: easy → medium → hard'));
  panel.appendChild(el('div', { class: 'step-label' },
    'Pick one or more subjects, in the order you want to play them. One wrong answer ends the run.'));

  const selectedTopics = [];
  const buttons = {};
  const grid = el('div', { class: 'choice-grid' });

  const errBox = el('div', { class: 'error-text' });
  const startBtn = el('button', { class: 'btn' }, 'Start Ladder');
  startBtn.disabled = true;
  startBtn.style.marginTop = '1rem';

  function updateTopicButtons() {
    TOPICS.forEach(topic => {
      const btn = buttons[topic];
      const pos = selectedTopics.indexOf(topic);
      if (pos === -1) {
        btn.classList.remove('selected');
        btn.textContent = topic;
      } else {
        btn.classList.add('selected');
        btn.textContent = `${pos + 1}. ${topic}`;
      }
    });
    startBtn.disabled = selectedTopics.length === 0;
  }

  TOPICS.forEach(topic => {
    const btn = el('button', { class: 'choice-btn' }, topic);
    btn.addEventListener('click', () => {
      const pos = selectedTopics.indexOf(topic);
      if (pos === -1) selectedTopics.push(topic);
      else selectedTopics.splice(pos, 1);
      updateTopicButtons();
    });
    buttons[topic] = btn;
    grid.appendChild(btn);
  });

  startBtn.addEventListener('click', () => {
    if (!selectedTopics.length) return;
    startLadderRun([...selectedTopics]);
  });

  panel.appendChild(grid);
  panel.appendChild(startBtn);
  panel.appendChild(errBox);

  app.appendChild(panel);
  app.appendChild(renderStatsPanel(stats));
}

function startLadderRun(topics) {
  const run = { topics, topicIndex: 0, difficulty: 'easy', score: 0, seenIds: [] };
  loadNextLadderQuestion(run);
}

async function loadNextLadderQuestion(run) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('div', { class: 'loading' }, 'Loading…'));
  app.appendChild(panel);
  try {
    const topic = run.topics[run.topicIndex];
    const q = await api(
      `/api/ladder/question?topic=${encodeURIComponent(topic)}` +
      `&difficulty=${encodeURIComponent(run.difficulty)}&exclude=${run.seenIds.join(',')}`
    );
    renderLadderQuestion(run, q);
  } catch (e) {
    clear();
    const errPanel = el('div', { class: 'panel' });
    errPanel.appendChild(el('div', { class: 'error-text' }, 'Failed to load question: ' + e.message));
    app.appendChild(errPanel);
  }
}

function renderLadderQuestion(run, q) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('div', { class: 'step-label' },
    `Subject ${run.topicIndex + 1} of ${run.topics.length} — ${run.topics[run.topicIndex]}`));
  panel.appendChild(el('div', { class: 'question-meta' }, [
    el('span', { class: 'badge' }, q.topic),
    el('span', { class: 'badge' }, q.difficulty),
    el('span', { class: 'badge' }, q.type),
    el('span', { class: 'badge' }, `Score: ${run.score}`),
  ]));
  panel.appendChild(el('div', { class: 'prompt-text' }, q.prompt));

  const getAnswer = buildAnswerInput(q, panel);

  const submitBtn = el('button', { class: 'btn' }, 'Submit');
  const errBox = el('div', { class: 'error-text' });

  submitBtn.addEventListener('click', async () => {
    const answer = getAnswer();
    if (!answer) {
      errBox.textContent = 'Please provide an answer.';
      return;
    }
    errBox.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = q.type === 'coding' ? 'Grading…' : 'Submitting…';
    run.seenIds.push(q.id);

    try {
      const result = await api('/api/ladder/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: q.id, user_answer: answer }),
      });
      if (result.correct) run.score += 1;
      renderLadderResult(run, q, answer, result);
    } catch (e) {
      errBox.textContent = e.message;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
    }
  });

  panel.appendChild(submitBtn);
  panel.appendChild(errBox);
  app.appendChild(panel);
}

function _advanceLadder(run) {
  const idx = LADDER_DIFFICULTY_ORDER.indexOf(run.difficulty);
  if (idx < LADDER_DIFFICULTY_ORDER.length - 1) {
    run.difficulty = LADDER_DIFFICULTY_ORDER[idx + 1];
    return { cleared: false };
  }
  run.topicIndex += 1;
  if (run.topicIndex >= run.topics.length) {
    return { cleared: true };
  }
  run.difficulty = 'easy';
  return { cleared: false };
}

function renderLadderResult(run, q, userAnswer, result) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('div', { class: 'step-label' },
    `Subject ${run.topicIndex + 1} of ${run.topics.length} — ${run.topics[run.topicIndex]}`));
  panel.appendChild(el('div', { class: 'result-banner ' + (result.correct ? 'correct' : 'incorrect') },
    result.correct ? 'Correct!' : 'Not quite — the ladder ends here.'));
  panel.appendChild(resultDetail('Your answer', formatAnswer(userAnswer, q.type)));
  panel.appendChild(resultDetail('Correct answer', formatAnswer(result.correct_answer, q.type)));
  if (result.explanation) panel.appendChild(resultDetail('Explanation', result.explanation));
  if (result.llm_feedback) panel.appendChild(resultDetail('Feedback', result.llm_feedback));

  const nextBtn = el('button', { class: 'btn' });
  nextBtn.style.marginTop = '1rem';

  if (!result.correct) {
    nextBtn.textContent = 'See results';
    nextBtn.addEventListener('click', () => finalizeLadder(run, false));
  } else {
    const { cleared } = _advanceLadder(run);
    if (cleared) {
      nextBtn.textContent = 'See results';
      nextBtn.addEventListener('click', () => finalizeLadder(run, true));
    } else {
      nextBtn.textContent = 'Next question';
      nextBtn.addEventListener('click', () => loadNextLadderQuestion(run));
    }
  }

  panel.appendChild(nextBtn);
  app.appendChild(panel);
}

async function finalizeLadder(run, cleared) {
  let bestInfo = { best_score: null, is_new_best: false };
  try {
    bestInfo = await api('/api/ladder/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topics: run.topics, score: run.score }),
    });
  } catch (e) { /* still show local result even if persisting the run failed */ }

  renderLadderFinal(run, cleared, bestInfo);
}

function renderLadderFinal(run, cleared, bestInfo) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h2', {}, cleared ? 'Ladder complete! You cleared every subject.' : 'Game over'));

  if (bestInfo.is_new_best && run.score > 0) {
    panel.appendChild(el('div', { class: 'result-banner correct' }, 'New best ladder score!'));
  }

  panel.appendChild(el('div', { class: 'question-meta' },
    run.topics.map((t, i) => el('span', { class: 'badge' }, `${i + 1}. ${t}`))));

  panel.appendChild(el('div', { class: 'stats-grid' }, [
    statTile(run.score, 'Score'),
    statTile(bestInfo.best_score != null ? bestInfo.best_score : run.score, 'Best ladder score'),
  ]));

  const againBtn = el('button', { class: 'btn' }, 'Play again');
  againBtn.style.marginTop = '1.25rem';
  againBtn.addEventListener('click', () => {
    api('/api/stats').then(renderLadderSelector).catch(() => renderLadderSelector({ by_difficulty: {}, by_topic: {} }));
  });
  panel.appendChild(againBtn);

  app.appendChild(panel);
  api('/api/stats').then(stats => app.appendChild(renderStatsPanel(stats))).catch(() => {});
}

boot();
