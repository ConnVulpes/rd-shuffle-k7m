/* 一覧：一段奥の画面（views enterView restoreView 道すじ）、戻る（pushLayer popLayer popstate）、
   石積みの並べ方（layout placeCard）、サムネの候補と読み込み（thumbs mediaEl）、カード（card captionEl）、
   アイコン（ICONS icon） */
// ---- 一段奥の画面（似た画像・サムネイルが出ないもの）----
// 入るときに今の一覧（並び・カード・スクロール位置）をそのまま取っておき、戻ったら元に戻す。
// 似た画像の中でさらに似た画像を開くと、もう一段奥へ。戻るは一段ずつ
var views = [], fwd = [];   // fwd：戻ったあとの先の段（道すじに薄く残し、押すとまた進める）
function applyView(){
  const v = views[views.length - 1];
  if(!v) simF = null;   // 元の一覧に戻ったら、似た画像の条件は外れる
  sim = v && v.kind === 'sim' ? v.sim : null;
  ntMode = !!v && v.kind === 'nt';
  $('pressMenu').hidden = true;   // 長押しの選択肢は、段が変わったら閉じる
  renderDeepBar();
}
function slideGrid(cls){
  grid.classList.remove('view-in', 'view-back'); void grid.offsetWidth; grid.classList.add(cls);
  setTimeout(() => grid.classList.remove(cls), 250);
}
function pathThumbOf(it){
  const c = cardOf.get(it), im = c && c.querySelector('img');
  if(im && im.currentSrc) return im.currentSrc;
  const t = thumbs(it)[0];
  return t && !t.video ? tinyUrl(t.url) : '';
}
// 今の一覧（並び・カード・スクロール位置）を取っておく
function takeSnap(){
  // カードを外す前に覚える（外すとページが短くなって 0 になる）。プレビュー中は本体を固定しているので、固定前の位置
  const y = peek.open ? lockedY : window.scrollY;
  const frag = document.createDocumentFragment();
  while(grid.firstChild) frag.append(grid.firstChild);
  placeGen++; placeQueue = Promise.resolve(); placing = 0;
  return { order, shownCount, poolSize, cardEls, cols, colCount, frag, y, fk:simKey() };
}
// 似た画像の条件（元の一覧に戻るまで、段をまたいで続く。保存はしない）
var simF = null;
const simKey = () => simF ? normF(simF) : '';
function enterView(v){
  if(v.kind === 'sim') v.thumb = v.sim.crop || pathThumbOf(v.sim.center);   // 範囲で探したときは切り抜いた部分
  setMenu(false); setSortMenu(false); clearSelection();
  fwd = [];   // 新しくたどり始めたら、先の段は消える（ブラウザの「進む」と同じ）
  v.snap = takeSnap();
  views.push(v);
  pushLayer('deep', peek.open);   // プレビューの下に積む（戻るとプレビュー → 一段奥の順に閉じる）
  applyView();
  colCount = 0;
  render();
  if(peek.open) lockedY = 0;   // プレビューを閉じたら、似た画像の一覧の上から
  slideGrid('view-in');
}
// 先の段へまた進む（n 段）。途中の段は並べずに、最後の段だけ並べる（途中へ戻るときに並べ直す）
function goForward(n, fromPop){
  const list = fwd.splice(0, n); if(!list.length) return;
  setMenu(false); setSortMenu(false); clearSelection();
  list.forEach((v, i) => {
    v.snap = i ? { lazy:true } : takeSnap();
    views.push(v);
    if(fromPop) layers.push('deep'); else pushLayer('deep');
  });
  applyView();
  colCount = 0;
  render();
  slideGrid('view-in');
}
// 一段戻る（履歴の出し入れは呼ぶ側で）
function restoreView(quiet){
  const v = views.pop(); if(!v) return;
  if(v.kind === 'nt') ntStop = true;
  clearSelection();
  const sn = v.snap; delete v.snap;
  fwd.unshift(v);
  // 戻る先が似た画像で、取っておいたときと条件が変わっていたら、今の条件で並べ直す
  const to = views[views.length - 1];
  if(sn.lazy || (to && to.kind === 'sim' && sn.fk !== simKey())){
    // まだ並べていない段へ戻るとき：その場で並べる
    applyView();
    if(quiet) return;
    colCount = 0; render(); slideGrid('view-back');
    if(v.from) revealCard(v.from);
    return;
  }
  placeGen++;
  grid.innerHTML = ''; grid.append(sn.frag);
  ({ order, shownCount, poolSize, cardEls, cols, colCount } = sn);
  allCards().forEach(c => { if(c._item) cardOf.set(c._item, c); });
  // 入る前にまだ並べ終わっていなかったカードを、続きから並べる
  const pending = cardEls.filter(c => !c._placed), gen = placeGen;
  placing = pending.length;
  placeQueue = (async () => { for(const c of pending){ await Promise.race([c._ready, sleep(3000)]); if(gen !== placeGen) return; c._placed = true; placeCard(c); placing--; } })();
  applyView();
  layout(false);
  watchHero();
  empty.hidden = poolSize > 0;
  updateStatus();
  paintSimNone();
  if(quiet) return;   // 途中の段は、元に戻すだけ
  window.scrollTo({ top:sn.y, behavior:'instant' });
  slideGrid('view-back');
  // 一度に戻ったときは、いちばん最初に来た画像を光らせる
  if(v.from) revealCard(v.from);
}
function backUI(){ if(!views.length) return; popLayer('deep'); restoreView(); }
// 一度に戻る：keep 段だけ残して、あとは閉じる（0 なら元の一覧）
function backTo(keep){
  if(keep >= views.length) return;
  const deepAt = layers.map((x, i) => x === 'deep' ? i : -1).filter(i => i >= 0);
  if(deepAt[keep] != null) popLayer('deep', deepAt[keep]);
  while(views.length > keep + 1) restoreView(true);
  restoreView();
}
// 「‹ 一覧」：元の一覧まで一度に戻る。道すじの画像を押すと、その段へ戻る（一段だけなら1つ左を押す。Esc・ブラウザの戻るも一段ずつ）
$('backBtn').addEventListener('click', () => backTo(0));
$('simFilterBtn').addEventListener('click', () => openFilter());
const IMG_OFF = '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2"/><path d="M3 3l14 14"/></svg>';
const PATH_SEP = '<svg class="path-sep" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 2.5l3.5 3.5-3.5 3.5"/></svg>';
function renderPath(){
  const box = $('deepPath');
  box.innerHTML = '';
  [...views, ...fwd].forEach((v, i) => {
    if(i) box.insertAdjacentHTML('beforeend', PATH_SEP);
    const b = el('button', 'path-item' + (i >= views.length ? ' ahead' : '')); b.type = 'button';
    const cur = i === views.length - 1, ahead = i >= views.length;
    b.setAttribute('aria-current', String(cur));
    const name = v.kind === 'sim' ? ((v.sim.center.t || '').trim() || v.sim.center.d || '似た画像') : 'サムネイルが出ないもの';
    b.title = cur ? name : `${name}（${i + 1}段目）${ahead ? 'へ進む' : 'に戻る'}`;
    b.setAttribute('aria-label', b.title);
    if(v.kind === 'sim' && v.thumb){ const im = el('img', 'path-thumb'); im.src = v.thumb; im.alt = ''; im.referrerPolicy = 'no-referrer'; im.onerror = () => im.replaceWith(Object.assign(el('span', 'path-thumb'), { innerHTML:IMG_OFF })); b.append(im); }
    else{ const t = el('span', 'path-thumb'); t.innerHTML = IMG_OFF; b.append(t); }
    // 今の段を押すと、一覧のいちばん上へ
    b.addEventListener('click', () => { if(cur) window.scrollTo({ top:0, behavior:'smooth' }); else if(ahead) goForward(i - views.length + 1); else backTo(i + 1); });
    box.append(b);
  });
  // 今の段が見えるように（先の段があれば、今の段を右寄りに）
  const curEl = box.querySelector('[aria-current="true"]');
  box.scrollLeft = curEl ? curEl.offsetLeft + curEl.offsetWidth - box.clientWidth + (fwd.length ? 56 : 0) : box.scrollWidth;
  box.classList.toggle('more-left', box.scrollLeft > 0);
}
$('deepPath').addEventListener('scroll', e => e.target.classList.toggle('more-left', e.target.scrollLeft > 2), { passive:true });
function renderDeepBar(){
  const v = views[views.length - 1];
  document.querySelector('header').classList.toggle('deep', !!v);
  $('ntCheck').hidden = !ntMode;
  // 似た画像の絞り込み：似た画像の画面だけ。かけている間は青
  const fb = $('simFilterBtn'), sum = simF ? filterSummary(simF) : '';
  fb.hidden = !(v && v.kind === 'sim');
  fb.classList.toggle('active', !!sum);
  fb.title = (sum ? '絞り込み中：' + sum : '絞り込み') + '（F）';
  if(!v){ $('simNone').hidden = true; return; }
  renderPath();
  if(v.kind === 'sim'){ $('deepName').textContent = ''; $('deepSub').textContent = ''; return; }
  $('deepName').textContent = 'サムネイルが出ないもの';
  if(ntChecking){ $('ntCheck').textContent = '止める'; return; }
  const pool = cache ? cache.items.filter(makeFilter(state.filter)) : [];
  const unknown = pool.filter(isThumbUnknown).length;
  $('deepSub').textContent = `${poolSize.toLocaleString()}件` + (unknown ? `・未確認 ${unknown.toLocaleString()}件` : '');
  $('ntCheck').textContent = unknown ? '確かめる' : '確かめ直す';
  $('ntCheck').title = unknown ? 'まだ一度も画像を出していないものを、小さいサイズで読んで確かめます' : '今並んでいるものを、もう一度読んで確かめます（直したものは外れます）';
}

