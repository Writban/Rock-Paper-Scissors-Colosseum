const MOVES = ['R', 'P', 'S'];
const MOVE_NAMES = { R: 'Rock', P: 'Paper', S: 'Scissors' };
const MOVE_ICONS = { R: '✊', P: '✋', S: '✌️' };
const COUNTER = { R: 'P', P: 'S', S: 'R' };

const LEVELS = ['L', 'S', 'H'];
const LEVEL_NAMES = { L: 'Light', S: 'Standard', H: 'Heavy' };
const LEVEL_DESCRIPTORS = { L: 'Feint', S: 'Proper attack', H: 'Full weight' };
const LEVEL_MULTIPLIERS = { L: 0.5, S: 1, H: 2 };
const BASE_DAMAGE = 1;

const state = {
  mode: 'arena',
  length: 5,
  selectedLevel: 'S',
  playerCurrent: [],
  playerOriginal: null,
  playerCommit: null,
  aiSequence: [],
  aiPredictions: [],
  aiLevelPredictions: [],
  aiNonce: null,
  aiCommit: null,
  aiCommitted: false,
  peeked: false,
  resolved: false,
  history: JSON.parse(localStorage.getItem('rps-gladiator-history') || '[]'),
};

const $ = (id) => document.getElementById(id);

const els = {
  modeArena: $('modeArena'), modePlayground: $('modePlayground'), modeLabel: $('modeLabel'),
  boutLength: $('boutLength'), playerSequence: $('playerSequence'), aiSequence: $('aiSequence'),
  movePicker: $('movePicker'), levelPicker: $('levelPicker'), selectedAttack: $('selectedAttack'),
  commitPlayerBtn: $('commitPlayerBtn'), peekBtn: $('peekBtn'), resolveBtn: $('resolveBtn'), newBoutBtn: $('newBoutBtn'),
  playgroundNotice: $('playgroundNotice'), playerLockBadge: $('playerLockBadge'), aiLockBadge: $('aiLockBadge'),
  aiHint: $('aiHint'), playerHint: $('playerHint'), aiCommitment: $('aiCommitment'), playerCommitment: $('playerCommitment'),
  currentBoutUsed: $('currentBoutUsed'), modelUpdate: $('modelUpdate'), toggleProofBtn: $('toggleProofBtn'),
  proofDetails: $('proofDetails'), verificationBadge: $('verificationBadge'), predictionBars: $('predictionBars'),
  intensityPredictionBars: $('intensityPredictionBars'), aiRank: $('aiRank'), observedBouts: $('observedBouts'), accuracy: $('accuracy'),
  resultPanel: $('resultPanel'), resultTitle: $('resultTitle'), resultScore: $('resultScore'), roundResults: $('roundResults'),
  fairnessComparison: $('fairnessComparison'), originalSequenceSummary: $('originalSequenceSummary'),
  alteredSequenceSummary: $('alteredSequenceSummary'), originalOutcome: $('originalOutcome'), alteredOutcome: $('alteredOutcome'),
  historyList: $('historyList'), resetBtn: $('resetBtn'), feedbackPanel: $('feedbackPanel'), feedbackSaved: $('feedbackSaved'),
  feedbackComment: $('feedbackComment'), saveFeedbackBtn: $('saveFeedbackBtn')
};

function normalizeAction(action) {
  if (!action) return null;
  if (typeof action === 'string') return { move: action, level: 'S' }; // migrate old prototype history
  return { move: action.move, level: action.level || 'S' };
}

function normalizeSequence(seq = []) {
  return seq.map(normalizeAction).filter(Boolean);
}

function actionToken(action) {
  const a = normalizeAction(action);
  return `${a.move}${a.level}`;
}

function serializeSequence(sequence) {
  return normalizeSequence(sequence).map(actionToken).join(',');
}

function formatDamage(value) {
  return Number.isInteger(value) ? `${value}D` : `${Number(value.toFixed(2))}D`;
}

function randomNonce() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map(v => v.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}

async function makeCommit(sequence) {
  const nonce = randomNonce();
  const payload = `${serializeSequence(sequence)}|${nonce}`;
  return { nonce, hash: await sha256(payload), payload };
}

