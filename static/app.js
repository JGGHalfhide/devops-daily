const app = document.getElementById('app');
const TOPICS = JSON.parse(document.getElementById('topics-data').textContent);

const state = {
  difficulty: null,
  topic: null,
};

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
  const [stateData, stats] = await Promise.all([api('/api/state'), api('/api/stats')]);
  if (stateData.locked) {
    renderLocked(stateData, stats);
  } else {
    renderSelector(stats);
  }
}

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
  ]));

  panel.appendChild(el('div', { class: 'step-label' }, 'By difficulty'));
  panel.appendChild(breakdownList(stats.by_difficulty));

  const topicLabel = el('div', { class: 'step-label' }, 'By topic');
  topicLabel.style.marginTop = '1rem';
  panel.appendChild(topicLabel);
  panel.appendChild(breakdownList(stats.by_topic));

  return panel;
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

  const diffGrid = el('div', { class: 'choice-grid' });
  ['Easy', 'Medium', 'Hard', 'Random'].forEach(label => {
    const value = label.toLowerCase();
    const btn = el('button', { class: 'choice-btn' }, label);
    btn.addEventListener('click', () => {
      [...diffGrid.children].forEach(c => c.classList.remove('selected'));
      btn.classList.add('selected');
      state.difficulty = value;
      renderTopicStep(step2, stats);
    });
    diffGrid.appendChild(btn);
  });
  panel.appendChild(diffGrid);

  const step2 = el('div', { id: 'step2' });
  panel.appendChild(step2);

  app.appendChild(panel);
  app.appendChild(renderStatsPanel(stats));
}

function renderTopicStep(step2, stats) {
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
  step2.appendChild(select);

  const errBox = el('div', { class: 'error-text' });
  const startBtn = el('button', { class: 'btn' }, 'Start');
  startBtn.style.marginTop = '1rem';
  startBtn.addEventListener('click', () => startQuestion(select.value, errBox));
  step2.appendChild(startBtn);
  step2.appendChild(errBox);
}

async function startQuestion(topic, errBox) {
  state.topic = topic;
  try {
    const question = await api(
      `/api/question?difficulty=${encodeURIComponent(state.difficulty)}&topic=${encodeURIComponent(topic)}`
    );
    renderQuestion(question);
  } catch (e) {
    errBox.textContent = e.message;
  }
}

// ── question view ────────────────────────────────────────────────────────────

function renderQuestion(q) {
  clear();
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('div', { class: 'question-meta' }, [
    el('span', { class: 'badge' }, q.topic),
    el('span', { class: 'badge' }, q.difficulty),
    el('span', { class: 'badge' }, q.type),
  ]));
  panel.appendChild(el('div', { class: 'prompt-text' }, q.prompt));

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
        body: JSON.stringify({ question_id: q.id, user_answer: answer }),
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
  panel.appendChild(el('p', { class: 'spinner-text' }, "That's your one question for today — see you tomorrow."));

  const countdownSlot = el('div', {});
  panel.appendChild(countdownSlot);

  app.appendChild(panel);

  api('/api/state').then(stateData => {
    if (stateData.locked) countdownSlot.appendChild(makeCountdownEl(stateData.seconds_until_reset));
  }).catch(() => {});

  api('/api/stats').then(stats => app.appendChild(renderStatsPanel(stats))).catch(() => {});
}

init().catch(err => {
  clear();
  app.appendChild(el('div', { class: 'panel error-text' }, 'Failed to load: ' + err.message));
});
