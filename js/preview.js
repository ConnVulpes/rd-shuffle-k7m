/* プレビュー（開く・送る・閉じる・タップ）、画像だけを見る、動画、回転、省データ、ズーム、明るさ */
// ---- プレビュー ----
const peek = $('peek'), peekBody = $('peekBody');
let peekItem = null;

function updatePeekNav(it){
  const i = order.indexOf(it);
  $('peekPos').textContent = i < 0 ? '' : `${(i + 1).toLocaleString()} / ${poolSize.toLocaleString()}`;
  $('peekPrev').disabled = i <= 0;
  $('peekNext').disabled = i < 0 || i >= poolSize - 1;
}
// プレビューのまま前後のブックマークへ
function stepPeek(d){
  if(!peekItem) return;
  setBare(false);   // 送ったら、消していたボタンと文字を戻す
  const i = order.indexOf(peekItem) + d;
  if(i < 0 || i >= poolSize) return;
  // 後ろの一覧のカードは、プレビューを閉じたときにまとめて足す（送っている間は重くしない）
  openPeek(order[i], true);
}

// ---- 画像だけを見る：画像の真ん中を押すと、ボタンと文字を消す ----
// 戻すのは、もう一度真ん中を押す・前へ次へ・ズームを元に戻す・明るさのスワイプ・キー操作。
// ズームとパンの最中とそのあとは戻さない。画像の大きさと位置は変えない（見た目は app.css の #peek.bare）
let peekBare = false;
function setBare(v){
  if(peekBare === v) return;
  peekBare = v;
  peek.classList.toggle('bare', v);
}
// 押した点が、表示している画像の中心に置いた正方形（一辺は画面の幅の 1/5）の中か
function inPeekCenter(x, y){
  const m = zoomer.firstElementChild;
  if(!m || m.tagName === 'IFRAME') return false;
  const r = m.getBoundingClientRect();
  if(!r.width || !r.height) return false;
  const h = innerWidth / 10;
  return Math.abs(x - (r.left + r.width / 2)) <= h && Math.abs(y - (r.top + r.height / 2)) <= h;
}

// プレビュー中は後ろの一覧が動かないように固定する（iPhone でも効く方法）
let lockedY = 0;
function lockScroll(){
  lockedY = window.scrollY;
  const b = document.body.style;
  b.position = 'fixed'; b.top = `-${lockedY}px`; b.left = '0'; b.right = '0'; b.width = '100%';
}
function unlockScroll(){
  const b = document.body.style;
  b.position = ''; b.top = ''; b.left = ''; b.right = ''; b.width = '';
  window.scrollTo(0, lockedY);
}