function historicalPlayerSequence(bout) {
  return normalizeSequence(bout.playerOriginal || bout.player || []);
}

function allHistoricalActions() {
  return state.history.flatMap(historicalPlayerSequence);
}

function moveDistributionForPosition(position) {
  const counts = { R: 1, P: 1, S: 1 };
  for (const bout of state.history) {
    const seq = historicalPlayerSequence(bout);
    if (seq[position]) counts[seq[position].move] += 2.2;
    seq.forEach(a => counts[a.move] += 0.35);
  }

  const flat = allHistoricalActions();
  flat.slice(-12).forEach(a => counts[a.move] += 0.7);
  if (flat.length >= 2) {
    const prev = flat[flat.length - 1].move;
    for (let i = 0; i < flat.length - 1; i++) {
      if (flat[i].move === prev) counts[flat[i + 1].move] += 0.8;
    }
  }

  const total = counts.R + counts.P + counts.S;
  return Object.fromEntries(MOVES.map(m => [m, counts[m] / total]));
}

function levelDistributionForPosition(position) {
  const counts = { L: 1, S: 1, H: 1 };
  for (const bout of state.history) {
    const seq = historicalPlayerSequence(bout);
    if (seq[position]) counts[seq[position].level] += 2.0;
    seq.forEach(a => counts[a.level] += 0.25);
  }

  const flat = allHistoricalActions();
  flat.slice(-12).forEach(a => counts[a.level] += 0.55);
  const total = counts.L + counts.S + counts.H;
  return Object.fromEntries(LEVELS.map(l => [l, counts[l] / total]));
}

function sampleWeighted(dist, options) {
  let r = Math.random();
  for (const key of options) {
    r -= dist[key];
    if (r <= 0) return key;
  }
  return options[options.length - 1];
}

function maxProbability(dist, options) {
  return Math.max(...options.map(k => dist[k]));
}

function chooseAILevel(moveDist, levelDist) {
  // Intensity is a wager. The AI commits harder only when its symbol read is strong,
  // while also learning whether the player tends to expose themselves with Heavy attacks.
  const moveConfidence = maxProbability(moveDist, MOVES);
  const predictedPlayerLevel = LEVELS.reduce((best, l) => levelDist[l] > levelDist[best] ? l : best, 'L');
  const sophistication = Math.min(0.9, 0.45 + state.history.length * 0.035);

  if (Math.random() > sophistication) return LEVELS[Math.floor(Math.random() * LEVELS.length)];
  if (moveConfidence >= 0.49 || (moveConfidence >= 0.43 && predictedPlayerLevel === 'H')) return 'H';
  if (moveConfidence >= 0.38) return 'S';
  return 'L';
}

function generateAISequence(length) {
  // Deliberately receives only length and reads only historical bouts.
  // It never receives state.playerCurrent or state.playerOriginal.
  const sequence = [];
  const predictions = [];
  const levelPredictions = [];

  for (let i = 0; i < length; i++) {
    const moveDist = moveDistributionForPosition(i);
    const levelDist = levelDistributionForPosition(i);
    const predictedMove = sampleWeighted(moveDist, MOVES);
    const predictedLevel = sampleWeighted(levelDist, LEVELS);
    predictions.push(predictedMove);
    levelPredictions.push(predictedLevel);

    const sophistication = Math.min(0.88, 0.48 + state.history.length * 0.035);
    const move = Math.random() < sophistication ? COUNTER[predictedMove] : MOVES[Math.floor(Math.random() * 3)];
    const level = chooseAILevel(moveDist, levelDist);
    sequence.push({ move, level });
  }
  return { sequence, predictions, levelPredictions };
}

function rankName() {
  const n = state.history.length;
  if (n < 2) return 'Recruit';
  if (n < 5) return 'Observer';
  if (n < 10) return 'Tactician';
  return 'Champion';
}

async function commitAI() {
  const generated = generateAISequence(state.length);
  state.aiSequence = generated.sequence;
  state.aiPredictions = generated.predictions;
  state.aiLevelPredictions = generated.levelPredictions;
  const c = await makeCommit(state.aiSequence);
  state.aiNonce = c.nonce;
  state.aiCommit = c.hash;
  state.aiCommitted = true;
  renderAudit();
}

