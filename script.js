/* =====================
   漢字のなりたちブックかるた - script
   ===================== */

/*
【データ仕様（data/list02.json）】
[
  {"image":"001.jpg", "A":"よみあげる語句その1"},
  {"image":"002.jpg", "A":"よみあげる語句その2"},
  ...
]
- images/ フォルダに JPG を配置（image の値と一致）
- "A" が読み上げ対象。読み上げられた "A" に対応する画像（=同じ行の image）を選べば正解
*/

// --- 定数・状態 ---
const FILE_MAP = {
  "2nen": "list02.json"   // メニューは「２年」のみ
};

let questionsAll = [];        // [{image, A}]
let questionsInPlay = [];     // 今回プレイ分（5/10/15）
let remaining = [];           // 残り
let current = null;           // 現在の問題（{image, A}）
let voiceList = [];           // 利用可能な日本語音声
let selectedVoice = null;     // 選択中の音声
let startTime = 0;            // ミリ秒
let timerId = null;
let totalMs = 0;              // クリアタイム

// DOM取得
const el = (id)=>document.getElementById(id);
const menu = el('menu');
const game = el('game');
const result = el('result');
const historyView = el('history');
const grid = el('card-grid');

// --- 初期化 ---
document.addEventListener('DOMContentLoaded', () => {
  setupVoiceSelect();
  el('btn-start-from-menu').addEventListener('click', handleStartFromMenu);
  el('btn-show-history').addEventListener('click', showHistory);
  el('btn-start').addEventListener('click', startGameLogic);
  el('btn-repeat').addEventListener('click', repeatReading);
  el('btn-retry').addEventListener('click', retryGame);
  el('btn-quit').addEventListener('click', quitGame);
  el('btn-result-menu').addEventListener('click', () => switchScreen(result, menu));
  el('btn-history-back').addEventListener('click', () => switchScreen(historyView, menu));

  // 音声リスト更新（iOSなどで遅延取得する場合に対応）
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.onvoiceschanged = setupVoiceSelect;
  }
});

function switchScreen(hide, show){
  hide.style.display = 'none';
  show.style.display = 'flex';
}

/* ---- 音声選択（既存ロジック踏襲） ---- */
function setupVoiceSelect(){
  const select = el('voice-select');
  select.innerHTML = '';
  let allVoices = [];

  try {
    if (typeof speechSynthesis !== 'undefined') {
      allVoices = speechSynthesis.getVoices() || [];
    }
  } catch(e) {
    console.warn('音声取得エラー', e);
  }

  if (allVoices.length === 0 && typeof speechSynthesis !== 'undefined') {
    setTimeout(setupVoiceSelect, 300);
    return;
  }

  voiceList = allVoices.filter(v => v.lang && v.lang.toLowerCase().includes('ja-jp'));
  if (voiceList.length === 0) {
    voiceList = allVoices.filter(v => v.lang && v.lang.toLowerCase().includes('ja'));
  }

  let displayList = [];
  if (voiceList.length > 0) displayList = voiceList;
  else if (allVoices.length > 0) displayList = allVoices;
  else {
    const opt = document.createElement('option');
    opt.textContent = '音声未検出（利用不可）';
    opt.value = '';
    select.appendChild(opt);
    selectedVoice = null;
    return;
  }

  displayList.slice(0,4).forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    select.appendChild(opt);
  });

  selectedVoice = displayList[0] || null;
  select.value = selectedVoice ? selectedVoice.name : '';
  select.onchange = ()=>{
    const v = allVoices.find(x=>x.name===select.value);
    if (v) selectedVoice = v;
  };
}

function speak(text){
  if (!text) return;
  if (typeof speechSynthesis === 'undefined' || !selectedVoice){
    return;
  }
  try{
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = selectedVoice;
    u.lang = selectedVoice.lang || 'ja-JP';
    u.rate = 1.0;
    speechSynthesis.speak(u);
  }catch(e){
    console.warn('speech error', e);
  }
}

/* ---- メニューから開始 ---- */
async function handleStartFromMenu(){
  const setKey = el('grade-set').value; // 常に "2nen"
  const count = parseInt(el('mode').value,10);

  try{
    const filename = FILE_MAP[setKey] || 'list02.json';
    const res = await fetch(`data/${filename}`);
    if (!res.ok) throw new Error(`${filename} の読み込みに失敗しました`);
    const data = await res.json();

    // 期待形式: [{ image:"001.jpg", A:"..." }, ...]
    questionsAll = Array.isArray(data) ? data.filter(x=>x.image && x.A) : [];
    if (questionsAll.length === 0) throw new Error('問題が空です（image と A が必要）');

    // ランダムに count 件
    const shuffled = [...questionsAll].sort(()=>Math.random()-0.5);
    questionsInPlay = shuffled.slice(0, count);
    remaining = [...questionsInPlay];

    buildGrid(count);
    el('btn-start').disabled = false;
    el('btn-repeat').disabled = true;
    el('btn-retry').disabled = true;

    // 画面遷移
    menu.style.display = 'none';
    game.style.display = 'flex';
  }catch(err){
    console.error(err);
    await showModal(`問題データの読み込みに失敗しました\n${err.message}`);
  }
}