// ---- プレビューでの動画（YouTube・X の動画/GIF）----
function ytId(url){
  let u; try{ u = new URL(url); }catch(e){ return ''; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if(host === 'youtu.be') return u.pathname.slice(1).split('/')[0];
  if(host === 'youtube.com') return u.searchParams.get('v') || (u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]+)/) || [])[1] || '';
  return '';
}
function xId(url){
  let u; try{ u = new URL(url); }catch(e){ return ''; }
  const host = u.hostname.replace(/^(www|mobile)\./, '');
  if(host !== 'x.com' && host !== 'twitter.com') return '';
  return (u.pathname.match(/status(?:es)?\/(\d+)/) || [])[1] || '';
}
async function xVideo(id){
  const t = (await fxTweet(id)).tweet || {};
  const vids = (t.media && t.media.videos) || (t.quote && t.quote.media && t.quote.media.videos) || [];
  const x = vids[0];
  if(!x || !x.url) return null;
  // どのブラウザでも再生できる H.264 の mp4 を選ぶ（m3u8 や HEVC は避ける）
  const mp4 = (x.formats || x.variants || []).filter(f => f.url && (f.container === 'mp4' || /\.mp4/.test(f.url)) && (!f.codec || /264|avc/i.test(f.codec)))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return { url:(mp4[0] && mp4[0].url) || x.url, gif:x.type === 'gif', poster:x.thumbnail_url || '' };
}
// ---- 回転（90度ずつ）と左右反転 ----
const orient = { rot:0, flip:false };
function applyOrient(anim){
  zoomer.classList.toggle('turning', !!anim);
  zoomer.style.setProperty('--rot', orient.rot + 'deg');
  zoomer.style.setProperty('--flip', orient.flip ? '-1' : '1');
  const side = Math.abs(orient.rot / 90) % 2 === 1;
  zoomer.classList.toggle('sideways', side);
  // 横倒しのときは、縦横を入れ替えた枠に収まるようにする
  if(side){ zoomer.style.setProperty('--zw', zoomer.clientWidth + 'px'); zoomer.style.setProperty('--zh', zoomer.clientHeight + 'px'); }
  $('peekFlip').setAttribute('aria-pressed', String(orient.flip));
}
function resetOrient(){ orient.rot = 0; orient.flip = false; applyOrient(false); }
// 反転中は見た目の回る向きが逆になるので、押した向きに回るように合わせる
function rotatePeek(dir){
  orient.rot += 90 * dir * (orient.flip ? -1 : 1);
  applyOrient(true);
  const deg = ((orient.rot % 360) + 360) % 360;
  zoomInd.textContent = deg ? `${deg}°` : '0°';
  zoomInd.classList.add('show'); clearTimeout(zoomIndTimer);
  zoomIndTimer = setTimeout(() => zoomInd.classList.remove('show'), 900);
}
function flipPeek(){
  orient.flip = !orient.flip;
  applyOrient(true);
  zoomInd.textContent = orient.flip ? '左右反転' : '反転なし';
  zoomInd.classList.add('show'); clearTimeout(zoomIndTimer);
  zoomIndTimer = setTimeout(() => zoomInd.classList.remove('show'), 900);
}
$('peekRot').addEventListener('click', e => rotatePeek(e.shiftKey ? -1 : 1));
$('peekFlip').addEventListener('click', flipPeek);
addEventListener('resize', () => { if(peek.open && zoomer.classList.contains('sideways')) applyOrient(false); });

// ---- 軽量モード：高画質・動画は押したときだけ ----
let peekVideoFor = null;
// 小さい画像を、元の大きさの画像に差し替える（読み込めてから差し替えるので、それまでは小さい方のまま）
function upgradePeek(it){
  const img = zoomer.querySelector('img.thumb[data-full]');
  if(!img) return syncHq();
  const full = img.dataset.full;
  peek.classList.add('hq-loading');
  const pre = new Image();
  pre.referrerPolicy = 'no-referrer';
  pre.onload = () => { if(peekItem === it){ img.src = full; delete img.dataset.full; } done(); };
  pre.onerror = () => { if(peekItem === it) delete img.dataset.full; done(); };
  const done = () => { if(peekItem === it){ peek.classList.remove('hq-loading'); syncHq(); } };
  pre.src = full;
}
// 「高画質で見る」「動画を再生」ボタンの出し分け
function syncHq(){
  const b = $('peekHq');
  const it = peekItem;
  const video = state.saver && it && peekVideoFor === it && !it._hq;
  const low = state.saver && it && !it._hq && !!zoomer.querySelector('img.thumb[data-full]');
  b.hidden = !(video || low);
  b.textContent = video ? '動画を再生' : '高画質で見る';
}
$('peekHq').addEventListener('click', e => {
  viewBonus('hq');
  e.stopPropagation();
  const it = peekItem;
  if(!it) return;
  it._hq = true;   // 一度押したブックマークは、ページを開いている間は高画質で出す
  // X の投稿は、動画かもしれないので最初から通常どおりに出し直す（画像なら高画質に差し替わる）
  if(peekVideoFor === it || xId(it.l)){ peekVideoFor = null; showPeekMedia(it); return; }
  upgradePeek(it);
});