// ---- 戻る：「‹ 戻る」・Esc・ブラウザの戻る・マウスの戻るボタンは同じ動き ----
// 上に重なっているものから1つずつ閉じる：メニュー → 編集 → プレビュー → 一段奥の画面
// 履歴にはプレビューと一段奥の画面を積む（メニューと編集は、戻るで閉じたら履歴を積み直す）
const layers = [];
let ignorePop = 0, pushWait = 0;
function pushLayer(name, underTop){
  if(underTop && layers.length) layers.splice(layers.length - 1, 0, name); else layers.push(name);
  if(ignorePop){ pushWait++; return; }   // 戻る途中なら、終わってから積む
  history.pushState({ rd:layers.length }, '');
}
// アプリの中で閉じたとき：その層（と上の層）の履歴を消す
function popLayer(name, at){
  const i = at != null ? at : layers.lastIndexOf(name);
  if(i < 0) return;
  const n = layers.length - i;
  layers.splice(i);
  if(pushWait >= n){ pushWait -= n; return; }
  const go = n - pushWait; pushWait = 0;
  ignorePop++; history.go(-go);
}
addEventListener('popstate', e => {
  if(ignorePop){ ignorePop--; if(!ignorePop){ const base = layers.length - pushWait; for(let k = 1; k <= pushWait; k++) history.pushState({ rd:base + k }, ''); pushWait = 0; } return; }
  const to = e.state && Number.isFinite(e.state.rd) ? e.state.rd : 0;
  // 進む：先の段があればそこへ。なければ（閉じたプレビューなど）打ち消す
  if(to > layers.length){
    const n = peek.open ? 0 : Math.min(to - layers.length, fwd.length);
    if(n) goForward(n, true);
    if(to > layers.length){ ignorePop++; history.go(layers.length - to); }
    return;
  }
  const again = () => history.pushState({ rd:layers.length }, '');
  if(!viewMenu.hidden || !sortMenu.hidden || !pressMenu.hidden){ setMenu(false); setSortMenu(false); closePressMenu(); if(layers.length) again(); return; }
  if(peek.open && editOpen && layers[layers.length - 1] !== 'crop'){ setEditOpen(false); again(); return; }
  // 戻る：上から1つずつ閉じる（ブラウザで何段もまとめて戻ったときは、その分だけ）
  while(layers.length > to){
    const top = layers.pop();
    if(top === 'crop') hideCrop();
    else if(top === 'peek') closePeek();
    else if(top === 'deep') restoreView(layers.length > to && layers[layers.length - 1] === 'deep');
  }
});
// スクロール位置は自分で戻す（ブラウザに任せると、戻るときに一段奥の画面の位置へ動かされる）
if('scrollRestoration' in history) history.scrollRestoration = 'manual';
history.replaceState({ rd:0 }, '');

