/* 設定の画面（openSettings syncModal）、トークンの窓、メニュー、表示の切り替え
   （キャプション・省データ・カーソルを隠す・カードの大きさ・一度に読み込む数） */
// 設定の画面（メニューの「設定…」）
const setDlg = $('setDlg');
function openSettings(){ setMenu(false); updateMapState(); bkPaint(); setDlg.style.transform = ''; setDlg.showModal(); syncModal(); }
// 設定・絞り込み・トークンの窓を開いている間は、後ろの一覧がスクロールしないようにする
// （本体を固定する方法はプレビューだけ。窓では、iPhone で中の操作が効かなくなることがあるので使わない）
function syncModal(){ document.documentElement.classList.toggle('modal-open', setDlg.open || filterDlg.open || dlg.open || cropOpen); }
[setDlg, filterDlg, dlg].forEach(d => d.addEventListener('close', syncModal));
// スマホ：上のつまみ（と見出し）を下に引くと閉じる。編集の画面いっぱいのときと同じ
function startSetDrag(e){
  if(!matchMedia('(max-width:640px)').matches || e.target.closest('button')) return;
  e.preventDefault();
  const y0 = e.clientY, t0 = performance.now();
  let dy = 0;
  setDlg.classList.add('drag');
  const move = ev => { dy = Math.max(0, ev.clientY - y0); setDlg.style.transform = dy ? `translateY(${dy}px)` : ''; };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    setDlg.classList.remove('drag');
    const fast = dy > 40 && dy / Math.max(1, performance.now() - t0) > 0.6;
    if(dy > innerHeight * 0.25 || fast){
      setDlg.style.transform = 'translateY(100%)';
      setTimeout(() => { setDlg.close(); setDlg.style.transform = ''; }, reduceMotion() ? 0 : 200);
    }else setDlg.style.transform = '';
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
$('setGrip').addEventListener('pointerdown', startSetDrag);
document.querySelector('#setDlg .set-head').addEventListener('pointerdown', startSetDrag);
$('setDone').addEventListener('click', () => setDlg.close());
$('setX').addEventListener('click', () => setDlg.close());
setDlg.addEventListener('click', e => { if(e.target === setDlg) setDlg.close(); });
$('tokenBtn').addEventListener('click', () => { setDlg.close(); openToken(); });
// トークンの窓
function openToken(){
  tokenInput.value = state.token;
  if(typeof dlg.showModal === 'function'){ dlg.showModal(); syncModal(); }
  tokenInput.focus();
}

const capBtn = $('capToggle');
// PC の上のバーのアイコン（キャプション・省データモード・カーソルを自動で隠す）
function paintStIcons(){
  $('stCap').setAttribute('aria-pressed', String(!!state.cap));
  $('stSaver').setAttribute('aria-pressed', String(!!state.saver));
  $('stCur').setAttribute('aria-pressed', String(!!state.hideCur));
}
function applyCap(){
  document.body.classList.toggle('no-cap', !state.cap);
  capBtn.checked = state.cap;
  paintStIcons();
}
function toggleCap(){
  state.cap = !state.cap;
  store.set('cap', state.cap);
  applyCap();
}
capBtn.addEventListener('change', toggleCap);
// 軽量モード：切り替えたら一覧の画像も取り直す
const saverBtn = $('saverToggle');
saverBtn.checked = state.saver;
function setSaver(v){
  state.saver = v; saverBtn.checked = v;
  store.set('saver', state.saver);
  paintStIcons();
  allCards().forEach(c => refreshCardMedia(c, c._item));
}
saverBtn.addEventListener('change', () => setSaver(saverBtn.checked));

// マウスを止めて少したつとカーソルを隠す。隠れている間はカードに反応しない
const curBtn = $('curToggle');
const canHover = matchMedia('(hover:hover)').matches;
const IDLE_MS = 1500;
const STROKE_GAP = 250;  // これ以上間があいたら別の動きとして数え直す
let idleTimer = 0, lastX = null, lastY = null, travel = 0, lastMoveAt = 0;
function setIdle(on){ document.body.classList.toggle('cur-idle', on); }
function armIdle(){
  clearTimeout(idleTimer);
  if(!state.hideCur || !canHover) return;
  idleTimer = setTimeout(() => {
    if(dlg.open || peek.open || filterDlg.open || setDlg.open || cropOpen) return armIdle();
    setIdle(true);
  }, IDLE_MS);
}
function wake(){ setIdle(false); armIdle(); }
document.addEventListener('mousemove', e => {
  const d = lastX === null ? 0 : Math.hypot(e.screenX - lastX, e.screenY - lastY);
  lastX = e.screenX; lastY = e.screenY;
  // スクロールだけで発生する見かけの移動は無視する
  if(d < 1) return;
  const now = performance.now();
  if(document.body.classList.contains('cur-idle')){
    // 隠れている間は、ちょっと触れた程度では戻さない
    if(now - lastMoveAt > STROKE_GAP) travel = 0;
    lastMoveAt = now;
    travel += d;
    if(travel < state.wakePx) return;
  }
  travel = 0;
  wake();
}, {passive:true});
document.documentElement.addEventListener('mouseleave', () => clearTimeout(idleTimer));
const wakeInput = $('wake'), wakeVal = $('wakeVal');
function applyWake(){
  const v = Number(state.wakePx);
  state.wakePx = Number.isFinite(v) ? Math.min(1200, Math.max(30, v)) : 360;
  wakeInput.value = String(state.wakePx);
  wakeVal.textContent = state.wakePx + 'px';
}
wakeInput.addEventListener('input', () => {
  state.wakePx = Number(wakeInput.value);
  store.set('wakepx', state.wakePx);
  applyWake();
});
function applyCur(){
  curBtn.checked = state.hideCur;
  paintStIcons();
  $('curGroup').classList.toggle('off', !state.hideCur);
  if(state.hideCur) armIdle(); else { clearTimeout(idleTimer); setIdle(false); }
}
function toggleCur(){
  state.hideCur = !state.hideCur;
  store.set('hidecur', state.hideCur);
  applyCur();
}
curBtn.addEventListener('change', toggleCur);
$('stCap').addEventListener('click', toggleCap);
$('stSaver').addEventListener('click', () => setSaver(!state.saver));
$('stCur').addEventListener('click', toggleCur);

const sizeInput = $('size');
function applySize(){
  const v = Number(state.col);
  state.col = Number.isFinite(v) ? Math.min(380, Math.max(90, v)) : 250;
  sizeInput.value = String(state.col);
  layout(false);
}
let recapTimer = 0;
function setSize(px){
  state.col = px;
  store.set('col', state.col);
  applySize();
  clearTimeout(recapTimer);
  recapTimer = setTimeout(() => allCards().forEach(c => { const old = c.querySelector('.cap'); if(old && c._item) old.replaceWith(captionEl(c._item)); }), 200);
}
sizeInput.addEventListener('input', () => setSize(Number(sizeInput.value)));
// 一度に読み込む数：20・40・80
const countSeg = $('countSeg');
function applyCount(){ countSeg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === state.count))); }
countSeg.addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b) return;
  state.count = Number(b.dataset.n); store.set('count', state.count); applyCount();
});
// メニュー（カードの大きさ・サムネイルが出ないもの・Raindrop から更新・設定…）
const viewBtn = $('viewBtn'), viewMenu = $('viewMenu');
function setMenu(open){ viewMenu.hidden = !open; viewBtn.setAttribute('aria-expanded', String(open)); if(open && typeof setSortMenu === 'function') setSortMenu(false); }
viewBtn.addEventListener('click', e => { e.stopPropagation(); setMenu(viewMenu.hidden); });
// メニューの外を押したときは閉じるだけにする（後ろのカードが開かないように）
document.addEventListener('click', e => {
  if(!viewMenu.hidden && !e.target.closest('#viewMenu, #viewBtn')){ e.preventDefault(); e.stopPropagation(); setMenu(false); }
  if(!sortMenu.hidden && !e.target.closest('#sortMenu, #sortBtn')){ e.preventDefault(); e.stopPropagation(); setSortMenu(false); }
}, true);
refreshBtn.addEventListener('click', () => { setDlg.close(); refreshAll(true); });
$('updDiff').addEventListener('click', () => { setMenu(false); syncChanged(); });
$('settings').addEventListener('click', openSettings);
$('cancel').addEventListener('click', () => dlg.close());
$('tokenForm').addEventListener('submit', () => {
  const next = tokenInput.value.trim();
  if(next !== state.token){
    state.token = next;
    store.set('token', state.token);
    cache = null;
    store.del('cache');
    syncFilter();
    order = []; poolSize = 0; shownCount = 0; cardEls = []; placeGen++; placing = 0; layout(true);
    if(state.token){ refreshAll(); syncRef = null; store.del('syncref'); syncAt = 0; store.del('syncat'); pullSettings(); }
  }
});
