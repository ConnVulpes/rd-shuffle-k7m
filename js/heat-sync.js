/* ♥ と熱（cycleLike heatWeight）、設定の同期（pullSettings） */
// ---- ♥ と熱：今「いいな」と思っているものを、シャッフルで少し多めに出す ----
// ♥（1〜3回）と、プレビューで見た動き（長く見た・拡大・高画質・サイトを開いた）が熱になる。
// 熱は2週間で半分に冷める。♥ したものは冷めきっても、普通より少しだけ出やすいまま残る
const HALF = 14 * DAY;
const LIKE_HEAT = 3, LIKE_FLOOR = 0.3;
// 強さは 0〜100%。50% が前の「中」（効き具合 1）、100% が前の「強」（2）
const HEAT_OLD = { off:0, low:25, mid:50, high:100 };
state.heatPct = Number(store.get('heatpct', HEAT_OLD[store.get('heatstr', 'mid')] ?? 50));
const heatStrength = () => Math.max(0, Math.min(100, state.heatPct || 0)) / 50;
state.heatImp = store.get('heatimp', true);
// heat: ID → { L:♥の数, tl:♥を変えた時刻, e:動きの熱, te:動きの熱を足した時刻 }
let heat = new Map();
(function loadHeat(){
  const raw = store.get('heat', {});
  for(const [id, v] of Object.entries(raw || {})) heat.set(Number(id), { L:v[0] || 0, tl:(v[1] || 0) * 60000, e:v[2] || 0, te:(v[3] || 0) * 60000 });
})();
const decay = (v, t, now) => v ? v * Math.pow(0.5, Math.max(0, now - t) / HALF) : 0;
const likesOf = it => (heat.get(it.i) || {}).L || 0;
function heatWeight(id, now, s){
  const h = heat.get(id);
  if(!h) return 1;
  return 1 + s * (decay(LIKE_HEAT * h.L, h.tl, now) + decay(h.e, h.te, now) + LIKE_FLOOR * h.L);
}
// 保存用の短い形（時刻は分単位）。冷めきった動きの熱だけのものは捨てる
function heatPacked(){
  const now = Date.now(), out = {};
  heat.forEach((h, id) => {
    const e = decay(h.e, h.te, now);
    if(!h.L && e < 0.03) return;
    out[id] = [h.L, Math.round(h.tl / 60000), h.e, Math.round(h.te / 60000)];
  });
  return out;
}
function heatUnpack(obj){
  const m = new Map();
  for(const [id, v] of Object.entries(obj || {})) m.set(Number(id), { L:v[0] || 0, tl:(v[1] || 0) * 60000, e:v[2] || 0, te:(v[3] || 0) * 60000 });
  return m;
}
let heatSaveTimer = 0;
function heatChanged(){
  clearTimeout(heatSaveTimer);
  heatSaveTimer = setTimeout(() => store.set('heat', heatPacked()), 500);
  scheduleSync(20000);   // 熱はこまめに変わるので、送るのはまとめて
}
// ♥：押すたびに 1 → 2 → 3 → なし
function cycleLike(it){
  const h = heat.get(it.i) || { L:0, tl:0, e:0, te:0 };
  h.L = h.L >= 3 ? 0 : h.L + 1;
  h.tl = Math.round(Date.now() / 60000) * 60000;
  heat.set(it.i, h);
  heatChanged();
  scheduleSync(3000);
  paintLike();
  const c = cardOf.get(it);
  if(c){ const old = c.querySelector('.cap'); if(old) old.replaceWith(captionEl(it)); }
  zoomInd.textContent = h.L ? '♥'.repeat(h.L) : '♥ を外しました';
  zoomInd.classList.add('show'); clearTimeout(zoomIndTimer);
  zoomIndTimer = setTimeout(() => zoomInd.classList.remove('show'), 900);
}
function paintLike(){
  const b = $('peekLike'), n = peekItem ? likesOf(peekItem) : 0;
  b.dataset.n = String(n);
  b.setAttribute('aria-pressed', String(n > 0));
  $('peekLikeV').innerHTML = icon('heart', n ? 'fill' : '');
  $('peekLikeN').textContent = n > 1 ? String(n) : '';
  b.title = n ? `♥ ${n}（押すと ${n >= 3 ? 'なし' : n + 1} に・L）` : '♥ を付ける（L）';
}
$('peekLike').addEventListener('click', e => { e.stopPropagation(); if(peekItem) cycleLike(peekItem); });
// 見た動き：プレビューで見ていた時間と、拡大・高画質・サイトを開いたことを、離れたときにまとめて熱にする
let viewing = null;   // { it, t0, ms, bonus:Set }
function viewStart(it){ viewEnd(); viewing = { it, t0:document.visibilityState === 'visible' ? Date.now() : 0, ms:0, bonus:new Set() }; }
function viewPause(){ if(viewing && viewing.t0){ viewing.ms += Date.now() - viewing.t0; viewing.t0 = 0; } }
function viewResume(){ if(viewing && !viewing.t0) viewing.t0 = Date.now(); }
function viewBonus(kind){ if(viewing) viewing.bonus.add(kind); }
function viewEnd(){
  if(!viewing) return;
  viewPause();
  const v = viewing; viewing = null;
  if(!state.heatImp) return;
  const sec = Math.min(60, v.ms / 1000);
  let amt = sec >= 3 ? 0.05 + sec / 60 * 0.35 : 0;   // 3秒〜1分で 0.05〜0.4
  if(v.bonus.has('zoom')) amt += 0.15;
  if(v.bonus.has('hq')) amt += 0.15;
  if(v.bonus.has('site')) amt += 0.3;
  amt = Math.min(0.8, amt);
  if(amt <= 0) return;
  const now = Date.now();
  const h = heat.get(v.it.i) || { L:0, tl:0, e:0, te:0 };
  h.e = Math.round((decay(h.e, h.te, now) + amt) * 100) / 100; h.te = Math.round(now / 60000) * 60000;
  heat.set(v.it.i, h);
  heatChanged();
}
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') viewResume(); else viewPause(); });
$('peekOpen').addEventListener('click', () => viewBonus('site'));
// メニュー：効き具合と、動きをためるかどうか
const heatPct = $('heatPct'), heatImpBtn = $('heatImpToggle');
function applyHeatPct(){ heatPct.value = String(state.heatPct); $('heatPctVal').textContent = state.heatPct + '%'; }
heatPct.addEventListener('input', () => { state.heatPct = Number(heatPct.value); store.set('heatpct', state.heatPct); applyHeatPct(); });
applyHeatPct();
heatImpBtn.checked = state.heatImp;
heatImpBtn.addEventListener('change', () => { state.heatImp = heatImpBtn.checked; store.set('heatimp', state.heatImp); });

