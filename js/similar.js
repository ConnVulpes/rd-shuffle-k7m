/* 似た画像：印象の地図（IndexedDB の idbDo・画像の AI・縮める・Raindrop との同期・タグで曲げる・地図を更新）、
   似たものを並べる（showSimilar）、範囲で探す（openCrop cropSearch）。最後に updateMapState() を1回 */
// ===== 似ているもの（印象の地図） =====
// 本人が試しページで選んだ組み合わせ：DINOv2 small・全体＋何か所か・あなたのタグで曲げた地図（強さ「中」）。
// 地図は Mac で作り、64個の数字に縮めて Raindrop の「rd-shuffle 地図」フォルダに置く。iPhone はそれを読むだけ。
// 押されるまでは何も読み込まない（起動の軽さは変えない）
const MAP_TITLE = 'rd-shuffle 地図';
const MAP_LINK = 'https://connvulpes.github.io/rd-shuffle-k7m/#map';
const MAP_MODEL = 'onnx-community/dinov2-small';
const MAP_LAB_PREFIX = MAP_MODEL + '#mc:';   // 試しページで作った地図と同じ保存名（作ってあった分はそのまま使う）
const MAP_DIMS = 64, BEND_W = 0.5;
const TJS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
let mapKnownAt = store.get('mapat', 0);       // いちばん新しい地図の時刻（同期で知る）
let mapRef = store.get('mapref', null);       // { coll:フォルダID }
var simMap = null, simFit = null, sim = null, simBusy = false; // 読み込んだ地図・曲げた地図・今並べている「似ているもの」（起動中に先に触られるので var）