/* ---- グリッド構成（画像カード） ---- */
function buildGrid(count){
  grid.innerHTML = '';

  let rows = 1, cols = 5;
  if (count === 5){ rows = 1; cols = 5; }
  else if (count === 10){ rows = 2; cols = 5; }
  else if (count === 15){ rows = 3; cols = 5; }

  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${rows}, auto)`;

  questionsInPlay.forEach(q=>{
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.image = q.image;   // 正誤判定用
    card.innerHTML = `<img class="thumb" src="images/${q.image}" alt="">`;
    card.addEventListener('click', ()=>handleCardClick(card));
    grid.appendChild(card);
  });
}

/* ---- ゲーム進行 ---- */
function startGameLogic(){
  if (timerId) clearInterval(timerId);

  // iOS対策: ユーザー操作直後にダミー発話
  if (typeof speechSynthesis !== 'undefined' && selectedVoice){
    const dummy = new SpeechSynthesisUtterance(' ');
    dummy.voice = selectedVoice;
    dummy.lang = selectedVoice.lang || 'ja-JP';
    speechSynthesis.speak(dummy);
  }

  startTime = Date.now();
  updateTimer();
  timerId = setInterval(updateTimer, 1000);

  el('btn-start').disabled = true;
  el('btn-repeat').disabled = false;
  el('btn-retry').disabled = false;

  nextQuestion();
}

function updateTimer(){
  const ms = Date.now() - startTime;
  const m = Math.floor(ms/60000);
  const s = Math.floor((ms%60000)/1000).toString().padStart(2,'0');
  el('timer').textContent = `${m}:${s}`;
}

function nextQuestion(){
  if (remaining.length===0){
    finishGame();
    return;
  }
  const i = Math.floor(Math.random()*remaining.length);
  current = remaining[i];
  speak(current.A);  // "A" を読み上げ
}

function repeatReading(){
  if (current) speak(current.A);
}

function handleCardClick(card){
  if (!current || card.classList.contains('hidden')) return;
  const isCorrect = card.dataset.image === current.image;
  if (isCorrect){
    playSE('pinpon');
    card.classList.add('correct');
    setTimeout(()=>{
      card.classList.remove('correct');
      card.classList.add('hidden');
      // 残りから除外
      remaining = remaining.filter(q=>q.image !== current.image);

      setTimeout(()=>{ nextQuestion(); }, 600); // 効果音と重ならないように
    }, 350);
  }else{
    playSE('bu');
    card.classList.add('incorrect');
    setTimeout(()=>card.classList.remove('incorrect'), 350);
  }
}

function retryGame(){
  const count = parseInt(el('mode').value,10);
  const shuffled = [...questionsAll].sort(()=>Math.random()-0.5);
  questionsInPlay = shuffled.slice(0, count);
  remaining = [...questionsInPlay];

  buildGrid(count);

  if (timerId) clearInterval(timerId);
  startTime = Date.now();
  updateTimer();
  timerId = setInterval(updateTimer, 1000);

  el('btn-start').disabled = true;
  el('btn-repeat').disabled = false;

  nextQuestion();
}

async function quitGame(){
  const ok = await showModal('ゲームを中断してメニューにもどりますか？', true);
  if (ok){
    if (timerId) clearInterval(timerId);
    if (typeof speechSynthesis!== 'undefined') speechSynthesis.cancel();
    switchScreen(game, menu);
  }
}

function finishGame(){
  if (timerId) clearInterval(timerId);
  if (typeof speechSynthesis!== 'undefined') speechSynthesis.cancel();
  totalMs = Date.now() - startTime;

  const m = Math.floor(totalMs/60000);
  const s = Math.floor((totalMs%60000)/1000).toString().padStart(2,'0');
  el('final-time').textContent = `タイム: ${m}:${s}`;
  makeResultTable();
  switchScreen(game, result);
}

/* ---- 記録（既存ロジック流用） ---- */
const STORAGE_KEY = 'kanjiKarutaHistory';

function makeResultTable(){
  const rec = buildCurrentRecord();
  const history = loadHistory();
  const merged = [rec, ...history].slice(0,10);
  saveHistory(merged);

  const html = renderTable(merged);
  el('result-table-container').innerHTML = html;
}

function showHistory(){
  const history = loadHistory();
  el('history-table-container').innerHTML = renderTable(history);
  switchScreen(menu, historyView);
}

function buildCurrentRecord(){
  const setLabel = el('grade-set').options[el('grade-set').selectedIndex].text;
  const modeLabel = el('mode').options[el('mode').selectedIndex].text;
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return { date: dateStr, gradeSet: setLabel, mode: modeLabel, timeMs: totalMs };
}

function loadHistory(){
  try{
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  }catch{ return []; }
}

function saveHistory(arr){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

function renderTable(rows){
  if (!rows || rows.length===0){
    return '<p>まだ記録がありません。</p>';
  }
  const tr = rows.map((r,i)=>{
    const m = Math.floor(r.timeMs/60000);
    const s = Math.floor((r.timeMs%60000)/1000).toString().padStart(2,'0');
    return `<tr><td>${i+1}</td><td>${r.date}</td><td>${r.gradeSet}</td><td>${r.mode}</td><td>${m}:${s}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr><th>回</th><th>日付</th><th>学年とセット</th><th>モード</th><th>タイム</th></tr></thead><tbody>${tr}</tbody></table></div>`;
}

/* ---- 効果音 ---- */
function playSE(name){
  try{ new Audio(`sounds/${name}.mp3`).play(); }catch{}
}

/* ---- モーダル ---- */
function showModal(message, withCancel=false){
  const modal = el('modal');
  const ok = el('modal-ok');
  const cancel = el('modal-cancel');
  el('modal-message').textContent = message;
  cancel.style.display = withCancel ? 'inline-block' : 'none';
  modal.style.display = 'flex';
  return new Promise(resolve=>{
    const close = (val)=>{ modal.style.display='none'; ok.onclick=null; cancel.onclick=null; resolve(val); };
    ok.onclick = ()=>close(true);
    cancel.onclick = ()=>close(false);
  });
}