function resultOf(playerMove, aiMove) {
  if (playerMove === aiMove) return 0;
  return COUNTER[aiMove] === playerMove ? 1 : -1;
}

function clashDamage(winnerLevel, loserLevel) {
  return BASE_DAMAGE * LEVEL_MULTIPLIERS[winnerLevel] * LEVEL_MULTIPLIERS[loserLevel];
}

function scoreSequences(playerSeq, aiSeq) {
  let playerDamage = 0, aiDamage = 0, playerWins = 0, aiWins = 0, draws = 0;
  const pSeq = normalizeSequence(playerSeq);
  const cSeq = normalizeSequence(aiSeq);

  const rounds = pSeq.map((player, i) => {
    const ai = cSeq[i];
    const r = resultOf(player.move, ai.move);
    let damage = 0;
    if (r === 1) {
      playerWins++;
      damage = clashDamage(player.level, ai.level);
      playerDamage += damage;
    } else if (r === -1) {
      aiWins++;
      damage = clashDamage(ai.level, player.level);
      aiDamage += damage;
    } else {
      draws++;
    }
    return { i, player, ai, r, damage };
  });
  return { playerDamage, aiDamage, playerWins, aiWins, draws, rounds };
}

function describeOutcome(score, conditional = true) {
  const prefix = conditional ? 'would ' : '';
  if (score.playerDamage > score.aiDamage) return `You ${prefix}win ${formatDamage(score.playerDamage)}–${formatDamage(score.aiDamage)}`;
  if (score.aiDamage > score.playerDamage) return `Gladiator ${prefix}wins ${formatDamage(score.aiDamage)}–${formatDamage(score.playerDamage)}`;
  return `Draw ${formatDamage(score.playerDamage)}–${formatDamage(score.aiDamage)}`;
}

function actionMarkup(action, compact = false) {
  const a = normalizeAction(action);
  if (!a) return '?';
  const level = compact ? a.level : LEVEL_NAMES[a.level];
  return `${MOVE_ICONS[a.move]} <span class="action-level level-${a.level.toLowerCase()}">${level}</span>`;
}

function renderSlots(container, sequence, hidden = false) {
  const seq = normalizeSequence(sequence);
  container.innerHTML = '';
  container.style.gridTemplateColumns = `repeat(${state.length}, minmax(0,1fr))`;
  for (let i = 0; i < state.length; i++) {
    const frag = $('slotTemplate').content.cloneNode(true);
    frag.querySelector('.slot-index').textContent = String(i + 1).padStart(2, '0');
    const value = frag.querySelector('.slot-value');
    const action = seq[i];
    if (hidden) {
      value.innerHTML = '<span class="sealed-mark">◆</span><small>SEALED</small>';
    } else if (action) {
      value.innerHTML = `<span class="move-icon">${MOVE_ICONS[action.move]}</span><strong class="level-chip level-${action.level.toLowerCase()}">${action.level}</strong>`;
      value.title = `${MOVE_NAMES[action.move]} — ${LEVEL_NAMES[action.level]} (${LEVEL_DESCRIPTORS[action.level]}, ×${LEVEL_MULTIPLIERS[action.level]})`;
    } else {
      value.textContent = '?';
    }
    container.appendChild(frag);
  }
}

function renderBarGroup(container, keys, names, icons, distributionFn) {
  const dists = Array.from({ length: state.length }, (_, i) => distributionFn(i));
  const avg = Object.fromEntries(keys.map(k => [k, 0]));
  dists.forEach(d => keys.forEach(k => avg[k] += d[k] / dists.length));
  container.innerHTML = keys.map(k => `
    <div class="bar-row">
      <strong>${icons?.[k] || ''} ${names[k]}</strong>
      <div class="bar-track"><div class="bar-fill" style="width:${(avg[k] * 100).toFixed(1)}%"></div></div>
      <span>${(avg[k] * 100).toFixed(0)}%</span>
    </div>`).join('');
}

function renderPredictionBars() {
  renderBarGroup(els.predictionBars, MOVES, MOVE_NAMES, MOVE_ICONS, moveDistributionForPosition);
  renderBarGroup(els.intensityPredictionBars, LEVELS, LEVEL_NAMES, null, levelDistributionForPosition);
}

