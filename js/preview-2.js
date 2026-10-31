/* ズームと明るさ（プレビュー）。後半は、画像がないときの代わり・読み込みの失敗・設定の画面・トークンの窓・
   キャプションと省データの切り替え・カーソルを隠す・続きの読み込み・カードの大きさ・並び順とメニュー。
   ② で置き場所を決め直す */
// ---- ズーム：ホイールで拡大縮小（最初の大きさより小さくもできる）、ドラッグで移動、クリックで元に戻す ----
const zoomer = $('zoomer'), zoomInd = $('zoomInd');
const zoom = { s:1, x:0, y:0 };
let zoomDragged = false, zoomIndTimer = 0;
function applyZoom(anim){
  zoomer.classList.toggle('anim', !!anim);
  zoomer.style.transform = (zoom.s === 1 && !zoom.x && !zoom.y) ? '' : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
  peek.classList.toggle('zoomed', zoom.s !== 1);
}
function showZoomInd(){
  zoomInd.textContent = Math.round(zoom.s * 100) + '%';
  zoomInd.classList.add('show');
  clearTimeout(zoomIndTimer);
  zoomIndTimer = setTimeout(() => zoomInd.classList.remove('show'), 900);
}
function resetZoom(anim){ zoom.s = 1; zoom.x = 0; zoom.y = 0; applyZoom(anim); }
// (cx, cy) を中心に倍率を factor 倍する
function zoomAt(factor, cx, cy){
  if(factor > 1) viewBonus('zoom');
  const was = zoom.s;
  const r = peekBody.getBoundingClientRect();
  const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
  const s2 = Math.min(10, Math.max(0.2, zoom.s * factor));
  const k = s2 / zoom.s;
  zoom.x = px - (px - zoom.x) * k;
  zoom.y = py - (py - zoom.y) * k;
  zoom.s = Math.abs(s2 - 1) < 0.02 ? 1 : s2;
  if(zoom.s === 1){ zoom.x = 0; zoom.y = 0; }
  applyZoom(false);
  showZoomInd();
  if(was !== 1 && zoom.s === 1) setBare(false);   // ズームを元の大きさに戻したら、消していたボタンと文字を戻す
}
peekBody.addEventListener('wheel', e => {
  if(e.target.closest('iframe')) return;
  e.preventDefault();
  zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
}, { passive:false });
// マウスのドラッグで移動
let dragStart = null;
peekBody.addEventListener('pointerdown', e => {
  zoomDragged = false;   // 新しい操作の始まり：前のドラッグの印が残って次のタップを無視しないように
  if(e.pointerType !== 'mouse' || e.button !== 0 || zoom.s === 1 || e.target.closest('video[controls]')) return;
  dragStart = { x:e.clientX, y:e.clientY, zx:zoom.x, zy:zoom.y, moved:false };
  zoomer.classList.add('drag');
  e.preventDefault();
});
addEventListener('pointermove', e => {
  if(!dragStart) return;
  const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
  if(Math.abs(dx) + Math.abs(dy) > 4) dragStart.moved = true;
  zoom.x = dragStart.zx + dx; zoom.y = dragStart.zy + dy;
  applyZoom(false);
});
addEventListener('pointerup', () => {
  if(!dragStart) return;
  zoomDragged = dragStart.moved;
  dragStart = null;
  zoomer.classList.remove('drag');
});
// スマホの指の操作：2本指で拡大縮小／拡大中は1本指で移動／等倍のときは左右スワイプで前後へ
let touch = null;
const center = (a, b) => ({ d:Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mx:(a.clientX + b.clientX) / 2, my:(a.clientY + b.clientY) / 2 });
peekBody.addEventListener('touchstart', e => {
  const t = e.touches;
  if(t.length === 1 && !touch) zoomDragged = false;
  if(t.length === 2) touch = { mode:'pinch', ...center(t[0], t[1]) };
  else if(t.length === 1) touch = zoom.s !== 1
    ? { mode:'pan', x:t[0].clientX, y:t[0].clientY, moved:false }
    : { mode:'swipe', x:t[0].clientX, y:t[0].clientY, dir:'', b0:bright,
        // 画面のいちばん下（iPhone のアプリ切り替えのバーのあたり）から始まった指は、明るさにも前後にも使わない
        edge: t[0].clientY > innerHeight - EDGE_B };
}, { passive:true });
peekBody.addEventListener('touchmove', e => {
  if(!touch) return;
  if(touch.mode === 'swipe'){
    // 等倍のとき：最初に動いた向きで決める。縦なら明るさ（上で明るく、下で暗く）、横なら離したときに前後へ
    if(e.touches.length !== 1 || touch.edge) return;
    const t = e.touches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if(!touch.dir && Math.abs(dx) + Math.abs(dy) > 12) touch.dir = Math.abs(dy) > Math.abs(dx) * 1.2 ? 'v' : 'h';
    if(touch.dir === 'v'){ e.preventDefault(); setBare(false); setBright(touch.b0 - dy * 1.5 / (peekBody.clientHeight || innerHeight)); }
    return;
  }
  e.preventDefault();
  if(touch.mode === 'pinch' && e.touches.length === 2){
    const c = center(e.touches[0], e.touches[1]);
    zoom.x += c.mx - touch.mx; zoom.y += c.my - touch.my;
    zoomAt(c.d / touch.d, c.mx, c.my);
    Object.assign(touch, c);
  }else if(touch.mode === 'pan' && e.touches.length === 1){
    const t = e.touches[0];
    const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if(Math.abs(dx) + Math.abs(dy) > 4) touch.moved = true;
    zoom.x += dx; zoom.y += dy; touch.x = t.clientX; touch.y = t.clientY;
    applyZoom(false);
  }
}, { passive:false });
peekBody.addEventListener('touchend', e => {
  if(!touch) return;
  if(touch.mode === 'pan' && touch.moved) zoomDragged = true;
  if(touch.mode === 'swipe' && touch.edge){ /* 端から始まった指は何もしない */ }
  else if(touch.mode === 'swipe' && touch.dir === 'v'){ zoomDragged = true; saveBright(); lastVDrag = { b0:touch.b0, at:Date.now() }; }
  else if(touch.mode === 'swipe' && !e.touches.length && zoom.s === 1){
    const t = e.changedTouches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepPeek(dx < 0 ? 1 : -1);
  }
  // 2本指のあと1本だけ残ったら、拡大中ならそのまま移動に切り替える
  touch = (e.touches.length === 1 && zoom.s !== 1) ? { mode:'pan', x:e.touches[0].clientX, y:e.touches[0].clientY, moved:true } : null;
}, { passive:true });
// 途中で指の操作が打ち切られたとき（通知が来た等）も、次のタップを取りこぼさないように片付ける
// 明るさを変えている途中で打ち切られたときは、アプリの切り替えなどに指を取られたので、変える前に戻す
peekBody.addEventListener('touchcancel', () => {
  if(touch && touch.mode === 'swipe' && touch.dir === 'v'){ setBright(touch.b0, true); saveBright(); }
  touch = null;
}, { passive:true });
// 明るさを変えた直後にアプリから離れたら（下から持ち上げてアプリを切り替えた等）、それも元に戻す
const EDGE_B = 40;
let lastVDrag = null;
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState !== 'hidden') return;
  const d = touch && touch.mode === 'swipe' && touch.dir === 'v' ? { b0:touch.b0, at:Date.now() } : lastVDrag;
  if(d && Date.now() - d.at < 1000){ setBright(d.b0, true); saveBright(); }
  lastVDrag = null; touch = null;
});
$('peekPrev').addEventListener('click', () => stepPeek(-1));