// 件数の行は出さない（件数は絞り込みの画面で見られる）。読み込み中・失敗のときだけ文字が入る
function updateStatus(){
  if(poolSize) statusEl.textContent = '';
  moreEl.hidden = !poolSize || !!(sim && simF && poolSize <= 1);
  moreEl.textContent = shownCount < poolSize ? '続きを読み込み中…'
    : state.sort === 'shuffle' ? 'これで全部です。シャッフルで並べ直せます。' : 'これで全部です。';
}

// 石積みのような並べ方：列の数を決めておき、新しいカードはいちばん短い列に足す。
// 後から足しても、もう表示しているカードは動かない
let cols = [];
let colCount = 0;
let cardEls = [];

// 小さいカードほど隙間も詰める
function gapFor(col){ return Math.round(Math.min(16, Math.max(8, col * 0.07))); }
function wantedCols(){
  const gap = gapFor(state.col);
  const w = grid.clientWidth || document.documentElement.clientWidth;
  return Math.max(1, Math.floor((w + gap) / (state.col + gap)));
}

function layout(force){
  const n = wantedCols();
  // カードは指定した幅のまま並べる（横幅いっぱいに引き伸ばさない）
  const w = grid.clientWidth || document.documentElement.clientWidth;
  grid.style.setProperty('--gap', gapFor(state.col) + 'px');
  grid.style.setProperty('--colw', Math.min(state.col, w) + 'px');
  const hero = heroOf();
  if(!force && n === colCount){ sizeHero(hero); return; }
  colCount = n;
  grid.innerHTML = '';
  cols = [];
  for(let i = 0; i < n; i++){
    const c = document.createElement('div');
    c.className = 'col';
    grid.append(c);
    cols.push(c);
  }
  if(hero) putHero(hero);   // 上の画像は、列を作り直しても同じ形で先頭に
  cardEls.filter(c => c._placed).forEach(placeCard);
  paintSimNone();
}