function renderAudit() {
  els.aiCommitment.textContent = state.aiCommit ? `${state.aiCommit.slice(0, 18)}…` : 'Not created';
  els.playerCommitment.textContent = state.playerCommit ? `${state.playerCommit.hash.slice(0, 18)}…` : 'Not created';
  els.currentBoutUsed.textContent = 'No';
  els.modelUpdate.textContent = state.peeked ? 'Original intention only; altered actions excluded' : 'After resolution only';

  const proof = [];
  if (state.aiCommit) proof.push(`AI commitment\n${state.aiCommit}`);
  if (state.aiNonce && state.resolved) proof.push(`\nAI revealed sequence\n${serializeSequence(state.aiSequence)}\nAI nonce\n${state.aiNonce}`);
  if (state.playerCommit) proof.push(`\nPlayer commitment\n${state.playerCommit.hash}`);
  if (state.playerCommit && state.resolved) proof.push(`\nOriginal player sequence\n${serializeSequence(state.playerOriginal)}\nPlayer nonce\n${state.playerCommit.nonce}`);
  els.proofDetails.textContent = proof.join('\n');
}

function renderHistory() {
  els.observedBouts.textContent = state.history.length;
  els.aiRank.textContent = rankName();
  if (!state.history.length) {
    els.historyList.innerHTML = '<p class="micro">No bouts observed yet.</p>';
    els.accuracy.textContent = '—';
    return;
  }

  els.historyList.innerHTML = state.history.slice().reverse().map((b, idx) => {
    const displayNum = state.history.length - idx;
    const seq = historicalPlayerSequence(b).map(a => `${MOVE_ICONS[a.move]}${a.level}`).join(' ');
    const tag = b.peeked ? 'FAIRNESS TEST' : 'ARENA';
    return `<div class="history-item"><strong>Bout ${displayNum}</strong><span class="seq">${seq}</span><span class="badge muted">${tag}</span></div>`;
  }).join('');

  let correct = 0, total = 0;
  for (const b of state.history) {
    if (!b.predictions) continue;
    const seq = historicalPlayerSequence(b);
    b.predictions.forEach((p, i) => { if (seq[i]) { total++; if (p === seq[i].move) correct++; } });
  }
  els.accuracy.textContent = total ? `${Math.round(correct / total * 100)}%` : '—';
}

function render() {
  renderSlots(els.playerSequence, state.playerCurrent, false);
  renderSlots(els.aiSequence, state.aiSequence, !state.peeked && !state.resolved);
  renderPredictionBars();
  renderAudit();
  renderHistory();

  els.modeArena.classList.toggle('active', state.mode === 'arena');
  els.modePlayground.classList.toggle('active', state.mode === 'playground');
  els.modeLabel.textContent = state.mode === 'arena' ? 'Arena' : 'Playground';
  els.playgroundNotice.hidden = state.mode !== 'playground';
  els.boutLength.disabled = state.playerCommit || state.resolved;

  document.querySelectorAll('[data-level]').forEach(btn => btn.classList.toggle('selected', btn.dataset.level === state.selectedLevel));
  els.selectedAttack.textContent = `${LEVEL_NAMES[state.selectedLevel]} — ${LEVEL_DESCRIPTORS[state.selectedLevel]} · ×${LEVEL_MULTIPLIERS[state.selectedLevel]} force / exposure`;

  const complete = state.playerCurrent.length === state.length;
  els.commitPlayerBtn.disabled = !complete || !!state.playerCommit || state.resolved;
  els.commitPlayerBtn.hidden = state.resolved;

  els.peekBtn.hidden = !(state.mode === 'playground' && state.playerCommit && !state.peeked && !state.resolved);
  els.resolveBtn.hidden = !(state.playerCommit && (state.mode === 'arena' || state.peeked) && !state.resolved);
  els.newBoutBtn.hidden = !state.resolved;

  els.playerLockBadge.textContent = state.playerCommit ? (state.peeked ? 'ORIGINAL SEALED' : 'LOCKED') : 'UNLOCKED';
  els.playerLockBadge.className = `badge ${state.playerCommit ? 'sealed' : 'muted'}`;
  els.aiLockBadge.textContent = state.aiCommitted ? (state.peeked || state.resolved ? 'REVEALED' : 'SEALED') : 'PREPARING';
  els.aiLockBadge.className = `badge ${state.aiCommitted ? 'sealed' : 'muted'}`;

  if (state.peeked && !state.resolved) {
    els.playerHint.textContent = 'Seal broken. Change any moves or intensities you want; your original committed intention remains preserved.';
    els.aiHint.textContent = 'You are viewing the exact symbols and intensities committed before the seal was broken.';
  } else {
    els.playerHint.textContent = state.mode === 'playground'
      ? 'Choose the sequence and attack intensity you genuinely intend to play, then lock it before the Gladiator commits.'
      : 'Choose each symbol and intensity. The Gladiator commitment was created before your input.';
    els.aiHint.textContent = 'The Gladiator has committed to a hidden sequence of symbols and intensities using only previous bouts.';
  }
}