// ---- 保存（ブラウザの中のデータベース）----
const idbs = {};
function idbOpen(name, st){
  return idbs[name] || (idbs[name] = new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { if(!r.result.objectStoreNames.contains(st)) r.result.createObjectStore(st); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
async function idbDo(name, st, mode, fn){
  const db = await idbOpen(name, st);
  return new Promise((res, rej) => { const t = db.transaction(st, mode); const q = fn(t.objectStore(st)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
}
const mapLocalGet = () => idbDo('rdmap', 'kv', 'readonly', s => s.get('map')).catch(() => null);
const mapLocalSet = rec => idbDo('rdmap', 'kv', 'readwrite', s => s.put(rec, 'map')).catch(() => null);
// 試しページの地図（画像1枚ずつの元の数字。Mac にだけある）
async function labVectors(){
  const out = new Map();
  try{
    const db = await idbOpen('rdlab', 'emb');
    await new Promise((res, rej) => {
      const q = db.transaction('emb').objectStore('emb').openCursor(IDBKeyRange.bound(MAP_LAB_PREFIX, MAP_LAB_PREFIX + '￿'));
      q.onsuccess = () => { const c = q.result; if(!c) return res(); out.set(c.key.slice(MAP_LAB_PREFIX.length), c.value); c.continue(); };
      q.onerror = () => rej(q.error);
    });
  }catch(e){}
  return out;
}
const labSet = (c, v) => idbDo('rdlab', 'emb', 'readwrite', s => s.put(v, MAP_LAB_PREFIX + c)).catch(() => null);
const labGet = c => idbDo('rdlab', 'emb', 'readonly', s => s.get(MAP_LAB_PREFIX + c)).catch(() => null);
function setMapInfo(rec){ store.set('mapinfo', rec ? { n:rec.n, at:rec.at } : null); updateMapState(); }

// ---- 画像の AI（地図を作るときと、地図にない画像を足すときだけ。テストでは window.RD_FAKE_EMBED）----
let tjs = null, dino = null, dinoBusy = Promise.resolve();
async function loadDino(st){
  if(dino || window.RD_FAKE_EMBED) return;
  st('画像の AI を読み込んでいます…');
  tjs = tjs || await import(TJS_URL);
  const files = new Map();
  const progress_callback = e => {
    if(e.status !== 'progress' || !e.total) return;
    files.set(e.file, [e.loaded, e.total]); let a = 0, b = 0; files.forEach(([x, y]) => { a += x; b += y; });
    st(`画像の AI を読み込んでいます… ${(a / 1048576).toFixed(1)} / ${(b / 1048576).toFixed(1)}MB`);
  };
  const processor = await tjs.AutoProcessor.from_pretrained(MAP_MODEL);
  let model = null;
  if('gpu' in navigator){ try{ model = await tjs.AutoModel.from_pretrained(MAP_MODEL, { device:'webgpu', dtype:'fp16', progress_callback }); }catch(e){} }
  if(!model) model = await tjs.AutoModel.from_pretrained(MAP_MODEL, { device:'wasm', dtype:'q8', progress_callback });
  dino = { model, processor };
}
const unitV = v => { let s = 0; for(let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; for(let i = 0; i < v.length; i++) v[i] /= s; return v; };
async function fetchBlob(url){
  const r = await fetch(url, { mode:'cors', credentials:'omit', referrerPolicy:'no-referrer' });
  if(!r.ok) throw new Error('http');
  return r.blob();
}
// X と Pinterest は元のサイトから小さいサイズを直接、それ以外は縮小サービス経由（だめなら元の画像）
function directSmall(u){
  try{
    const x = new URL(u);
    if(x.hostname === 'pbs.twimg.com'){ x.searchParams.set('name', 'small'); return x.href; }
    if(x.hostname === 'i.pinimg.com'){ x.pathname = x.pathname.replace(/^\/(originals|\d+x\d*)\//, '/236x/'); return x.href; }
  }catch(e){}
  return '';
}
const directOK = new Map();
async function coverBlob(u){
  const d = directSmall(u), host = d && new URL(d).hostname;
  if(d && directOK.get(host) !== false){
    try{ const b = await fetchBlob(d); directOK.set(host, true); return b; }
    catch(e){ if(!directOK.get(host)) directOK.set(host, false); }
  }
  try{ return await fetchBlob(`https://wsrv.nl/?url=${encodeURIComponent(u)}&w=256&h=256&fit=inside&output=jpg&q=80`); }
  catch(e){ return fetchBlob(u); }
}
// 全体（余白付き）＋細長いなら長い向きに3か所、そうでなければ真ん中。AI の結果を平均する
// src を渡したとき（範囲で探す：切り抜いた部分のキャンバス）は、画像を取らずにそれを使う
async function embedCover(c, src){
  if(window.RD_FAKE_EMBED) return window.RD_FAKE_EMBED(c, src);
  const bmp = src || await createImageBitmap(await coverBlob(c));
  const W = bmp.width, H = bmp.height, S = 256;
  const mk = (sx, sy, sw, sh, pad) => {
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S; const g = cv.getContext('2d');
    if(pad){ g.fillStyle = '#808080'; g.fillRect(0, 0, S, S); const r = Math.min(S / W, S / H); g.drawImage(bmp, 0, 0, W, H, (S - W * r) / 2, (S - H * r) / 2, W * r, H * r); }
    else g.drawImage(bmp, sx, sy, sw, sh, 0, 0, S, S);
    return tjs.RawImage.fromCanvas(cv);
  };
  const m = Math.min(W, H), views = [mk(0, 0, W, H, true)];
  if(Math.max(W, H) / m > 1.25) [0, 0.5, 1].forEach(f => { const off = (Math.max(W, H) - m) * f; views.push(W > H ? mk(off, 0, m, m) : mk(0, off, m, m)); });
  else views.push(mk((W - m) / 2, (H - m) / 2, m, m));
  if(!src && bmp.close) bmp.close();
  const run = dinoBusy.then(async () => {
    let acc = null;
    for(const img of views){
      const out = await dino.model(await dino.processor(img));
      let t = out.pooler_output || out.last_hidden_state;
      if(t.type && t.type !== 'float32' && t.to) t = t.to('float32');
      const d = t.dims[t.dims.length - 1], v = unitV(Float32Array.from(t.data.subarray(0, d)));
      if(!acc) acc = new Float32Array(d);
      for(let i = 0; i < d; i++) acc[i] += v[i];
    }
    return unitV(acc);
  });
  dinoBusy = run.catch(() => {});
  return run;
}

// ---- 地図を縮める（384個 → 64個の数字。主成分分析）----
function pca(X, d, k){
  const n = X.length, mean = new Float64Array(d);
  X.forEach(x => { for(let i = 0; i < d; i++) mean[i] += x[i]; }); for(let i = 0; i < d; i++) mean[i] /= n;
  const C = new Float64Array(d * d), y = new Float64Array(d);
  X.forEach(x => {
    for(let i = 0; i < d; i++) y[i] = x[i] - mean[i];
    for(let i = 0; i < d; i++){ const yi = y[i], o = i * d; for(let j = i; j < d; j++) C[o + j] += yi * y[j]; }
  });
  for(let i = 0; i < d; i++) for(let j = 0; j < i; j++) C[i * d + j] = C[j * d + i];
  // 上位 k 方向を、くり返し掛けて直交させる方法で求める（方向の組さえ合っていれば近さは変わらない）
  let Q = new Float64Array(d * k);
  let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  for(let i = 0; i < d * k; i++) Q[i] = rnd();
  const Z = new Float64Array(d * k);
  for(let it = 0; it < 40; it++){
    Z.fill(0);
    for(let i = 0; i < d; i++){ const o = i * d; for(let j = 0; j < d; j++){ const c = C[o + j]; if(!c) continue; const qo = j * k, zo = i * k; for(let t = 0; t < k; t++) Z[zo + t] += c * Q[qo + t]; } }
    for(let t = 0; t < k; t++){
      for(let s = 0; s < t; s++){ let dot = 0; for(let i = 0; i < d; i++) dot += Z[i * k + t] * Z[i * k + s]; for(let i = 0; i < d; i++) Z[i * k + t] -= dot * Z[i * k + s]; }
      let nn = 0; for(let i = 0; i < d; i++) nn += Z[i * k + t] ** 2; nn = Math.sqrt(nn) || 1; for(let i = 0; i < d; i++) Z[i * k + t] /= nn;
    }
    Q.set(Z);
  }
  return { mean:Float32Array.from(mean), basis:Float32Array.from(Q) };
}
function project(x, P, d, k){
  const y = new Float32Array(k);
  for(let i = 0; i < d; i++){ const xi = x[i] - P.mean[i], o = i * k; for(let t = 0; t < k; t++) y[t] += xi * P.basis[o + t]; }
  return y;
}
function decodeMap(rec){
  const { n, dims } = rec, V = new Float32Array(n * dims), pos = new Map();
  for(let r = 0; r < n; r++){
    let s = 0; const o = r * dims;
    for(let j = 0; j < dims; j++){ const v = rec.q[o + j] * rec.scale[j]; V[o + j] = v; s += v * v; }
    s = Math.sqrt(s) || 1; for(let j = 0; j < dims; j++) V[o + j] /= s;
    pos.set(rec.ids[r], r);
  }
  return { at:rec.at, n, dims, ids:rec.ids, V, pos };
}

// ---- Raindrop に置く・読む（1件1万文字までなので分ける）----
// 1番目に説明、2番目から縮め方（Mac で作り直したときに決まる。どの端末でも新着を足せるように）、そのあとに中身（1件 99 枚分）。
// 縮め方の件数は決まっているので、新着を足しても書き換わるのは最後の中身と説明だけ
const b64of = u8 => { let s = ''; for(let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const u8of = b64 => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
const MAP_PART = 6750;   // 1件に入れるバイト数（文字にすると9,000字）
// 縮め方（平均と方向）を 2 バイトずつに。どれも -1〜1 の範囲に収まる
function encodeRecipe(mean, basis){
  const all = new Float32Array(mean.length + basis.length); all.set(mean); all.set(basis, mean.length);
  const u = new Uint8Array(all.length * 2), dv = new DataView(u.buffer);
  for(let i = 0; i < all.length; i++) dv.setInt16(i * 2, Math.max(-32767, Math.min(32767, Math.round(all[i] * 32767))), true);
  return u;
}
function decodeRecipe(u, d, k){
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), all = new Float32Array(d + d * k);
  for(let i = 0; i < all.length; i++) all[i] = dv.getInt16(i * 2, true) / 32767;
  return { mean:all.slice(0, d), basis:all.slice(d) };
}
async function mapColl(create){
  if(mapRef && mapRef.coll) return mapRef.coll;
  const roots = await api('/collections');
  const c = (roots.items || []).find(x => x.title === MAP_TITLE);
  if(c){ mapRef = { coll:c._id }; store.set('mapref', mapRef); return c._id; }
  if(!create) return null;
  const r = await api('/collection', { method:'POST', body:{ title:MAP_TITLE } });
  mapRef = { coll:r.item._id }; store.set('mapref', mapRef);
  return r.item._id;
}
async function mapParts(coll){
  const out = [];
  for(let page = 0; page < 20; page++){
    const r = await api(`/raindrops/${coll}?perpage=50&page=${page}`);
    const its = r.items || [];
    its.forEach(x => {
      if(typeof x.link !== 'string' || !x.link.startsWith(MAP_LINK)) return;
      const rest = x.link.slice(MAP_LINK.length), m = rest.match(/^-(\d+)$/);
      if(rest && !m) return;
      out.push({ id:x._id, n:m ? Number(m[1]) : 1, note:x.note || '' });
    });
    if(its.length < 50) break;
  }
  return out.sort((a, b) => a.n - b.n);
}
async function readRemoteMap(){
  const coll = await mapColl(false);
  if(!coll) return null;
  let parts;
  try{ parts = await mapParts(coll); }catch(e){ if(e.message === 'http'){ mapRef = null; store.del('mapref'); } throw e; }
  const head = parts.find(p => p.n === 1); if(!head) return null;
  let h; try{ h = JSON.parse(head.note); }catch(e){ return null; }
  if(!h || (h.v !== 1 && h.v !== 2)) return null;
  const rparts = h.rparts || 0;
  const join = (from, count) => { const us = []; for(let k = from; k < from + count; k++){ const p = parts.find(x => x.n === k); if(!p) return null; us.push(u8of(p.note)); } const u = new Uint8Array(us.reduce((a, x) => a + x.length, 0)); let o = 0; us.forEach(x => { u.set(x, o); o += x.length; }); return u; };
  const buf = join(2 + rparts, h.parts);
  const row = 4 + h.dims;
  if(!buf || buf.length !== h.n * row) return null;
  const dv = new DataView(buf.buffer), ids = new Array(h.n), q = new Int8Array(h.n * h.dims);
  for(let r = 0; r < h.n; r++){ ids[r] = dv.getUint32(r * row, true); for(let j = 0; j < h.dims; j++) q[r * h.dims + j] = dv.getInt8(r * row + 4 + j); }
  const rec = { v:1, at:h.at, rb:h.rb || 0, baseN:h.baseN || 0, n:h.n, dims:h.dims, ids, q, scale:Float32Array.from(h.scale) };
  if(rparts && h.src){ const u = join(2, rparts); if(u){ Object.assign(rec, decodeRecipe(u, h.src, h.dims)); } }
  return rec;
}
async function writeRemoteMap(rec, st){
  const coll = await mapColl(true);
  const parts = await mapParts(coll);
  const row = 4 + rec.dims, perPart = Math.floor(MAP_PART / row);
  const rnotes = [];
  if(rec.basis){ const u = encodeRecipe(rec.mean, rec.basis); for(let o = 0; o < u.length; o += MAP_PART) rnotes.push(b64of(u.subarray(o, o + MAP_PART))); }
  const notes = [];
  for(let r0 = 0; r0 < rec.n; r0 += perPart){
    const r1 = Math.min(rec.n, r0 + perPart), u = new Uint8Array((r1 - r0) * row), dv = new DataView(u.buffer);
    for(let r = r0; r < r1; r++){ const o = (r - r0) * row; dv.setUint32(o, rec.ids[r], true); for(let j = 0; j < rec.dims; j++) dv.setInt8(o + 4 + j, rec.q[r * rec.dims + j]); }
    notes.push(b64of(u));
  }
  const head = JSON.stringify({ v:2, at:rec.at, rb:rbOf(rec), baseN:rec.baseN || 0, n:rec.n, dims:rec.dims, src:rec.mean ? rec.mean.length : 0, rparts:rnotes.length, parts:notes.length, scale:[...rec.scale].map(x => +x.toPrecision(6)), model:'dinov2-small#mc' });
  const all = [head, ...rnotes, ...notes];
  const byN = new Map(parts.map(x => [x.n, x]));
  const top = Math.max(all.length, ...parts.map(x => x.n), 1);
  let writes = 0;
  for(let n = 1; n <= top; n++){
    st(`Raindrop に保存しています… ${n} / ${top}`);
    const note = all[n - 1] || '';
    const cur = byN.get(n);
    if(cur){ if(cur.note !== note) await api(`/raindrop/${cur.id}`, { method:'PUT', body:{ note } }); else continue; }
    else if(note) await api('/raindrop', { method:'POST', body:{ link:n === 1 ? MAP_LINK : `${MAP_LINK}-${n}`, title:`Raindrop シャッフルの似ているものの地図${n === 1 ? '' : ' ' + n}（消さないでください）`, note, collection:{ $id:coll } } });
    else continue;
    writes++;
    await sleep(300);   // 書き込みの上限に当たらないように、少し間をあける
  }
  return writes;
}

// ---- 手元の地図と Raindrop の地図を合わせる ----
// 縮め方（rb = 作り直した時刻）が同じなら、行（ブックマークごと）を合わせる：Raindrop の並びを基本に、
// 手元で足した・置き直した行（dirty）は手元のものを使い、手元にしかない行は後ろに足す。
// 縮め方が違えば、新しく作り直した方を取る（古い縮め方で足した行は、元の数字が残っていれば足し直す）
const rbOf = rec => rec ? (rec.rb || (rec.basis ? 1 : 0)) : -1;
function mergeMaps(local, remote){
  if(!remote) return local;
  if(!local) return remote;
  if(rbOf(remote) !== rbOf(local)) return rbOf(remote) > rbOf(local) ? { ...remote, dirty:[] } : local;
  const d = remote.dims, dirty = new Set(local.dirty || []);
  const lpos = new Map(local.ids.map((id, r) => [id, r]));
  const cvOf = new Map((local.cv || []).map((c, r) => [local.ids[r], c]));
  const ids = remote.ids.slice(), seen = new Set(ids);
  local.ids.forEach(id => { if(!seen.has(id)){ ids.push(id); seen.add(id); } });
  const rpos = new Map(remote.ids.map((id, r) => [id, r]));
  const q = new Int8Array(ids.length * d);
  ids.forEach((id, r) => {
    const fromLocal = dirty.has(id) || !rpos.has(id);
    q.set(fromLocal ? local.q.subarray(lpos.get(id) * d, lpos.get(id) * d + d) : remote.q.subarray(rpos.get(id) * d, rpos.get(id) * d + d), r * d);
  });
  return { ...remote, mean:local.mean || remote.mean, basis:local.basis || remote.basis, at:Math.max(local.at, remote.at), n:ids.length, ids, q, cv:ids.map(id => cvOf.get(id) || null), dirty:[...dirty] };
}
// Raindrop に足りない分があるか（手元で足した行がある、または手元にしかない行がある）
const needsUpload = (rec, remote) => !!rec && (!remote || (rec.dirty || []).length > 0 || rbOf(rec) !== rbOf(remote) || rec.n !== remote.n);
// 地図にまだないが、元の数字が手元にある画像を、縮め方を使って足す（AI は使わない）
async function fillFromLab(rec){
  if(!rec || !rec.basis || !cache) return rec;
  const have = new Set(rec.ids);
  const todo = cache.items.filter(it => it.c && !have.has(it.i));
  if(!todo.length) return rec;
  const add = [];
  for(const it of todo){ const v = await labGet(it.c); if(v) add.push([it, v]); }
  if(!add.length) return rec;
  const d = rec.dims, q = new Int8Array((rec.n + add.length) * d); q.set(rec.q);
  const ids = rec.ids.slice(), cv = (rec.cv || rec.ids.map(() => null)).slice(), dirty = new Set(rec.dirty || []);
  add.forEach(([it, v]) => { q.set(quantRow(project(v, rec, v.length, d), rec.scale, d), ids.length * d); ids.push(it.i); cv.push(it.c); dirty.add(it.i); });
  return { ...rec, n:ids.length, ids, cv, q, dirty:[...dirty] };
}
const quantRow = (y, scale, dims) => { const r = new Int8Array(dims); for(let j = 0; j < dims; j++) r[j] = Math.max(-127, Math.min(127, Math.round(y[j] / scale[j]))); return r; };
function useMap(rec){
  simMap = decodeMap(rec); simMap.rec = rec; simFit = null;
  setMapInfo(rec);
}
// Raindrop と合わせて、足りない分を書き込む（手元で足したあと、少し待ってから自動で）
let mapSyncing = null, mapUpTimer = 0;
function scheduleMapUpload(ms = 5000){ clearTimeout(mapUpTimer); mapUpTimer = setTimeout(() => syncMap().catch(() => {}), ms); }
function syncMap(st = () => {}){
  if(mapSyncing) return mapSyncing;
  mapSyncing = (async () => {
    const remote = await readRemoteMap();
    let rec = mergeMaps(await mapLocalGet(), remote);
    rec = await fillFromLab(rec);
    if(!rec) return 0;
    let writes = 0;
    if(needsUpload(rec, remote)){
      rec = { ...rec, at:Date.now() };
      writes = await writeRemoteMap(rec, st);
      rec = { ...rec, dirty:[] };
    }
    await mapLocalSet(rec);
    if(rec.at > mapKnownAt){ mapKnownAt = rec.at; store.set('mapat', mapKnownAt); }
    useMap(rec);
    if(writes) pullSettings();   // ほかの端末に「新しい地図がある」と知らせる
    return writes;
  })().finally(() => { mapSyncing = null; });
  return mapSyncing;
}

// ---- 地図を用意する（手元 → なければ／古ければ Raindrop から合わせる）----
async function ensureMap(st){
  if(simMap && simMap.at >= mapKnownAt && mapKnownAt) return simMap;
  let rec = await mapLocalGet();
  if(!rec || rec.at < mapKnownAt || !mapKnownAt){
    st('似た画像の準備をしています…');
    const remote = await readRemoteMap().catch(() => null);
    const merged = await fillFromLab(mergeMaps(rec, remote));
    if(merged !== rec){ rec = merged; await mapLocalSet(rec); }
    if(rec && rec.basis && needsUpload(rec, remote)) scheduleMapUpload(3000);
  }
  if(!rec) return null;
  if(rec.at > mapKnownAt){ mapKnownAt = rec.at; store.set('mapat', mapKnownAt); }
  useMap(rec);
  return simMap;
}

// ---- あなたのタグで地図を曲げる ----
// 画像の位置から「あなたならどのタグを付けるか」を予測する式をタグ付きのもので作り（リッジ回帰）、
// 予測したタグの並びを位置の後ろに足す。よく当たるタグほど重く、ほとんど当たらないタグ（見た目と関係ないもの）は使わない。
// タグ付きのものは全部付いている前提なので、付いていないタグは「違う」として数える。タグなしのものは見本にしない
const simHash = s => { s = String(s); let h = 2166136261; for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function ridgeGram(rows, d1, T, X){
  const A = new Float64Array(d1 * d1), B = new Float64Array(d1 * T), xr = new Float64Array(d1);
  for(const r of rows){
    const o0 = r.row * (d1 - 1);
    for(let i = 0; i < d1 - 1; i++) xr[i] = X[o0 + i]; xr[d1 - 1] = 1;
    for(let i = 0; i < d1; i++){ const xi = xr[i], o = i * d1; for(let j = i; j < d1; j++) A[o + j] += xi * xr[j]; const bo = i * T; for(const t of r.y) B[bo + t] += xi; }
  }
  return { A, B };
}
function ridgeSolve(A0, B, d1, T, lambda){
  const A = Float64Array.from(A0);
  for(let i = 0; i < d1; i++) for(let j = 0; j < i; j++) A[i * d1 + j] = A[j * d1 + i];
  for(let i = 0; i < d1 - 1; i++) A[i * d1 + i] += lambda;
  A[d1 * d1 - 1] += 1e-6;
  for(let j = 0; j < d1; j++){
    let s = A[j * d1 + j]; for(let k = 0; k < j; k++) s -= A[j * d1 + k] ** 2;
    const L = Math.sqrt(Math.max(s, 1e-12)); A[j * d1 + j] = L;
    for(let i = j + 1; i < d1; i++){ let t = A[i * d1 + j]; for(let k = 0; k < j; k++) t -= A[i * d1 + k] * A[j * d1 + k]; A[i * d1 + j] = t / L; }
  }
  const W = new Float64Array(d1 * T), y = new Float64Array(d1);
  for(let t = 0; t < T; t++){
    for(let i = 0; i < d1; i++){ let s = B[i * T + t]; for(let k = 0; k < i; k++) s -= A[i * d1 + k] * y[k]; y[i] = s / A[i * d1 + i]; }
    for(let i = d1 - 1; i >= 0; i--){ let s = y[i]; for(let k = i + 1; k < d1; k++) s -= A[k * d1 + i] * W[k * T + t]; W[i * T + t] = s / A[i * d1 + i]; }
  }
  return W;
}
function ridgePredict(X, row, W, d1, T){
  const z = new Float64Array(T), o0 = row * (d1 - 1);
  for(let i = 0; i < d1; i++){ const xi = i < d1 - 1 ? X[o0 + i] : 1; if(!xi) continue; const o = i * T; for(let t = 0; t < T; t++) z[t] += xi * W[o + t]; }
  return z;
}
function corrOf(a, b){
  const n = a.length; let ma = 0, mb = 0; for(let i = 0; i < n; i++){ ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for(let i = 0; i < n; i++){ const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}
function bentMap(){
  if(simFit && simFit.map === simMap) return simFit;
  const m = simMap, d = m.dims, d1 = d + 1;
  if(!sugIndex || sugIndex.items !== cache.items || sugIndex.len !== cache.items.length) buildSugIndex();
  const byId = new Map(cache.items.map(it => [it.i, it]));
  const tagsOf = r => { const it = byId.get(m.ids[r]); return it ? (it.g || []).filter(t => !sugIndex.authorTags.has(t)) : []; };
  const cnt = new Map(); const tagged = [];
  for(let r = 0; r < m.n; r++){ const g = tagsOf(r); if(!g.length) continue; tagged.push(r); g.forEach(t => cnt.set(t, (cnt.get(t) || 0) + 1)); }
  const tags = [...cnt].filter(([, n]) => n >= 5).map(([t]) => t), T = tags.length, ti = new Map(tags.map((t, i) => [t, i]));
  let F = m.V, D = d, used = 0;
  if(T && tagged.length >= 30){
    const rows = tagged.map(r => ({ row:r, y:tagsOf(r).filter(t => ti.has(t)).map(t => ti.get(t)) }));
    const hold = rows.filter(r => simHash(m.ids[r.row]) % 5 === 1), rest = rows.filter(r => simHash(m.ids[r.row]) % 5 !== 1);
    const gh = ridgeGram(hold, d1, T, m.V), gr = ridgeGram(rest, d1, T, m.V);
    let best = null;
    for(const lambda of [0.5, 2, 8]){
      const W = ridgeSolve(gr.A, gr.B, d1, T, lambda);
      const P = hold.map(r => ridgePredict(m.V, r.row, W, d1, T));
      const cs = tags.map((t, k) => corrOf(P.map(z => z[k]), hold.map(r => r.y.includes(k) ? 1 : 0)));
      const mean = cs.reduce((a, b) => a + b, 0) / T;
      if(!best || mean > best.mean) best = { lambda, cs, mean };
    }
    const q = best.cs.map(c => Math.max(0, c - 0.1));
    used = q.filter(x => x > 0).length;
    if(used){
      const W = ridgeSolve(gr.A.map((v, i) => v + gh.A[i]), gr.B.map((v, i) => v + gh.B[i]), d1, T, best.lambda);
      const Z = []; for(let r = 0; r < m.n; r++) Z.push(ridgePredict(m.V, r, W, d1, T));
      const mu = new Float64Array(T), sd = new Float64Array(T);
      Z.forEach(z => { for(let t = 0; t < T; t++) mu[t] += z[t]; }); for(let t = 0; t < T; t++) mu[t] /= m.n;
      Z.forEach(z => { for(let t = 0; t < T; t++) sd[t] += (z[t] - mu[t]) ** 2; }); for(let t = 0; t < T; t++) sd[t] = Math.sqrt(sd[t] / m.n) || 1;
      D = d + T; F = new Float32Array(m.n * D);
      const z = new Float32Array(T);
      for(let r = 0; r < m.n; r++){
        for(let t = 0; t < T; t++) z[t] = (Z[r][t] - mu[t]) / sd[t] * q[t];
        unitV(z);
        const o = r * D; let s = 0;
        for(let j = 0; j < d; j++){ const v = (1 - BEND_W) * m.V[r * d + j]; F[o + j] = v; s += v * v; }
        for(let t = 0; t < T; t++){ const v = BEND_W * z[t]; F[o + d + t] = v; s += v * v; }
        s = Math.sqrt(s) || 1; for(let j = 0; j < D; j++) F[o + j] /= s;
      }
    }
  }
  simFit = { map:m, F, D, used };
  return simFit;
}
// 地図にある全部を、似ている順に（押した画像は除く。近さが同じなら地図の順）
function nearestSim(it){
  const m = simMap, r0 = m.pos.get(it.i); if(r0 == null) return null;
  const { F, D } = bentMap(), o0 = r0 * D, n = m.n;
  const sc = new Float64Array(n), idx = new Uint32Array(n - 1);
  for(let r = 0, k = 0; r < n; r++){
    if(r === r0) continue;
    let s = 0; const o = r * D; for(let j = 0; j < D; j++) s += F[o0 + j] * F[o + j];
    sc[r] = s; idx[k++] = r;
  }
  idx.sort((a, b) => sc[b] - sc[a] || a - b);
  const byId = new Map(cache.items.map(x => [x.i, x])), out = [];
  for(const r of idx){ const x = byId.get(m.ids[r]); if(x) out.push(x); }
  return out;
}

// ---- 地図にない画像を足す（縮め方が手元にあれば、どの端末でも。足したら少し待って Raindrop にも書く）----
async function addToMap(it, st){
  let rec = simMap && simMap.rec;
  if(!rec || !rec.basis || !it.c) return false;
  let v = await labGet(it.c);
  if(!v){ await loadDino(st); st('この画像を調べています…'); v = await embedCover(it.c); await labSet(it.c, v); }
  rec = await mapLocalGet() || rec;   // 合わせたあとの最新を使う
  const d = rec.dims, q = new Int8Array((rec.n + 1) * d); q.set(rec.q);
  q.set(quantRow(project(v, rec, v.length, d), rec.scale, d), rec.n * d);
  const next = { ...rec, n:rec.n + 1, ids:[...rec.ids, it.i], cv:[...(rec.cv || rec.ids.map(() => null)), it.c], q, dirty:[...new Set([...(rec.dirty || []), it.i])] };
  await mapLocalSet(next);
  useMap(next);
  scheduleMapUpload();
  return true;
}

// ---- 地図を更新する（メニューの「地図を更新」）----
// まず Raindrop の地図と合わせる（ほかの端末で足した分も入る）。そのうえで、
// 普段は今の縮め方のまま新着（とサムネが変わったもの）を足すだけ。Raindrop も変わった分だけ書き換える。
// 前回作り直したときから2割を超えて増えたら、縮め方から作り直す。作り直しには全部の画像の元の数字が要るので、
// それを持っている端末（Mac の Chrome）だけ。持っていない端末（iPhone）は足すだけを続ける
const MAP_REBUILD_GROW = 1.2;
let mapBuilding = false, mapStopReq = false, mapWarned = false;
// AI に通していない画像を通す（6枚ずつ同時に取ってくる）。止めたら false
async function embedMissing(list, lab, st){
  if(!list.length) return true;
  await loadDino(st);
  let next = 0, done = 0, fail = 0; const t0 = performance.now();
  const worker = async () => {
    while(!mapStopReq && next < list.length){
      const c = list[next++];
      try{ const v = await embedCover(c); lab.set(c, v); await labSet(c, v); done++; }catch(e){ fail++; }
      const n = done + fail, secs = (performance.now() - t0) / 1000, left = n > 5 ? secs / n * (list.length - n) : 0;
      st(`画像を調べています… ${n.toLocaleString()} / ${list.length.toLocaleString()}${left ? `（あと約 ${Math.ceil(left / 60)} 分）` : ''}`);
    }
  };
  await Promise.all(Array.from({ length:6 }, worker));
  return !mapStopReq;
}
async function rebuildMap(){
  const btn = $('mapUpd'), stEl = $('mapState');
  if(mapBuilding){ mapStopReq = true; return; }
  const st = t => { stEl.textContent = t; };
  const withCover = cache.items.filter(it => it.c);
  const covers = [...new Set(withCover.map(it => it.c))];
  mapBuilding = true; mapStopReq = false;
  let lock = null;
  try{
    st('Raindrop のデータと合わせています…');
    let remote = null; try{ remote = await readRemoteMap(); }catch(e){ if(e.message === 'auth') throw e; }
    let local = mergeMaps(await mapLocalGet(), remote);
    const lab = await labVectors();
    // この端末が元の数字を持っているか（今の地図に入っている画像の8割以上。新着は数えない）
    const coverOf = new Map(withCover.map(it => [it.i, it.c]));
    const inMap = local ? local.ids.map(id => coverOf.get(id)).filter(Boolean) : covers;
    const hasOriginals = inMap.length > 0 && inMap.filter(c => lab.has(c)).length >= inMap.length * 0.8;
    const rowOf = local && local.basis ? new Map(local.ids.map((id, r) => [id, r])) : null;
    const added = rowOf ? withCover.filter(it => !rowOf.has(it.i)) : [];
    const changed = rowOf && local.cv ? withCover.filter(it => rowOf.has(it.i) && local.cv[rowOf.get(it.i)] && local.cv[rowOf.get(it.i)] !== it.c) : [];
    const grown = rowOf && local.baseN && local.n + added.length > local.baseN * MAP_REBUILD_GROW;
    const incremental = !!rowOf && !(grown && hasOriginals);
    const need = incremental ? [...new Set([...added, ...changed].map(it => it.c))].filter(c => !lab.has(c)) : covers.filter(c => !lab.has(c));
    // 画像をたくさん読み直す必要があるとき（地図を作っていない端末で、初めて作るとき）は、一度だけ確かめる
    if(need.length > 300 && !mapWarned){
      mapWarned = true;
      st(`画像を ${need.length.toLocaleString()} 枚、AI に通す必要があります（Mac の Chrome だと速いです）。もう一度押すと始めます。`);
      btn.textContent = 'それでも始める';
      return;
    }
    btn.textContent = '止める';
    try{ lock = await navigator.wakeLock.request('screen'); }catch(e){}
    if(!await embedMissing(need, lab, st)){ st('止めました。置いた分は残っているので、次は続きからです。'); return; }
    let rec, done;
    if(incremental){
      // ---- 足すだけ ----
      const d = local.dims, ids = local.ids.slice(), cv = (local.cv || local.ids.map(() => null)).slice(), dirty = new Set(local.dirty || []);
      const q = new Int8Array((local.n + added.length) * d); q.set(local.q);
      let fixed = 0, appended = 0;
      changed.forEach(it => { const v = lab.get(it.c); if(!v) return; const r = rowOf.get(it.i); q.set(quantRow(project(v, local, v.length, d), local.scale, d), r * d); cv[r] = it.c; dirty.add(it.i); fixed++; });
      added.forEach(it => { const v = lab.get(it.c); if(!v) return; q.set(quantRow(project(v, local, v.length, d), local.scale, d), ids.length * d); ids.push(it.i); cv.push(it.c); dirty.add(it.i); appended++; });
      rec = { ...local, n:ids.length, ids, cv, q:q.slice(0, ids.length * d), dirty:[...dirty] };
      done = writes => {
        const head = !appended && !fixed ? '新着はありませんでした' : `新着 ${appended.toLocaleString()}枚を足しました${fixed ? `（サムネイルが変わった ${fixed}枚も入れ直しました）` : ''}`;
        const tail = grown && !hasOriginals ? '。Mac で更新すると、作り直して精度が上がります' : '';
        console.info(`似た画像：Raindrop の書き換え ${writes} 件`);
        return head + tail;
      };
    }else{
      // ---- 縮め方から全部作り直す ----
      st('まとめています…'); await sleep(30);
      const useC = covers.filter(c => lab.has(c));
      if(useC.length < 10) throw new Error('few');
      const X = useC.map(c => lab.get(c)), d = X[0].length;
      const P = pca(X, d, MAP_DIMS);
      const Y = new Map(useC.map((c, i) => [c, project(X[i], P, d, MAP_DIMS)]));
      const scale = new Float32Array(MAP_DIMS);
      Y.forEach(y => { for(let j = 0; j < MAP_DIMS; j++) scale[j] = Math.max(scale[j], Math.abs(y[j])); });
      for(let j = 0; j < MAP_DIMS; j++) scale[j] = (scale[j] || 1) / 127;
      const rowsIt = withCover.filter(it => Y.has(it.c));
      const q = new Int8Array(rowsIt.length * MAP_DIMS);
      rowsIt.forEach((it, r) => q.set(quantRow(Y.get(it.c), scale, MAP_DIMS), r * MAP_DIMS));
      const now = Date.now();
      rec = { v:1, at:now, rb:now, n:rowsIt.length, dims:MAP_DIMS, ids:rowsIt.map(it => it.i), cv:rowsIt.map(it => it.c), q, scale, mean:P.mean, basis:P.basis, baseN:rowsIt.length, dirty:[] };
      // 縮めても近さがどれくらい保たれているか（50枚それぞれの近い24枚が、縮める前とどれだけ同じか）
      const R = decodeMap(rec), step = Math.max(1, Math.floor(rowsIt.length / 50));
      const sample = rowsIt.filter(it => simHash(it.i) % step === 0).slice(0, 50);
      const top = score => { const out = []; for(let r = 0; r < R.n; r++){ const s = score(r); if(s === null) continue; if(out.length < 24 || s > out[out.length - 1][0]){ out.push([s, r]); out.sort((a, b) => b[0] - a[0]); if(out.length > 24) out.pop(); } } return new Set(out.map(x => x[1])); };
      let same = 0;
      sample.forEach(it => {
        const r0 = R.pos.get(it.i), a = lab.get(it.c);
        const full = top(r => { if(r === r0 || rowsIt[r].c === it.c) return null; const b = lab.get(rowsIt[r].c); let s = 0; for(let j = 0; j < d; j++) s += a[j] * b[j]; return s; });
        top(r => { if(r === r0 || rowsIt[r].c === it.c) return null; let s = 0; for(let j = 0; j < MAP_DIMS; j++) s += R.V[r0 * MAP_DIMS + j] * R.V[r * MAP_DIMS + j]; return s; }).forEach(r => { if(full.has(r)) same++; });
      });
      const keep = sample.length ? same / sample.length : 0;
      done = writes => { console.info(`似た画像：作り直し。近い24枚の一致 ${keep.toFixed(1)}、Raindrop の書き換え ${writes} 件`); return `作り直しました（${rec.n.toLocaleString()}枚）`; };
    }
    let writes = 0;
    if(needsUpload(rec, remote)){
      rec = { ...rec, at:Date.now() };
      writes = await writeRemoteMap(rec, st);
      rec = { ...rec, dirty:[] };
    }
    await mapLocalSet(rec);
    if(rec.at > mapKnownAt){ mapKnownAt = rec.at; store.set('mapat', mapKnownAt); }
    useMap(rec);
    if(writes) pullSettings();   // ほかの端末に「新しい地図がある」と知らせる
    st(done(writes));
  }catch(e){
    st(`更新できませんでした（${whyText(e)}）`);
  }finally{
    mapBuilding = false; mapWarned = btn.textContent === 'それでも始める' ? mapWarned : false;
    if(btn.textContent !== 'それでも始める') btn.textContent = '更新';
    try{ lock && lock.release(); }catch(e){}
  }
}
function updateMapState(){
  const el = $('mapState'); if(!el || mapBuilding) return;
  const info = store.get('mapinfo', null);
  const d = t => { const x = new Date(t); return `${x.getMonth() + 1}月${x.getDate()}日`; };
  if(info && info.at >= mapKnownAt) el.textContent = `${info.n.toLocaleString()}枚・${d(info.at)}に更新`;
  else if(mapKnownAt) el.textContent = 'ほかの端末で更新されています。似た画像を開くと読み込みます';
  else el.textContent = 'まだありません。Mac の Chrome で作れます';
}
$('mapUpd').addEventListener('click', () => { if(cache) rebuildMap(); });

// ---- 似ているものを並べる ----
async function showSimilar(it){
  if(!it || !cache || simBusy) return;
  simBusy = true;
  try{ await showSimilarNow(it); }finally{ simBusy = false; }
}
async function showSimilarNow(it){
  const st = t => showToast(t, null);
  let m;
  try{ m = await ensureMap(st); }catch(e){ m = null; }
  if(!m){ st('似た画像はまだ使えません。Mac の設定から準備できます'); return; }
  if(!m.pos.has(it.i)){
    let ok = false;
    try{ ok = await addToMap(it, st); }catch(e){ ok = false; }
    if(!ok){ st(it.c ? 'この画像はまだ調べていません。Mac の設定で更新すると入ります' : '画像がないので、似た画像は探せません'); return; }
  }
  const near = nearestSim(it) || [];
  edToast.hidden = true;
  // プレビューは閉じて、似た画像の一覧を見せる。そこからプレビューを開いて「似た画像」を押すと、さらに一段奥へ
  if(peek.open){ peekSilent = true; closePeek(); }
  enterView({ kind:'sim', sim:{ center:it, list:[it, ...near.filter(x => x !== it)] }, from:it });
}
// 一段奥の画面をすべて閉じる（戻る位置は覚えない。絞り込みや並び順を変えたとき）
function exitSimilar(){
  if(!views.length) return false;
  const i = layers.indexOf('deep'); if(i >= 0) popLayer('deep', i);
  views.length = 0; fwd = []; applyView();
  return true;
}
$('peekSim').addEventListener('click', () => showSimilar(peekItem));

// ---- 範囲で探す：画像の一部分を選んで、それに似た画像を並べる ----
// 似た画像の画面の左上の大きい画像の右下（切り抜きのアイコン）で開く。似た画像の画面の上に重ねる。
// なぞって四角を描き、四隅で直し、中をドラッグで動かす。外をなぞると描き直し。
// 選んだ部分を AI に通し、地図と同じ縮め方で 64 個にして、タグで曲げていない地図と比べる（切り抜いた部分にはタグがないので）
var cropOpen = false, cropRect = null, cropSrc = null, cropBusy = false;   // cropRect：画像の中の割合 {x,y,w,h}
const CROP_MIN = 12, CROP_HIT = 22;   // いちばん小さい四角（px）、四隅のつまみの押せる範囲（半径。44 の半分）
// 左上の画像で範囲を選べるか：画像がないもの・動画・YouTube では出さない
function heroCropOk(c){
  const it = c._item;
  if(c._crop) return !!(sim && sim.src);   // 範囲で探したあとの段：切り抜く前の元の画像を使う
  const im = c.querySelector('.card-link > img.thumb');
  return !!im && !!im.naturalWidth && !c.querySelector('.badge') && !ytId(it.l) && it.y !== 'video';
}
// 範囲を選ぶ画面に出す画像（左上の画像の元のブックマークの画像）
function heroCropSrc(c){
  if(c._crop) return sim && sim.src ? { ...sim.src } : null;
  const im = c.querySelector('.card-link > img.thumb');
  if(!im || !im.naturalWidth) return null;
  return { it:c._item, url:im.dataset.orig || im.currentSrc || im.src, show:im.currentSrc || im.src, w:im.naturalWidth, h:im.naturalHeight };
}
// ボタンは見えている画像の右下に（縦長の画像は左右に余白が出るので、画像の端に合わせる）
function placeHeroCrop(c){
  const b = c && c.querySelector(':scope > .hero-crop'); if(!b) return;
  const on = heroCropOk(c);
  b.hidden = !on;
  if(!on) return;
  const im = c.querySelector('.card-link > .thumb');
  const W = im.clientWidth, H = im.clientHeight, nw = im.naturalWidth || W, nh = im.naturalHeight || H;
  const k = Math.min(W / nw, H / nh), iw = nw * k, ih = nh * k;
  const right = im.offsetLeft + (W + iw) / 2, bottom = im.offsetTop + (H + ih) / 2;
  b.style.left = Math.round(right - b.offsetWidth - 8) + 'px';
  b.style.top = Math.round(bottom - b.offsetHeight - 8) + 'px';
}
function heroCropBtn(c){
  const b = el('button', 'hero-crop'); b.type = 'button'; b.hidden = true;
  b.title = '範囲で探す'; b.setAttribute('aria-label', '範囲で探す');
  b.innerHTML = icon('crop');
  // 押しても、左上の画像を押したとき（プレビュー）の動きにしない
  b.addEventListener('pointerdown', e => e.stopPropagation());
  b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); const src = heroCropSrc(c); if(src) openCrop(src); });
  return b;
}
function openCrop(src){
  if(cropOpen || !src || !sim) return;
  setMenu(false); setSortMenu(false); closePressMenu();
  cropSrc = { ...src, rot:0, flip:false };
  cropRect = null;
  const pic = $('cropPic');
  pic.querySelectorAll('img').forEach(x => x.remove());
  const im = new Image(); im.alt = ''; im.referrerPolicy = 'no-referrer'; im.draggable = false; im.src = cropSrc.show;
  im.className = 'crop-img';
  pic.prepend(im);
  $('crop').hidden = false;
  cropOpen = true;
  syncModal();
  pushLayer('crop');
  layoutCrop();
  paintCrop();
}
// 画像を、画面に収まる大きさで真ん中に（回転・反転のための計算は、前の作りのまま残している）
function layoutCrop(){
  if(!cropOpen) return;
  const st = $('cropStage'), pic = $('cropPic'), im = pic.querySelector('img');
  const side = Math.abs(cropSrc.rot / 90) % 2 === 1;
  const W = cropSrc.w, H = cropSrc.h, RW = side ? H : W, RH = side ? W : H;
  const cs = getComputedStyle(st);
  const aw = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ah = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const k = Math.max(0.01, Math.min(aw / RW, ah / RH));
  pic.style.width = Math.round(RW * k) + 'px'; pic.style.height = Math.round(RH * k) + 'px';
  Object.assign(im.style, { position:'absolute', left:'50%', top:'50%', width:W * k + 'px', height:H * k + 'px', maxWidth:'none',
    transform:`translate(-50%, -50%) scaleX(${cropSrc.flip ? -1 : 1}) rotate(${cropSrc.rot}deg)` });
}
addEventListener('resize', () => { if(cropOpen){ layoutCrop(); paintCrop(); } });
function paintCrop(){
  const pic = $('cropPic'), box = $('cropBox'), hole = $('cropHole'), shade = $('cropShade');
  const on = !!cropRect;
  box.hidden = !on; shade.hidden = !on;
  $('cropGo').disabled = !on || cropBusy;
  if(!on) return;
  const W = pic.clientWidth, H = pic.clientHeight;
  const st = { left:cropRect.x * W + 'px', top:cropRect.y * H + 'px', width:cropRect.w * W + 'px', height:cropRect.h * H + 'px' };
  Object.assign(box.style, st); Object.assign(hole.style, st);
}
// 指・マウスの操作：四隅の近く → その角を動かす／四角の中 → 動かす／それ以外 → 新しく描く（少し動いてから）
let cropDrag = null;
$('cropStage').addEventListener('pointerdown', e => {
  if(!cropOpen || cropBusy || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if(e.pointerType === 'mouse') e.preventDefault();   // 文字や画像が選ばれないように（指は touch-action で止める）
  const pic = $('cropPic').getBoundingClientRect();
  const W = pic.width, H = pic.height, px = e.clientX - pic.left, py = e.clientY - pic.top;
  const d = { id:e.pointerId, W, H, x0:px, y0:py, mode:'new', moved:false };
  if(cropRect){
    const r = { l:cropRect.x * W, t:cropRect.y * H, r:(cropRect.x + cropRect.w) * W, b:(cropRect.y + cropRect.h) * H };
    // 角：近いものから。反対の角を固定して動かす
    let best = null;
    [['nw', r.l, r.t, r.r, r.b], ['ne', r.r, r.t, r.l, r.b], ['sw', r.l, r.b, r.r, r.t], ['se', r.r, r.b, r.l, r.t]].forEach(([c, x, y, ax, ay]) => {
      const dist = Math.hypot(px - x, py - y);
      if(dist <= CROP_HIT && (!best || dist < best.dist)) best = { dist, ax, ay };
    });
    if(best){ d.mode = 'corner'; d.ax = best.ax; d.ay = best.ay; }
    else if(px > r.l && px < r.r && py > r.t && py < r.b){ d.mode = 'move'; d.r0 = { ...cropRect }; }
  }
  cropDrag = d;
  if(e.pointerType === 'mouse'){ try{ e.currentTarget.setPointerCapture(e.pointerId); }catch(err){} }
});
$('cropStage').addEventListener('pointermove', e => {
  const d = cropDrag; if(!d || e.pointerId !== d.id) return;
  const pic = $('cropPic').getBoundingClientRect();
  const clampX = v => Math.max(0, Math.min(d.W, v)), clampY = v => Math.max(0, Math.min(d.H, v));
  const px = e.clientX - pic.left, py = e.clientY - pic.top;
  if(!d.moved && Math.abs(px - d.x0) + Math.abs(py - d.y0) < 4) return;
  d.moved = true;
  const toRect = (x1, y1, x2, y2) => ({ x:Math.min(x1, x2) / d.W, y:Math.min(y1, y2) / d.H, w:Math.abs(x2 - x1) / d.W, h:Math.abs(y2 - y1) / d.H });
  if(d.mode === 'move'){
    const r = d.r0;
    const nx = Math.max(0, Math.min(1 - r.w, r.x + (px - d.x0) / d.W)), ny = Math.max(0, Math.min(1 - r.h, r.y + (py - d.y0) / d.H));
    cropRect = { ...r, x:nx, y:ny };
  }else if(d.mode === 'corner'){
    cropRect = toRect(d.ax, d.ay, clampX(px), clampY(py));
  }else{
    d.draw = toRect(clampX(d.x0), clampY(d.y0), clampX(px), clampY(py));
    // 描き直し：小さすぎるうちは前の四角を残す
    if(d.draw.w * d.W >= CROP_MIN && d.draw.h * d.H >= CROP_MIN){ cropRect = d.draw; d.drew = true; }
    else if(d.drew) cropRect = d.draw;
  }
  paintCrop();
});
const endCropDrag = e => {
  const d = cropDrag; if(!d || e.pointerId !== d.id) return;
  cropDrag = null;
  // 小さすぎる四角は残さない（角で縮めすぎたときは、いちばん小さい大きさに）
  if(cropRect && (cropRect.w * d.W < CROP_MIN || cropRect.h * d.H < CROP_MIN)){
    if(d.mode === 'new') cropRect = null;
    else{
      const mw = CROP_MIN / d.W, mh = CROP_MIN / d.H;
      cropRect = { x:Math.min(cropRect.x, 1 - mw), y:Math.min(cropRect.y, 1 - mh), w:Math.max(cropRect.w, mw), h:Math.max(cropRect.h, mh) };
    }
  }
  paintCrop();
};
$('cropStage').addEventListener('pointerup', endCropDrag);
$('cropStage').addEventListener('pointercancel', endCropDrag);
$('cropCancel').addEventListener('click', cancelCrop);
$('cropGo').addEventListener('click', () => cropSearch());
// アプリの中で閉じる（キャンセル・Esc）。ブラウザの戻るでは層はもう外れているので hideCrop だけ
function cancelCrop(){ if(!cropOpen) return; popLayer('crop'); hideCrop(); }
function hideCrop(){
  if(!cropOpen) return;
  cropOpen = false; cropDrag = null; cropBusy = false;
  $('crop').hidden = true;
  syncModal();
  if($('crop').contains(edToast)){ edToast.hidden = true; document.body.append(edToast); }   // 知らせを隠れた画面の中に残さない
  $('cropPic').querySelectorAll('img').forEach(x => x.remove());
}
// 選んだ部分の画素：coverBlob と同じ経路で、切り抜いても粗くならないように大きめに取る
function largeDirect(u){
  try{
    const x = new URL(u);
    if(x.hostname === 'pbs.twimg.com'){ x.searchParams.set('name', 'medium'); return x.href; }
    if(x.hostname === 'i.pinimg.com'){ x.pathname = x.pathname.replace(/^\/(originals|\d+x\d*)\//, '/736x/'); return x.href; }
  }catch(e){}
  return '';
}
async function cropBlob(u){
  const d = largeDirect(u);
  if(d){ try{ return await fetchBlob(d); }catch(e){} }
  try{ return await fetchBlob(`https://wsrv.nl/?url=${encodeURIComponent(u)}&w=1024&h=1024&fit=inside&output=jpg&q=85`); }
  catch(e){ return fetchBlob(u); }
}
// 画像の形式によっては createImageBitmap で読めないので、そのときは <img> で読む
async function blobImage(blob){
  try{ return await createImageBitmap(blob); }catch(e){}
  const url = URL.createObjectURL(blob);
  try{ const im = new Image(); im.src = url; await im.decode(); return im; }
  finally{ setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
// 見えている向き（回転・反転）で、選んだ部分だけを描く。長い辺は 768 まで
async function cropCanvas(){
  const src = cropSrc, r = cropRect;
  const bmp = await blobImage(await cropBlob(src.url));
  const W = bmp.naturalWidth || bmp.width, H = bmp.naturalHeight || bmp.height;
  if(!W || !H) throw new Error('img');
  const side = Math.abs(src.rot / 90) % 2 === 1, RW = side ? H : W, RH = side ? W : H;
  const cw = r.w * RW, ch = r.h * RH, k = Math.min(1, 768 / Math.max(cw, ch));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(cw * k)); cv.height = Math.max(1, Math.round(ch * k));
  const g = cv.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.scale(k, k);
  g.translate(-r.x * RW, -r.y * RH);
  g.translate(RW / 2, RH / 2);
  g.scale(src.flip ? -1 : 1, 1);
  g.rotate(src.rot * Math.PI / 180);
  g.drawImage(bmp, -W / 2, -H / 2, W, H);
  if(bmp.close) bmp.close();
  return cv;
}
// 切り抜いた部分の画像（似た画像の画面の、上の大きい画像）
function cropImgEl(url, done){
  const im = new Image(); im.className = 'thumb'; im.alt = ''; im.decoding = 'async';
  im.addEventListener('load', done, { once:true }); im.addEventListener('error', done, { once:true });
  im.src = url;
  return im;
}
async function cropSearch(){
  if(!cropOpen || !cropRect || cropBusy || simBusy || !cache) return;
  const it = cropSrc.it;
  const st = t => showToast(t, null);
  cropBusy = true; simBusy = true; paintCrop();
  try{
    let m;
    try{ m = await ensureMap(st); }catch(e){ m = null; }
    const rec = m && m.rec;
    if(!m || !rec || !rec.basis || !rec.mean){ st('似た画像はまだ使えません。Mac の設定から準備できます'); return; }
    let cv;
    try{ cv = await cropCanvas(); }catch(e){ st('この画像を読み込めませんでした'); return; }
    if(!cropOpen) return;
    let v;
    try{ await loadDino(st); st('選んだ範囲を調べています…'); v = await embedCover(it.c, cv); }
    catch(e){ st('画像の AI を読み込めませんでした。つながっているか確かめて、もう一度押してください'); return; }
    if(!cropOpen) return;
    // 地図と同じ縮め方で 64 個にし、曲げていない地図と内積で比べる。元の画像そのものは入れない
    const y = unitV(project(v, rec, v.length, m.dims));
    const n = m.n, d = m.dims, V = m.V, sc = new Float64Array(n), idx = [];
    for(let r = 0; r < n; r++){ let s = 0; const o = r * d; for(let j = 0; j < d; j++) s += y[j] * V[o + j]; sc[r] = s; idx.push(r); }
    idx.sort((a, b) => sc[b] - sc[a] || a - b);
    const byId = new Map(cache.items.map(x => [x.i, x])), near = [];
    for(const r of idx){ const x = byId.get(m.ids[r]); if(x && x !== it) near.push(x); }
    const url = cv.toDataURL('image/jpeg', 0.85);
    const { url:ou, show, w, h } = cropSrc;
    edToast.hidden = true;
    popLayer('crop'); hideCrop();
    // src：切り抜く前の元の画像（この段の左上の画像から、また範囲を選べるように）
    enterView({ kind:'sim', sim:{ center:it, list:[it, ...near], crop:url, src:{ it, url:ou, show, w, h } }, from:it });
  }finally{
    cropBusy = false; simBusy = false;
    if(cropOpen) paintCrop();
  }
}
updateMapState();