function showPeekMedia(it){
  resetZoom(false);
  zoomer.innerHTML = '';
  const yt = ytId(it.l);
  if(yt){
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?autoplay=1&rel=0`;
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    zoomer.append(f);
    return;
  }
  // まず小さい方（普段は一覧で読み込み済みの画像）をすぐ出し、元の大きさは後から差し替える。
  // 軽量モードでは差し替えず、「高画質で見る」を押したときだけ読み込む
  const first = mediaEl(it, thumbs(it), 0, () => {
    if(peekItem !== it) return;
    if(!state.saver || it._hq) upgradePeek(it); else syncHq();
  }, true, 'low');
  zoomer.append(first);
  syncHq();
  prefetchAround(it);
  const xid = xId(it.l);
  if(xid){
    // 軽量モードでは、動画は「動画を再生」を押したときだけ読み込む（サムネの形から動画の投稿か見分ける）
    if(state.saver && !it._hq){
      if(/(tweet_video|amplify_video|ext_tw_video)_thumb/.test(it.c || '') || it.y === 'video'){ peekVideoFor = it; syncHq(); }
      return;
    }
    xVideo(xid).then(v => {
      if(!v || peekItem !== it) return;
      const vid = document.createElement('video');
      vid.className = 'thumb';
      vid.src = v.url;
      if(v.poster) vid.poster = v.poster;
      vid.muted = true; vid.loop = true; vid.autoplay = true; vid.playsInline = true;
      if(!v.gif) vid.controls = true;   // GIF は音なしでループ、動画は操作できるように
      const keep = [...zoomer.childNodes];
      // 読み込めなかったら画像に戻して、その旨を出す
      vid.addEventListener('error', () => {
        if(peekItem !== it) return;
        zoomer.innerHTML = ''; zoomer.append(...keep);
        showToast('動画を読み込めませんでした（「サイト」から X で見られます）', null);
      }, { once:true });
      zoomer.innerHTML = '';
      zoomer.append(vid);
      vid.play().catch(() => {});
    });
  }
}

// 表示用のタイトル・サイト名・保存した日（今年なら「10月27日」、ほかの年なら「2025年3月4日」）
const itemTitle = it => (it.t || '').trim() || it.l.replace(/^https?:\/\//, '');
const siteName = it => (it.d || '').replace(/^www\./, '');
function saveDate(a){
  if(!a) return '';
  const [y, m, d] = a.split('-').map(Number);
  return y === new Date().getFullYear() ? `${m}月${d}日` : `${y}年${m}月${d}日`;
}
// 作者の表示名：おすすめと同じく URL から取れるときだけ（大文字・小文字は URL のまま）。X などは「@アカウント」
function authorName(url){
  const k = authorKey(url);
  if(!k) return '';
  const u = new URL(url), seg = u.pathname.split('/').filter(Boolean), kind = k.split(':')[0];
  if(kind === 'x' || kind === 'ig') return '@' + seg[0];
  if(kind === 'yt') return seg[0];
  if(kind === 'bsky') return '@' + seg[1];
  if(kind === 'da') return seg[0];
  if(kind === 'tb') return u.hostname.replace(/^(www|mobile|m)\./, '').split('.')[0];
  return '';
}

function openPeek(it, stepping){
  viewStart(it);
  peekItem = it;
  updatePeekNav(it);
  $('peekOpen').href = it.l;
  // 下に2行：タイトル1行（なければアドレス）と「サイト · 保存した日」
  $('peekCapT').textContent = itemTitle(it);
  $('peekCapD').textContent = [siteName(it), saveDate(it.a)].filter(Boolean).join(' · ');
  $('peekRd').href = raindropUrl(it);
  paintLike();
  showPeekMedia(it);
  resetOrient();
  edView = '';
  if(!peek.open){ lockScroll(); peek.showModal(); peekCleaned = false; pushLayer('peek'); }
  applyEditOpen(stepping);
}

// 閉じたあとの片付けは、close の知らせ（少し遅れて届く）を待たずにその場で行う
function closePeek(){
  if(peek.open){ peek.close(); onPeekClosed(); }
}

let peekCleaned = true, peekSilent = false;
peek.addEventListener('close', onPeekClosed);
function onPeekClosed(){
  if(peekCleaned) return;
  peekCleaned = true;
  popLayer('peek');
  viewEnd();
  const last = peekItem;
  hideCrop();
  peekItem = null; peekVideoFor = null; zoomer.innerHTML = ''; resetZoom(false); edToast.hidden = true; peek.classList.remove('editing', 'hq-loading');
  setBare(false);   // 次に開くときは、ボタンと文字が出ている状態から
  unlockScroll();
  // 一覧にまだ出ていないところまで送っていたら、そこまでカードを足してから合わせる
  const at = last ? order.indexOf(last) : -1;
  while(at >= shownCount && shownCount < poolSize) appendMore();
  if(peekSilent) peekSilent = false; else revealCard(last);
}
// プレビューを閉じたら、最後に見ていたカードが画面に入るところまでスクロールして、軽く光らせる
// （前後に送っているうちに追加で読み込んだカードは、並び終わるのを少し待つ）
function revealCard(it, tries = 0){
  const c = it && cardOf.get(it);
  if(!c) return;
  if(!c._placed || !c.isConnected){ if(tries < 30) setTimeout(() => revealCard(it, tries + 1), 100); return; }
  const top = document.querySelector('header').offsetHeight;
  const r = c.getBoundingClientRect();
  if(r.top < top || r.bottom > innerHeight){
    const room = innerHeight - top;
    const y = scrollY + r.top - top - Math.max(12, (room - r.height) / 2);
    window.scrollTo({ top:Math.max(0, y), behavior:'instant' });
  }
  c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
}
const touchUI = matchMedia('(hover:none)').matches;
peek.addEventListener('click', e => {
  // ボタン類や編集パネルを押したときは何もしない。
  // 押した直後に作り直されて画面から外れた部品（フォルダの選択欄など）は closest で親をたどれないので、
  // 押した時点の経路（composedPath）で判断する
  if(!e.target.isConnected) return;
  if(e.composedPath().some(n => n.matches && n.matches('.lb-top, .lb-nav, .lb-edit, .lb-toast, .lb-bright, .lb-hq, .lb-like, .lb-sim, .lb-info, .crop'))) return;
  if(zoomDragged){ zoomDragged = false; return; }   // ドラッグで動かした直後のクリックは無視
  // ズーム中はクリック（タップ）で元の大きさに戻す
  if(zoom.s !== 1){ resetZoom(true); setBare(false); return; }
  if(e.target.closest('video[controls]')) return;
  // 画像の真ん中の正方形を押すと、ボタンと文字を消す・戻す（情報の画面を開いている間は今までどおり）
  if(!peek.classList.contains('editing') && inPeekCenter(e.clientX, e.clientY)){ setBare(!peekBare); return; }
  // スマホ：画面の左半分をタップで前へ、右半分で次へ（閉じるのは×ボタン）
  if(touchUI){ stepPeek(e.clientX < window.innerWidth / 2 ? -1 : 1); return; }
  // PC：消している間は、どこを押しても戻すだけ（見えない矢印の場所を押して閉じてしまわないように）
  if(peekBare){ setBare(false); return; }
  // 画像やボタン以外（後ろが透けているところ）を押すと閉じる
  if(e.target === peek || e.target === peekBody || e.target === zoomer) closePeek();
});
$('peekClose').addEventListener('click', closePeek);
document.querySelector('#peekRd .lb-rd-ic').innerHTML = RD_ICON;

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