// ---- 設定の同期（プリセット・固定タグ・♥と熱）----
// Raindrop の「rd-shuffle 設定」フォルダに、メモ欄へ設定を書いたブックマークを置く（1件1万文字までなので、長ければ分ける）。
// プリセットと固定タグは新しい方（at が大きい方）を正とし、熱は1件ずつ新しい方を取って合わせる
let syncRef = store.get('syncref', null);   // { coll:フォルダID }
let syncAt = store.get('syncat', 0);        // 手元のプリセット・固定タグがいつのものか（0 = まだ一度も同期していない）
let lastPull = 0, syncTimer = 0, syncing = null, syncAgain = false;
const CHUNK = 9000;
function settingsChanged(){
  syncAt = Date.now(); store.set('syncat', syncAt);
  scheduleSync(1500);
}
function scheduleSync(ms){
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pullSettings(), ms);
}
function applyRemote(r){
  presets = Array.isArray(r.presets) ? r.presets : [];
  pins = Array.isArray(r.pins) ? r.pins.slice(0, 9) : [];
  store.set('presets', presets); store.set('pins', pins);
  syncAt = r.at || Date.now(); store.set('syncat', syncAt);
  syncFilter();
  if(filterDlg.open && !presetNaming) renderPresets();
  if(peek.open && editOpen && peekItem) renderEdit();
}
// 初めて同期するとき：両方にあるものは合わせる（同じ名前のプリセットは手元を優先）
function mergeFirst(r){
  const names = new Set(presets.map(p => p.name));
  presets = presets.concat((r.presets || []).filter(p => !names.has(p.name)));
  pins = [...new Set([...pins, ...(r.pins || [])])].slice(0, 9);
}
// 熱は1件ずつ、最後に変わった方を取る
function mergeHeat(remote){
  const last = h => Math.max(h.tl || 0, h.te || 0);
  remote.forEach((r, id) => { const l = heat.get(id); if(!l || last(r) > last(l)) heat.set(id, r); });
}
// 設定のブックマークを全部読む（番号順につなげる）
async function readSettings(){
  const list = async coll => {
    const r = await api(`/raindrops/${coll}?perpage=50`);
    return (r.items || []).filter(x => typeof x.link === 'string' && x.link.startsWith(SET_LINK)).map(x => ({ id:x._id, n:Number((x.link.slice(SET_LINK.length).match(/^-(\d+)$/) || [])[1] || 1), note:x.note || '' }));
  };
  let parts = null;
  if(syncRef && syncRef.coll){ try{ parts = await list(syncRef.coll); }catch(e){ if(e.message !== 'http') throw e; } }
  if(!parts){
    const roots = await api('/collections');
    const c = (roots.items || []).find(x => x.title === SET_TITLE);
    if(!c){ syncRef = null; store.del('syncref'); return { parts:[], data:null }; }
    syncRef = { coll:c._id }; store.set('syncref', syncRef);
    parts = await list(c._id);
  }
  parts.sort((a, b) => a.n - b.n);
  let data = null;
  try{ const d = JSON.parse(parts.map(x => x.note).join('')); if(d && d.v === 1) data = d; }catch(e){}
  return { parts, data };
}
async function writeSettings(parts, text){
  let coll = syncRef && syncRef.coll;
  if(!coll){ const r = await api('/collection', { method:'POST', body:{ title:SET_TITLE } }); coll = r.item._id; syncRef = { coll }; store.set('syncref', syncRef); }
  const chunks = [];
  for(let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));
  const byN = new Map(parts.map(x => [x.n, x]));
  const top = Math.max(chunks.length, ...parts.map(x => x.n), 1);
  for(let n = 1; n <= top; n++){
    const note = chunks[n - 1] || '';
    const cur = byN.get(n);
    if(cur){ if(cur.note !== note) await api(`/raindrop/${cur.id}`, { method:'PUT', body:{ note } }); }
    else if(note){
      await api('/raindrop', { method:'POST', body:{ link:n === 1 ? SET_LINK : `${SET_LINK}-${n}`, title:`Raindrop シャッフルの設定${n === 1 ? '' : ' ' + n}（消さないでください）`, note, collection:{ $id:coll } } });
    }
  }
}
function pullSettings(){
  if(!state.token) return Promise.resolve();
  if(syncing){ syncAgain = true; return syncing; }
  clearTimeout(syncTimer);
  lastPull = Date.now();
  syncing = (async () => {
    const { parts, data } = await readSettings();
    if(data && (data.mapAt || 0) > mapKnownAt){ mapKnownAt = data.mapAt; store.set('mapat', mapKnownAt); updateMapState(); }
    if(data){
      if(!syncAt){ mergeFirst(data); syncAt = Date.now(); store.set('syncat', syncAt); store.set('presets', presets); store.set('pins', pins); syncFilter(); }
      else if((data.at || 0) > syncAt) applyRemote(data);
      mergeHeat(heatUnpack(data.heat));
      store.set('heat', heatPacked());
    }else if(!presets.length && !pins.length && !heat.size && !mapKnownAt){
      return;   // どちらにも何もない：フォルダも作らない
    }else if(!syncAt){ syncAt = Date.now(); store.set('syncat', syncAt); }
    const text = JSON.stringify({ v:1, at:syncAt, presets, pins, heat:heatPacked(), ...(mapKnownAt ? { mapAt:mapKnownAt } : {}) });
    if(text !== parts.map(x => x.note).join('')) await writeSettings(parts, text);
  })().catch(() => {}).finally(() => {
    syncing = null;
    if(syncAgain){ syncAgain = false; scheduleSync(1000); }
  });
  return syncing;
}
