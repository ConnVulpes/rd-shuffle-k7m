/* プレビュー：開く（openPeek）・前後へ送る・後ろを止める（lockScroll）、動画、回転と反転、
   省データ（高画質は押したとき）、画像の下の2行に出す文字（itemTitle siteName saveDate authorName） */
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