// ---- 明るさ：上下スワイプ（PCは↑↓キー）で、プレビューだけを暗く・明るくする（端末の画面の明るさは変えられないので） ----
const peekDim = $('peekDim');
let bright = Number(store.get('bright', 1)) || 1;
function applyBright(){
  peekDim.classList.toggle('on', bright < 1);                          // 背景：100%未満のときだけ黒い膜（中身の後ろ）
  peekDim.style.opacity = bright < 1 ? String(1 - bright) : '';
  zoomer.style.filter = bright !== 1 ? `brightness(${bright})` : '';   // 画像・動画：そのものを暗く／明るく
  // 100%以外のときだけ、上のバーに今の明るさ（押すと100%に戻る）を出す
  $('peekBright').hidden = bright === 1;
  $('peekBrightV').textContent = Math.round(bright * 100) + '%';
}
$('peekBright').addEventListener('click', () => { setBright(1); saveBright(); });
function setBright(v, quiet){
  v = Math.min(1.4, Math.max(0.1, v));
  bright = Math.abs(v - 1) < 0.03 ? 1 : Math.round(v * 100) / 100;
  applyBright();
  if(quiet) return;
  zoomInd.textContent = `明るさ ${Math.round(bright * 100)}%`;
  zoomInd.classList.add('show'); clearTimeout(zoomIndTimer);
  zoomIndTimer = setTimeout(() => zoomInd.classList.remove('show'), 900);
}
function saveBright(){ store.set('bright', bright); }
applyBright();
$('peekNext').addEventListener('click', () => stepPeek(1));

// 画像がないときの代わり：タイトルを文字で見せる（タイトルもなければサイトの頭文字）
function placeholder(it){
  const title = (it.t || '').trim();
  const site = (it.d || '').replace(/^www\./, '');
  if(!title) return el('div', 'ph', ((site || '?')[0] || '?').toUpperCase());
  const div = el('div', 'ph ph-text');
  div.append(el('div', 'ph-title', title), el('div', 'ph-site', site));
  return div;
}

function handleError(e){
  const m = {
    auth:'トークンが無効です。設定から入れ直してください。',
    network:'Raindrop に接続できませんでした。ネット接続を確認してください。',
    rate:'読み込みの上限に達しました。1分ほど待ってから「更新」を押してください。'
  }[e.message] || '読み込みに失敗しました。「更新」をもう一度押してください。';
  statusEl.textContent = m;
  if(e.message === 'auth') openToken();
}

function setShuffleBusy(b){
  shuffleBtn.disabled = b; sortBtn.disabled = b;
}

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

const moreEl = $('more');
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

new IntersectionObserver(entries => {
  if(entries.some(e => e.isIntersecting) && shownCount < poolSize && !placing) appendMore();
}, { rootMargin:'1200px 0px' }).observe(moreEl);
// 画面がまだ埋まっていなければ、続きを足し続ける
setInterval(() => {
  if(shownCount < poolSize && !placing && document.documentElement.scrollHeight - innerHeight - scrollY < 1200) appendMore();
}, 800);

let resizeTimer = 0;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => layout(false), 150); });

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
shuffleBtn.addEventListener('click', shuffle);
const sortMenu = $('sortMenu');
function setSortMenu(open){ sortMenu.hidden = !open; sortBtn.setAttribute('aria-expanded', String(open)); if(open) setMenu(false); }
sortBtn.addEventListener('click', e => { e.stopPropagation(); setSortMenu(sortMenu.hidden); });
sortMenu.addEventListener('click', e => { const b = e.target.closest('[data-sort]'); if(!b) return; setSortMenu(false); setSort(b.dataset.sort); });
applySortUI();

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