// 似た画像の画面の、上の画像（1列目の先頭）と、2列目の先頭に置く同じ高さの空き
const heroOf = () => grid.querySelector('.col > .sim-hero');
const allCards = () => { const h = heroOf(); return h ? [h, ...cardEls] : cardEls; };
function putHero(h){
  cols[0].prepend(h);
  if(cols.length >= 2){
    const g = el('div', 'sim-gap'); g.setAttribute('aria-hidden', 'true');
    cols[1].prepend(g);
  }
  sizeHero(h);
}
// 上の画像の幅：列が2本以上なら2列ぶん（列の幅×2＋すき間）、1本ならその列の幅
function sizeHero(c){
  if(!c) return;
  const w = grid.clientWidth || document.documentElement.clientWidth;
  const colw = Math.min(state.col, w), W = colCount >= 2 ? colw * 2 + gapFor(state.col) : colw;
  c.style.width = W + 'px';
  syncHeroGap();
}
// 2列目の空きを上の画像と同じ高さに（ほかのカードは、いちばん短い列に足すので右と下へ詰まる）
function syncHeroGap(){
  const h = heroOf(), g = grid.querySelector('.col > .sim-gap');
  if(h && g) g.style.height = h.offsetHeight + 'px';
  if(h) placeHeroCrop(h);
  if(sim && simF && poolSize <= 1) paintSimNone();
}
// 上の画像の高さが後から変わったとき（説明の行が変わったときなど）も空きを合わせる
const heroRO = new ResizeObserver(syncHeroGap);
function watchHero(){ heroRO.disconnect(); const h = heroOf(); if(h) heroRO.observe(h); }