async function startBout() {
  state.length = Number(els.boutLength.value);
  state.selectedLevel = 'S';
  state.playerCurrent = [];
  state.playerOriginal = null;
  state.playerCommit = null;
  state.aiSequence = [];
  state.aiPredictions = [];
  state.aiLevelPredictions = [];
  state.aiNonce = null;
  state.aiCommit = null;
  state.aiCommitted = false;
  state.peeked = false;
  state.resolved = false;
  els.resultPanel.hidden = true;
  els.feedbackPanel.hidden = true;
  els.feedbackSaved.textContent = 'OPTIONAL';
  els.feedbackSaved.className = 'badge muted';
  document.querySelectorAll('input[name="trust"], input[name="adapted"]').forEach(i => i.checked = false);
  els.feedbackComment.value = '';
  els.fairnessComparison.hidden = true;
  els.verificationBadge.textContent = 'WAITING';
  els.verificationBadge.className = 'badge muted';

  // In Arena, the AI commits immediately, before the player chooses any action.
  if (state.mode === 'arena') await commitAI();
  render();
}

function appendAction(move) {
  if (state.resolved) return;
  if (state.playerCommit && !state.peeked) return;
  if (state.playerCurrent.length >= state.length) state.playerCurrent.shift();
  state.playerCurrent.push({ move, level: state.selectedLevel });
  render();
}

async function commitPlayer() {
  if (state.playerCurrent.length !== state.length) return;
  state.playerOriginal = state.playerCurrent.map(a => ({ ...a }));
  state.playerCommit = await makeCommit(state.playerOriginal);

  // Playground deliberately commits AI only after the player's hash exists.
  // The generator still reads history only and receives no current action sequence.
  if (state.mode === 'playground' && !state.aiCommitted) await commitAI();
  render();
}

function peekAI() {
  if (state.mode !== 'playground' || !state.playerCommit || !state.aiCommitted) return;
  state.peeked = true;
  render();
}

