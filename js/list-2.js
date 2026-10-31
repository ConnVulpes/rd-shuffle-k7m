/* サムネが出ないものの画面（ntMode thumbOk checkThumbs）。② で list.js に寄せる
   （一段奥の画面の1つ。メニューの「サムネイルが出ないもの」から開く） */
// ---- サムネが出ないものだけを並べる（メニューから。今の絞り込みの中から選ぶ）----
// 一覧やプレビューで画像を出そうとした結果を、ブックマークごとに覚えておく（出た／どの候補も出なかった）。
// サムネの候補（カバーや添付）が変わったら、覚えていた結果は使わない
var ntMode = false;
const thumbOk = store.get('thumbok', {});   // ID → '1:印' か '0:印'（印 = 候補の URL から作った短い文字）
let thumbOkTimer = 0, ntBarTimer = 0;
const strHash = s => { let h = 2166136261; for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const thumbSig = it => strHash(thumbs(it).map(x => x.url).join('|') + '|' + it.l);
function markThumb(it, ok){
  if(!ok && navigator.onLine === false) return;   // つながっていないときの失敗は覚えない
  const v = (ok ? '1:' : '0:') + thumbSig(it);
  if(thumbOk[it.i] === v) return;
  thumbOk[it.i] = v;
  clearTimeout(thumbOkTimer);
  thumbOkTimer = setTimeout(() => store.set('thumbok', thumbOk), 1500);
  if(ntMode){ clearTimeout(ntBarTimer); ntBarTimer = setTimeout(renderDeepBar, 300); }
}
function thumbState(it){
  const v = thumbOk[it.i]; if(!v) return null;
  return v.slice(2) === thumbSig(it) ? v[0] === '1' : null;
}
// 候補が1つもなく、中継サービスで探せるサイト（X・pixiv）でもないもの：確かめるまでもなく出ない
const canSiteThumb = it => !!xId(it.l) || /pixiv\.net\/(?:.*artworks\/\d+|.*illust_id=\d+)/.test(it.l || '');
const surelyNone = it => !thumbs(it).length && !canSiteThumb(it);
function isNoThumb(it){ const s = thumbState(it); return s === null ? surelyNone(it) : !s; }
const isThumbUnknown = it => thumbState(it) === null && !surelyNone(it);

// 確かめる：小さいサイズで1枚ずつ読んでみる（6件ずつ同時に）
const tinyUrl = u => /pbs\.twimg\.com\//.test(u) ? (u.includes('name=') ? u.replace(/([?&]name=)\w+/, '$1thumb') : u + (u.includes('?') ? '&' : '?') + 'name=thumb')
  : `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=48&h=48&fit=cover&output=webp`;
function probeImg(url){
  return new Promise(res => {
    const im = new Image(); im.referrerPolicy = 'no-referrer';
    const t = setTimeout(() => { im.src = ''; res(false); }, 15000);
    im.onload = () => { clearTimeout(t); res(true); }; im.onerror = () => { clearTimeout(t); res(false); };
    im.src = url;
  });
}
function probeVideo(url){
  return new Promise(res => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'metadata';
    const t = setTimeout(() => { v.removeAttribute('src'); res(false); }, 15000);
    v.onloadedmetadata = () => { clearTimeout(t); v.removeAttribute('src'); v.load(); res(true); }; v.onerror = () => { clearTimeout(t); res(false); };
    v.src = url;
  });
}
async function probeThumb(it){
  for(const c of thumbs(it)){
    if(c.video ? await probeVideo(c.url) : (await probeImg(tinyUrl(c.url)) || await probeImg(c.url))) return true;
  }
  for(const u of await siteThumbs(it)) if(await probeImg(tinyUrl(u)) || await probeImg(u)) return true;
  return false;
}
let ntChecking = false, ntStop = false;
async function checkThumbs(list){
  ntChecking = true; ntStop = false; renderDeepBar();
  let next = 0, done = 0;
  const worker = async () => {
    while(!ntStop && next < list.length){
      const it = list[next++];
      try{ markThumb(it, await probeThumb(it)); }catch(e){}
      done++;
      if(ntMode) $('deepSub').textContent = `確かめています… ${done.toLocaleString()} / ${list.length.toLocaleString()}`;
    }
  };
  await Promise.all(Array.from({ length:6 }, worker));
  store.set('thumbok', thumbOk);
  ntChecking = false;
  if(ntMode && cache) render(); else renderDeepBar();
}
$('ntBtn').addEventListener('click', () => { setMenu(false); if(ntMode || !cache) return; enterView({ kind:'nt' }); });
$('ntCheck').addEventListener('click', () => {
  if(ntChecking){ ntStop = true; return; }
  const pool = cache.items.filter(makeFilter(state.filter));
  const unknown = pool.filter(isThumbUnknown);
  checkThumbs(unknown.length ? unknown : pool.filter(isNoThumb).filter(it => !surelyNone(it)));
});