function placeCard(el){
  let best = cols[0];
  for(const c of cols) if(c.offsetHeight < best.offsetHeight) best = c;
  best.append(el);
}

function ago(t){
  const m = Math.floor((Date.now() - t) / 60000);
  if(m < 1) return 'たった今';
  if(m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if(h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

// サムネの候補を順に：カバー画像、続いて添付されている画像・動画
function thumbs(it){
  const list = [];
  const seen = new Set();
  const add = (url, type) => {
    if(!url || seen.has(url)) return;
    seen.add(url);
    list.push({ url, video: type === 'video' || VIDEO_EXT.test(url) });
  };
  const px = u => u.replace('://i.pximg.net/', '://i.pixiv.re/');
  add(px(it.c || ''), '');
  (it.m || []).forEach(x => add(px(x.l), x.t));
  return list;
}

// 直接は画像を取れないサイト（pixiv・X）のサムネを、公開されている中継サービスで探す
const thumbCache = store.get('thumbs', {});
let thumbSaveTimer = 0;
function rememberThumb(link, url){
  thumbCache[link] = url;
  clearTimeout(thumbSaveTimer);
  thumbSaveTimer = setTimeout(() => {
    const keys = Object.keys(thumbCache);
    if(keys.length > 3000) keys.slice(0, keys.length - 3000).forEach(k => delete thumbCache[k]);
    store.set('thumbs', thumbCache);
  }, 1000);
}

// X の投稿の情報（fxtwitter 経由）。サムネと動画の両方で同じ結果を使い回す。
// sure = 「画像なし」と確定してよいか（通信の失敗では確定しない）
const fxCache = new Map();
function fxTweet(id){
  if(!fxCache.has(id)){
    fxCache.set(id, fetch(`https://api.fxtwitter.com/status/${id}`)
      .then(r => r.ok ? r.json().then(j => ({ tweet:j.tweet || null, sure:true })) : { tweet:null, sure:r.status === 404 })
      .catch(() => { fxCache.delete(id); return { tweet:null, sure:false }; }));
  }
  return fxCache.get(id);
}

async function siteThumbs(it){
  let u;
  try{ u = new URL(it.l); }catch(e){ return []; }
  const host = u.hostname.replace(/^(www|mobile)\./, '');
  if(host === 'pixiv.net'){
    const m = u.pathname.match(/artworks\/(\d+)/) || (u.searchParams.get('illust_id') || '').match(/(\d+)/);
    if(!m) return [];
    return [`https://pixiv.re/${m[1]}.jpg`, `https://pixiv.re/${m[1]}-1.jpg`];
  }
  const id = xId(it.l);
  if(!id) return [];
  // '-' = 確認済みで画像なし
  const hit = thumbCache[it.l];
  if(hit === '-') return [];
  if(hit) return [hit];
  const { tweet, sure } = await fxTweet(id);
  const t = tweet || {};
  const first = (list, key) => list && list[0] && list[0][key];
  const media = t.media || {}, qm = (t.quote && t.quote.media) || {};
  let url = first(media.photos, 'url') || first(media.videos, 'thumbnail_url')
    || (media.mosaic && media.mosaic.formats && media.mosaic.formats.jpeg)
    || first(qm.photos, 'url') || first(qm.videos, 'thumbnail_url')
    || (t.card && t.card.image && t.card.image.url) || '';
  if(url && /pbs\.twimg\.com\/media\//.test(url) && !url.includes('?')) url += '?name=small';
  if(sure) rememberThumb(it.l, url || '-');
  return url ? [url] : [];
}

// 大きく見せるときは X の画像を大きいサイズで取る
const bigUrl = u => u.replace(/([?&]name=)(small|medium|thumb|\w+x\w+)/, '$1large');
// 小さく取る：X は小さいサイズを指定、それ以外は画像の縮小サービス（wsrv.nl）を通す。
// 縮小サービスで読めなかったときは、元の画像に戻して読み直す（mediaEl 側）
const isX = u => /pbs\.twimg\.com\//.test(u);
function smallUrl(u, w){
  if(isX(u)) return /[?&]name=/.test(u) ? u.replace(/([?&]name=)\w+/, '$1small') : u + (u.includes('?') ? '&' : '?') + 'name=small';
  if(!/^https?:/.test(u)) return u;
  return `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=${w}&fit=inside&we&output=webp&q=70`;
}
// size: 'card' 一覧のカード / 'low' プレビューの最初の1枚 / 'full' プレビューの元の大きさ
function sizedUrl(u, size){
  if(size === 'full') return bigUrl(u);
  if(size === 'low') return state.saver ? smallUrl(u, 1000) : u;   // 普段は一覧と同じ（読み込み済みなのですぐ出る）
  if(size === 'hero') return state.saver ? smallUrl(u, 1000) : u;  // 似た画像の画面の上の画像（プレビューの最初と同じ画像）
  return state.saver ? smallUrl(u, Math.min(800, Math.round(state.col * Math.min(2, devicePixelRatio || 1)))) : u;
}
// プレビューで次（と前）に見そうな画像を先に読み込んでおく。送ったときにすぐ出るように
const prefetched = [];
function prefetchAround(it){
  const i = order.indexOf(it);
  [i + 1, i + 2, i - 1].forEach(j => {
    const x = order[j];
    if(!x || x._pre) return;
    x._pre = true;
    const go = url => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer'; img.decoding = 'async';
      img.src = state.saver ? sizedUrl(url, 'low') : bigUrl(url);
      if(img.decode) img.decode().catch(() => {});
      prefetched.push(img);
      if(prefetched.length > 8) prefetched.shift();   // 持ちすぎない
    };
    const first = thumbs(x).find(c => !c.video);
    if(first) go(first.url);
    else siteThumbs(x).then(urls => { if(urls[0]) go(urls[0]); });
  });
}
// 候補を順に試して、最初に読み込めたものを表示する。全部だめならタイトルの文字で見せる。
// done() は大きさが決まった時点で呼ぶ（列に偏りなく並べるのに使う）
function mediaEl(it, list, i, done = () => {}, eager = false, size = 'card'){
  const big = size === 'full' || size === 'low';
  if(i >= list.length){
    if(list.extra){ done(); markThumb(it, false); return placeholder(it); }
    const ph = placeholder(it);
    siteThumbs(it).then(urls => {
      if(!urls.length && ph.parentNode) markThumb(it, false);
      if(!urls.length || !ph.parentNode){ done(); return; }
      const more = urls.map(url => ({ url, video:false }));
      more.extra = true;
      ph.replaceWith(mediaEl(it, more, 0, done, eager, size));
    });
    return ph;
  }
  const cand = list[i];
  const src = cand.video ? cand.url : sizedUrl(cand.url, size);
  let node;
  if(cand.video){
    node = document.createElement('video');
    node.muted = true;
    node.playsInline = true;
    node.preload = 'metadata';
    node.src = src + (src.includes('#') ? '' : '#t=0.1');
    if(big){ node.controls = true; node.loop = true; }
    node.addEventListener('loadedmetadata', () => { markThumb(it, true); done(); }, { once:true });
  }else{
    node = new Image();
    node.loading = eager ? 'eager' : 'lazy';
    node.addEventListener('load', () => { markThumb(it, true); done(); }, { once:true });
    node.decoding = 'async';
    node.alt = '';
    node.referrerPolicy = 'no-referrer';
    node.src = src;
    node.dataset.orig = cand.url;
    // プレビューで小さい方から出したときは、元の大きさの住所を覚えておく（「高画質で見る」で使う）
    const full = bigUrl(cand.url);
    if(size === 'low' && full !== src) node.dataset.full = full;
  }
  node.className = 'thumb';
  node.addEventListener('error', () => {
    // 縮小サービスで読めなかったら、まず元の画像で読み直す
    if(!cand.video && node.src !== cand.url && !node.dataset.retried && /wsrv\.nl/.test(node.src)){
      node.dataset.retried = '1'; delete node.dataset.full; node.src = cand.url; return;
    }
    node.replaceWith(mediaEl(it, list, i + 1, done, eager, size));
  });
  return node;
}

// Raindrop のアプリでのそのブックマークの編集ページ
function raindropUrl(it){
  const coll = (it.k === 0 || it.k) ? it.k : 0;
  return `https://app.raindrop.io/my/${coll}/item/${it.i}/edit`;
}

const RD_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2.5c-.4 0-.8.2-1 .6C9.3 5.8 5.5 11 5.5 14.6A6.5 6.5 0 0 0 12 21a6.5 6.5 0 0 0 6.5-6.4C18.5 11 14.7 5.8 13 3.1c-.2-.4-.6-.6-1-.6Z"/></svg>';

function collName(it){
  if(it.k === -1) return '未整理';
  if(it.k === -99) return 'ゴミ箱';
  return collLabel.get(it.k) || '';
}

// カードの下の文字：「フォルダ · 保存日」と ♥ の数を1行、タグを1行
// タグは最後の区切り（「t3 - Genre - 背景」なら「背景」）だけを出し、入りきらない分は「＋2」
const shortTag = t => { const p = String(t).split(' - '); return (p[p.length - 1] || '').trim() || t; };
function shortDate(a){
  const [y, m, d] = a.split('-').map(Number);
  return y === new Date().getFullYear() ? `${m}/${d}` : `${y}/${m}/${d}`;
}
// 文字の幅のおおよそ（11px：英数字は約6.2、それ以外は約11）
const textW = t => [...t].reduce((w, ch) => w + (ch.charCodeAt(0) < 0x2e80 ? 6.2 : 11), 0);
function captionEl(it){
  const name = collName(it) || 'コレクションなし';
  const top = el('div', 'cap-top');
  const meta = el('span', 'meta', it.a ? `${name} · ${shortDate(it.a)}` : name);
  meta.title = it.a ? `${name}（${it.a.replace(/-/g, '/')} に保存）` : name;
  top.append(meta);
  const n = likesOf(it);
  if(n){ const h = el('span', 'cap-like', '♥'.repeat(n)); h.title = `♥ ${n}`; top.append(h); }
  const tags = el('div', 'tags');
  if(it.g && it.g.length){
    const room = Math.max(40, state.col - 24);
    let used = 0, shown = 0;
    for(const g of it.g){
      const t = '#' + shortTag(g), w = textW(t) + (shown ? 8 : 0);
      const restW = shown + 1 < it.g.length ? 32 : 0;   // 「＋2」の分
      if(shown && used + w + restW > room) break;
      tags.append(el('span', 'tag', t)); used += w; shown++;
    }
    if(shown < it.g.length) tags.append(el('span', 'tag-more', `＋${it.g.length - shown}`));
    tags.title = it.g.map(g => '#' + g).join('\n');
  }else tags.append(el('span', 'none', 'タグなし'));
  const cap = el('div', 'cap');
  cap.append(top, tags);
  return cap;
}

const cardOf = new WeakMap();   // ブックマーク → 表示しているカード
// アイコン：大きさ 20・線の太さ 1.5 にそろえる（× ▾ ♥ のような文字の記号は使わない）
const ICONS = {
  x:'<path d="M5 5l10 10M15 5L5 15"/>',
  up:'<path d="M4.5 12.5l5.5-5.5 5.5 5.5"/>',
  right:'<path d="M7.5 4.5l5.5 5.5-5.5 5.5"/>',
  tag:'<path d="M3.5 4.5v5l7 7 6-6-7-7h-5z"/><circle cx="7" cy="7.5" r="1"/>',
  down:'<path d="M4.5 7.5l5.5 5.5 5.5-5.5"/>',
  plus:'<path d="M10 4.5v11M4.5 10h11"/>',
  bulb:'<path d="M7.5 14.5h5M8 17h4M10 2.5a5 5 0 0 0-3 9c.6.5 1 1.2 1 2v1h4v-1c0-.8.4-1.5 1-2a5 5 0 0 0-3-9z"/>',
  pin:'<path d="M7.5 2.5h5l-.8 5.2 3.3 3.3H5l3.3-3.3zM10 11v6.5"/>',
  expand:'<path d="M3.5 8V3.5H8M12 3.5h4.5V8M16.5 12v4.5H12M8 16.5H3.5V12"/>',
  crop:'<path d="M5.5 2.5v12h12M2.5 5.5h12v12"/>',
  heart:'<path d="M10 16.5C4.6 12.9 2.5 10.1 2.5 7.4c0-2.2 1.7-3.9 3.8-3.9 1.5 0 2.8.8 3.7 2.1.9-1.3 2.2-2.1 3.7-2.1 2.1 0 3.8 1.7 3.8 3.9 0 2.7-2.1 5.5-7.5 9.1z"/>',
};
const icon = (name, cls = '') => `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const CHECK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// top：似た画像の画面のいちばん上に置く、押した画像（sim.center）
function card(it, top = false){
  const wrap = el('div', 'card' + (top ? ' sim-hero is-base' : ''));
  const a = el('a', 'card-link');
  a.href = it.l;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = it.t || it.l;
  a.addEventListener('click', e => {
    // 長押しで選んだ直後の「離した」クリックは無視する
    if(wrap._long){ e.preventDefault(); wrap._long = false; return; }
    // 選んでいる最中は、押すと選択の切り替え（Shift で範囲）
    if(selected.size){ e.preventDefault(); pickCard(it, e.shiftKey); return; }
    // 普通のクリックはプレビュー。⌘クリックや中ボタンはサイトを開く
    if(e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    // 似た画像の画面では、押した画像の似た画像へ一段下がる（上に置いた画像はプレビュー）
    if(sim && !top){ showSimilar(it); return; }
    openPeek(it);
  });
  const list = thumbs(it);
  // 上に置く画像は大きく出すので、プレビューと同じ画像を使う（読み込めたら2列目の空きを同じ高さに）
  const cut = top && sim && sim.crop;
  wrap._ready = new Promise(res => a.append(cut ? cropImgEl(cut, () => { sizeHero(wrap); res(); }) : top ? mediaEl(it, list, 0, () => { sizeHero(wrap); res(); }, true, 'hero') : mediaEl(it, list, 0, res, true)));
  if(cut) wrap._crop = true;
  a.append(captionEl(it));
  wrap.append(a);
  wrap._item = it;
  wrap._was = snapOf(it);
  // X の GIF はサムネイルの URL で見分けられる
  const isGif = /tweet_video_thumb/.test(it.c || '');
  if(isGif || it.y === 'video' || list.some(x => x.video) || /(amplify|ext_tw)_video_thumb/.test(it.c || '')){
    wrap.append(el('span', 'badge' + (isGif ? ' gif' : ''), isGif ? 'GIF' : '動画'));
  }
  const rd = el('a', 'rd-btn');
  rd.href = raindropUrl(it);
  rd.target = '_blank';
  rd.rel = 'noopener';
  rd.title = 'Raindrop で開く';
  rd.setAttribute('aria-label', 'Raindrop で開く');
  rd.innerHTML = RD_ICON;
  // 左上のチェック：押すと複数選択が始まる
  const box = el('button', 'sel-box'); box.type = 'button';
  box.title = '選択（Shift で範囲）'; box.setAttribute('aria-label', '選択');
  box.innerHTML = CHECK_SVG;
  box.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); pickCard(it, e.shiftKey); });
  if(top){ wrap._hero = true; wrap.append(rd, heroCropBtn(wrap)); }
  else if(sim){
    // 似た画像の画面では、押すと一段下がるので、そのままプレビューするボタンを水滴の隣に
    const pv = el('button', 'rd-btn pv-btn'); pv.type = 'button';
    pv.title = 'プレビュー'; pv.setAttribute('aria-label', 'プレビュー');
    pv.innerHTML = icon('expand');
    pv.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openPeek(it); });
    wrap.append(rd, pv, box);
  }else wrap.append(rd, box);
  if(selected.has(it)) wrap.classList.add('picked');
  cardOf.set(it, wrap);
  return wrap;
}