async function resolveBout() {
  if (!state.playerCommit || !state.aiCommitted) return;
  if (state.mode === 'playground' && state.peeked && state.playerCurrent.length !== state.length) return;

  state.resolved = true;
  const actualScore = scoreSequences(state.playerCurrent, state.aiSequence);
  const originalScore = scoreSequences(state.playerOriginal, state.aiSequence);

  els.resultPanel.hidden = false;
  els.feedbackPanel.hidden = false;
  els.resultScore.textContent = `${formatDamage(actualScore.playerDamage)}–${formatDamage(actualScore.aiDamage)}`;
  els.resultTitle.textContent = actualScore.playerDamage > actualScore.aiDamage ? 'You win' : actualScore.aiDamage > actualScore.playerDamage ? 'Gladiator wins' : 'Draw';
  els.roundResults.innerHTML = actualScore.rounds.map(r => {
    const cls = r.r === 1 ? 'win' : r.r === -1 ? 'loss' : 'draw';
    const label = r.r === 1 ? 'YOU HIT' : r.r === -1 ? 'GLADIATOR HITS' : 'CLASH';
    const formula = r.r === 0
      ? 'Same symbol · 0D'
      : `${LEVEL_MULTIPLIERS[r.r === 1 ? r.player.level : r.ai.level]} × ${LEVEL_MULTIPLIERS[r.r === 1 ? r.ai.level : r.player.level]} = ${formatDamage(r.damage)}`;
    return `<div class="round-row">
      <strong>#${r.i + 1}</strong>
      <span><span class="who">YOU</span><br>${actionMarkup(r.player)}</span>
      <span><span class="who">AI</span><br>${actionMarkup(r.ai)}</span>
      <span class="damage-cell"><span class="outcome ${cls}">${label}</span><small>${formula}</small></span>
    </div>`;
  }).join('');

  if (state.mode === 'playground' && state.peeked) {
    els.fairnessComparison.hidden = false;
    els.originalSequenceSummary.innerHTML = normalizeSequence(state.playerOriginal).map(a => `<span class="mini-pill">${MOVE_ICONS[a.move]} ${a.level}</span>`).join('');
    els.alteredSequenceSummary.innerHTML = normalizeSequence(state.playerCurrent).map(a => `<span class="mini-pill">${MOVE_ICONS[a.move]} ${a.level}</span>`).join('');
    els.originalOutcome.textContent = describeOutcome(originalScore, true);
    els.alteredOutcome.textContent = describeOutcome(actualScore, false);
  }

  const aiCheck = await sha256(`${serializeSequence(state.aiSequence)}|${state.aiNonce}`);
  const playerCheck = await sha256(`${serializeSequence(state.playerOriginal)}|${state.playerCommit.nonce}`);
  const verified = aiCheck === state.aiCommit && playerCheck === state.playerCommit.hash;
  els.verificationBadge.textContent = verified ? 'VERIFIED' : 'FAILED';
  els.verificationBadge.className = `badge ${verified ? 'ok' : 'bad'}`;

  const record = {
    player: state.playerCurrent.map(a => ({ ...a })),
    playerOriginal: state.playerOriginal.map(a => ({ ...a })),
    ai: state.aiSequence.map(a => ({ ...a })),
    peeked: state.peeked,
    predictions: [...state.aiPredictions],
    levelPredictions: [...state.aiLevelPredictions],
    playerDamage: actualScore.playerDamage,
    aiDamage: actualScore.aiDamage,
    timestamp: Date.now()
  };
  state.history.push(record);
  localStorage.setItem('rps-gladiator-history', JSON.stringify(state.history));
  render();
}

function switchMode(mode) {
  state.mode = mode;
  startBout();
}

els.movePicker.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-move]');
  if (btn) appendAction(btn.dataset.move);
});
els.levelPicker.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-level]');
  if (!btn || state.resolved || (state.playerCommit && !state.peeked)) return;
  state.selectedLevel = btn.dataset.level;
  render();
});
els.commitPlayerBtn.addEventListener('click', commitPlayer);
els.peekBtn.addEventListener('click', peekAI);
els.resolveBtn.addEventListener('click', resolveBout);
els.newBoutBtn.addEventListener('click', startBout);
els.boutLength.addEventListener('change', startBout);
els.modeArena.addEventListener('click', () => switchMode('arena'));
els.modePlayground.addEventListener('click', () => switchMode('playground'));
els.toggleProofBtn.addEventListener('click', () => {
  els.proofDetails.hidden = !els.proofDetails.hidden;
  els.toggleProofBtn.textContent = els.proofDetails.hidden ? 'Show verification details' : 'Hide verification details';
});
els.resetBtn.addEventListener('click', () => {
  state.history = [];
  localStorage.removeItem('rps-gladiator-history');
  startBout();
});
els.saveFeedbackBtn.addEventListener('click', () => {
  const trust = document.querySelector('input[name="trust"]:checked')?.value || null;
  const adapted = document.querySelector('input[name="adapted"]:checked')?.value || null;
  const feedback = JSON.parse(localStorage.getItem('rps-gladiator-feedback') || '[]');
  feedback.push({
    trust,
    adapted,
    comment: els.feedbackComment.value.trim(),
    mode: state.mode,
    peeked: state.peeked,
    observedBouts: state.history.length,
    timestamp: Date.now()
  });
  localStorage.setItem('rps-gladiator-feedback', JSON.stringify(feedback));
  els.feedbackSaved.textContent = 'SAVED';
  els.feedbackSaved.className = 'badge ok';
});

startBout();
