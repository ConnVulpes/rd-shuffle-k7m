/* 道具・定数・store・state・api・データの読み込み、更新（新着・変更分・すべて読み直す）、
   handleError、ブラウザの中のデータベースの道具（idbOpen idbDo） */
const API = 'https://api.raindrop.io/rest/v1';
// 端末間で共有する設定（プリセット・固定タグ）は、Raindrop の専用フォルダの1件のメモ欄に入れておく
const SET_TITLE = 'rd-shuffle 設定';
const SET_LINK = 'https://connvulpes.github.io/rd-shuffle-k7m/#settings';
const isSettingsRaw = it => !!it && typeof it.link === 'string' && (it.link.startsWith(SET_LINK) || it.link.startsWith('https://connvulpes.github.io/rd-shuffle-k7m/#map'));   // 一覧には出さない（設定と、似ているものの地図。長いときは #settings-2…／#map-2… に分けて入れる）
const PER = 50;
const DAY = 24 * 60 * 60 * 1000;
const store = {
  get(k, d){ try{ const v = localStorage.getItem('rdshuffle:' + k); return v === null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('rdshuffle:' + k, JSON.stringify(v)); return true; }catch(e){ return false; } },
  del(k){ try{ localStorage.removeItem('rdshuffle:' + k); }catch(e){} }
};
const state = {
  token: store.get('token', ''),
  filter: store.get('filter', null),
  sort: store.get('sort', 'shuffle'),
  count: store.get('count', 40),
  cap: store.get('cap', true),
  saver: store.get('saver', false),   // 軽量モード：画像を小さく取り、プレビューの高画質や動画は押したときだけ
  hideCur: store.get('hidecur', true),
  wakePx: store.get('wakepx', 360),
  col: store.get('col', ({ s:170, m:250, l:380 })[store.get('size', 'm')] || 250)
};
// cache: { savedAt, syncedAt, items:[{i:ID, t:タイトル, l:URL, c:カバー, m:添付, y:種類, d:ドメイン, k:フォルダID, g:タグ, a:保存日, u:最終変更日}], colls:[{id,label,parent}], tags:[{name,count}] }
let cache = store.get('cache', null);
let kids = new Map();       // フォルダID → 子フォルダのID
let folderCount = new Map(); // フォルダID → 中の件数（子フォルダも含む）
let collLabel = new Map();   // フォルダID → 「親 / 子」の表示名
let refreshing = false;

const $ = id => document.getElementById(id);
const grid = $('grid'), empty = $('empty'), statusEl = $('status');
const shuffleBtn = $('shuffle'), sortBtn = $('sortBtn'), refreshBtn = $('refresh');
const dlg = $('dlg'), tokenInput = $('tokenInput');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 日本語の並べ替え（毎回 localeCompare を呼ぶより速い）
const jaCmp = new Intl.Collator('ja').compare;
// 文字を HTML に入れるときの安全な変換
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
// 要素を作る小さな道具：el('div', 'クラス', '中の文字')
const el = (tag, cls, text) => { const e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; };
// 検索欄に「全部消す」× を付ける（4つの検索欄で共通）。返すのは欄を包んだ要素で、欄の代わりに置く。
// × は文字があるときだけ出す（出し入れは CSS の :placeholder-shown なので、文字をコードで変えても合う）。
// 押すと文字を消して、手で全部消したときと同じ input を流す（after があれば、そのあとに呼ぶ）。
// 入力中に押したら、そのまま続けて入力できる（フォーカスを外さない）。入力中でなければ消すだけ（キーボードを出さない）
function clearable(input, after){
  const wrap = el('span', 'clr');
  const x = el('button', 'clr-x'); x.type = 'button'; x.tabIndex = -1;
  x.setAttribute('aria-label', '文字を消す'); x.title = '文字を消す';
  x.innerHTML = icon('x');   // icon は list.js にあるので、呼ぶのは全部を読み込んだあと
  if(!input.placeholder) input.placeholder = ' ';
  if(input.parentNode) input.replaceWith(wrap);
  wrap.append(input, x);
  let typing = false;
  // 押したときに、欄からフォーカスが動かないように止める（マウスもタッチも）。
  // それでも外れたとき（iPhone など）は、押したあとに欄へ戻す（押す操作の中なのでキーボードは閉じない）
  x.addEventListener('pointerdown', e => { typing = document.activeElement === input; e.preventDefault(); });
  x.addEventListener('mousedown', e => e.preventDefault());
  x.addEventListener('click', e => {
    e.preventDefault();
    if(typing && document.activeElement !== input) input.focus();
    typing = false;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles:true }));
    if(after) after();
  });
  return wrap;
}

// Raindrop への問い合わせはすべてここを通す。
// 読み込みが上限に当たったら少し待ってやり直す。書き込みはすぐ失敗として返す（元に戻せるように）
async function api(path, { method = 'GET', body } = {}, tries = 0){
  const headers = { Authorization:'Bearer ' + state.token };
  let payload;
  if(body instanceof FormData) payload = body;
  else if(body !== undefined){ headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try{ res = await fetch(API + path, { method, headers, body:payload }); }
  catch(e){ throw new Error('network'); }
  if(res.status === 401) throw new Error('auth');
  if(res.status === 429){
    if(method !== 'GET' || tries >= 3) throw new Error('rate');
    statusEl.textContent = '読み込みの上限に近いので、少し待っています…';
    await sleep(20000);
    return api(path, { method, body }, tries + 1);
  }
  if(!res.ok) throw new Error('http');
  return res.json();
}
// 文字で受け取る問い合わせ（Raindrop の書き出し。CSV・HTML なので api() とは別に）。やり直しはしない
async function apiText(path){
  let res;
  try{ res = await fetch(API + path, { headers:{ Authorization:'Bearer ' + state.token } }); }
  catch(e){ throw new Error('network'); }
  if(res.status === 401) throw new Error('auth');
  if(!res.ok) throw new Error('http');
  return res.text();
}

function compact(it){
  const k = it.collection && it.collection.$id != null ? it.collection.$id : it.collectionId;
  return {
    i: it._id,
    t: it.title || '',
    l: it.link,
    c: it.cover || '',
    m: (it.media || []).filter(x => x && x.link).slice(0, 6).map(x => ({ l:x.link, t:x.type || '' })),
    y: it.type || '',
    d: it.domain || '',
    k: k,
    g: it.tags || [],
    a: (it.created || '').slice(0, 10),
    u: (it.lastUpdate || '').slice(0, 10)   // 最後に変わった日（変更分の取り込みに使う）
  };
}

function buildColls(roots, children){
  const all = [...(roots.items || []), ...(children.items || [])].filter(c => c.title !== SET_TITLE && c.title !== 'rd-shuffle 地図');
  const byId = new Map(all.map(c => [c._id, c]));
  const parentOf = c => (c.parent && c.parent.$id != null) ? c.parent.$id : null;
  const pathOf = (c, depth = 0) => {
    const p = byId.get(parentOf(c));
    return (p && depth < 8) ? pathOf(p, depth + 1) + ' / ' + c.title : c.title;
  };
  return all.map(c => ({ id:c._id, label:pathOf(c), parent:parentOf(c) }))
    .sort((a, b) => jaCmp(a.label, b.label));
}

// フォルダとタグの一覧を取る（全部読み込み直すときと、新着を取るときの両方で使う）
async function loadMeta(){
  const [roots, children, tagRes] = await Promise.all([
    api('/collections'), api('/collections/childrens'), api('/tags/0')
  ]);
  return {
    colls: buildColls(roots, children),
    tags: (tagRes.items || []).map(t => ({ name:t._id, count:t.count || 0 })).sort((a, b) => jaCmp(a.name, b.name))
  };
}

// ブックマークを全部、数ページずつ並行して読み込み、軽くした形でこのブラウザに保存する
async function refreshAll(manual = false){
  if(!state.token){ openToken(); return; }
  if(refreshing) return;
  refreshing = true;
  setUpdateBusy(true);
  if(!cache) setShuffleBusy(true);
  try{
    const meta = await loadMeta();
    const first = await api(`/raindrops/0?perpage=${PER}&page=0`);
    const total = first.count || 0;
    const pages = Math.ceil(total / PER);
    const out = new Array(pages);
    out[0] = first.items || [];
    let done = out[0].length;
    const progress = () => { statusEl.textContent = `読み込み中 ${done.toLocaleString()} / ${total.toLocaleString()}件`; };
    progress();
    let next = 1;
    const worker = async () => {
      while(next < pages){
        const p = next++;
        const r = await api(`/raindrops/0?perpage=${PER}&page=${p}`);
        out[p] = r.items || [];
        done += out[p].length;
        progress();
      }
    };
    await Promise.all([worker(), worker(), worker()]);

    const seen = new Set(), items = [];
    out.forEach(list => (list || []).forEach(it => {
      if(!it || seen.has(it._id) || isSettingsRaw(it)) return;
      seen.add(it._id);
      items.push(compact(it));
    }));
    // 前と比べて、新着・更新・削除の数を知らせる（初めて読み込んだときは知らせない）
    const before = cache ? new Map(cache.items.map(x => [x.i, JSON.stringify(x)])) : null;
    cache = { v:2, savedAt:Date.now(), syncedAt:Date.now(), items, colls:meta.colls, tags:meta.tags };
    const saved = store.set('cache', cache);
    applyCache();
    render();
    if(before){
      let fresh = 0, upd = 0;
      items.forEach(x => { const b = before.get(x.i); if(b === undefined) fresh++; else if(b !== JSON.stringify(x)) upd++; before.delete(x.i); });
      const parts = [];
      if(fresh) parts.push(`新着 ${fresh}件`);
      if(upd) parts.push(`更新 ${upd}件`);
      if(before.size) parts.push(`削除 ${before.size}件`);
      if(parts.length || manual) showToast(parts.length ? parts.join('・') : '変更はありません', null);
      bkAdd(fresh + upd);
    }
    if(!saved) statusEl.textContent += '（ブラウザに保存できなかったので、次に開いたときにまた読み込みます）';
  }catch(e){
    handleError(e);
  }finally{
    refreshing = false;
    setUpdateBusy(false);
    setShuffleBusy(false);
  }
}

function applyCache(){
  kids = new Map();
  cache.colls.forEach(c => {
    if(c.parent == null) return;
    if(!kids.has(c.parent)) kids.set(c.parent, []);
    kids.get(c.parent).push(c.id);
  });
  const direct = new Map();
  cache.items.forEach(x => direct.set(x.k, (direct.get(x.k) || 0) + 1));
  collLabel = new Map(cache.colls.map(c => [c.id, c.label]));
  folderCount = new Map();
  cache.colls.forEach(c => {
    let n = 0;
    descendants(c.id).forEach(id => { n += direct.get(id) || 0; });
    folderCount.set(c.id, n);
  });
  folderCount.set(-1, direct.get(-1) || 0);
  syncFilter();
}

function descendants(id){
  const set = new Set([id]);
  const stack = [id];
  while(stack.length){
    const cur = stack.pop();
    (kids.get(cur) || []).forEach(k => { if(!set.has(k)){ set.add(k); stack.push(k); } });
  }
  return set;
}

// ---- 更新は3種類 ----
// 新着　　　　　　：開いたとき・アプリに戻ったときに自動で（数リクエスト）
// Raindrop から更新：メニューから。前回から Raindrop 側で変わったもの（タグ・フォルダの変更、ゴミ箱行き）も取り込む
// すべて読み直す　：設定の画面から（refreshAll）
let lastSync = 0;
function setUpdateBusy(b){ ['updDiff', 'refresh'].forEach(id => { $(id).disabled = b; }); }
// 新しい順に見ていき、知っているものに当たったら止める
async function syncNew(manual = false){
  if(!cache || refreshing || !state.token) return;
  lastSync = Date.now();
  if(manual){ refreshing = true; setUpdateBusy(true); statusEl.textContent = '新着を確認中…'; }
  let handoff = false;   // 全部読み込みに切り替えたら、後始末はそちらに任せる
  try{
    const known = new Set(cache.items.map(x => x.i));
    const fresh = [];
    for(let p = 0; p < 5; p++){
      const r = await api(`/raindrops/0?perpage=${PER}&page=${p}&sort=-created`);
      const list = r.items || [];
      let reached = false;
      list.forEach(it => {
        if(known.has(it._id)){ reached = true; return; }
        if(isSettingsRaw(it)) return;
        known.add(it._id);
        fresh.push(compact(it));
      });
      if(reached || list.length < PER) break;
      if(p === 4){ handoff = true; refreshing = false; refreshAll(); return; }  // 多すぎるときは全部読み直す
    }
    if(!fresh.length){ if(manual) showToast('新着はありません', null); return; }
    if(refreshing && !manual) return;
    const meta = await loadMeta();
    cache.items = fresh.concat(cache.items);
    cache.colls = meta.colls;
    cache.tags = meta.tags;
    store.set('cache', cache);
    applyCache();
    showNewNote(`新着 ${fresh.length}件`, fresh.length);
    bkAdd(fresh.length);
  }catch(e){
    if(manual) handleError(e);   // 自動の確認は、失敗しても黙って次の機会に
  }finally{
    if(manual && !handoff){ refreshing = false; setUpdateBusy(false); }
  }
}
// 取り込んだ件数を下に短く知らせる（「新着 3件・更新 2件」）。新しい順で一番上を見ているときは、その場で並べ直す
function showNewNote(text, added){
  if(added && state.sort === 'new' && window.scrollY < 200 && !peek.open) render();
  showToast(text, null);
}

// 変更分：Raindrop の検索「lastUpdate:日付」で、前回の取り込み以降に変わった日を1日ずつ調べる
function autoSync(){ if(store.get('diffbroken', false)) syncNew(); else syncChanged(true); }
async function syncChanged(quiet = false){
  if(!cache || refreshing || !state.token) return;
  lastSync = Date.now();
  const since = cache.syncedAt || cache.savedAt;
  // 間が空きすぎたときは、日ごとに調べるより全部読み込むほうが早い
  if(Date.now() - since > 31 * DAY){
    statusEl.textContent = '前回から時間がたっているので、全部読み込みます';
    return refreshAll();
  }
  refreshing = true; setUpdateBusy(true);
  let handoff = false;
  try{
    // 世界時の日付で、前回の前日から今日までを調べる（時差でこぼさないように1日広めに）
    const dates = [];
    for(let t = Date.now(); t >= since - DAY; t -= DAY) dates.push(new Date(t).toISOString().slice(0, 10));
    const search = async (coll, q) => {
      const out = [];
      for(let p = 0; p < 40; p++){
        const r = await api(`/raindrops/${coll}?perpage=${PER}&page=${p}&search=${encodeURIComponent(q)}`);
        // 絞り込みが効かずに全部返ってきたら、変更分の取り込みはあきらめて全部読み込む
        if(p === 0 && coll === 0 && cache.items.length > 200 && (r.count || 0) > cache.items.length * 0.8) throw new Error('nofilter');
        const list = r.items || [];
        out.push(...list);
        if(list.length < PER) break;
      }
      return out;
    };
    const changed = new Map(), trashed = new Set();
    for(const d of dates){
      if(!quiet) statusEl.textContent = `変更を確認中… ${d}`;
      (await search(0, `lastUpdate:${d}`)).forEach(it => { if(!isSettingsRaw(it)) changed.set(it._id, it); });
      (await search(-99, `lastUpdate:${d}`)).forEach(it => trashed.add(it._id));
    }
    const byId = new Map(cache.items.map(x => [x.i, x]));
    const updated = [], fresh = [];
    changed.forEach((it, id) => {
      if(trashed.has(id)) return;
      const old = byId.get(id);
      if(old){ Object.assign(old, compact(it)); updated.push(old); }   // 同じ物を書き換えるので、表示中のカードもそのまま使える
      else fresh.push(compact(it));
    });
    const gone = cache.items.filter(x => trashed.has(x.i));
    cache.items = fresh.concat(cache.items.filter(x => !trashed.has(x.i)));
    // フォルダとタグの一覧は、何か変わったときだけ読み直す（自動の確認を軽く）
    if(fresh.length || updated.length || gone.length){
      const meta = await loadMeta();
      cache.colls = meta.colls;
      cache.tags = meta.tags;
    }
    cache.syncedAt = Date.now();
    store.set('cache', cache);
    applyCache();
    if(updated.length) afterLocalChange(updated, { media:true });
    gone.forEach(x => { const c = cardOf.get(x); if(c) setGone(c, 'ゴミ箱へ移動'); });
    if(!quiet) statusEl.textContent = '';
    const parts = [];
    if(fresh.length) parts.push(`新着 ${fresh.length}件`);
    if(updated.length) parts.push(`更新 ${updated.length}件`);
    if(gone.length) parts.push(`削除 ${gone.length}件`);
    if(!parts.length){ if(!quiet) showToast('変更はありません', null); }
    else showNewNote(parts.join('・'), fresh.length);
    bkAdd(fresh.length + updated.length);
  }catch(e){
    if(e.message === 'nofilter'){
      handoff = true; refreshing = false;
      // 自動の確認では全部を読み直さず、次からは新着だけを見る
      if(quiet){ store.set('diffbroken', true); setUpdateBusy(false); syncNew(); return; }
      statusEl.textContent = '変更分だけを取れなかったので、全部読み込みます'; refreshAll(); return;
    }
    if(quiet){ statusEl.textContent = ''; return; }   // 自動の確認は、失敗しても黙って次の機会に
    handleError(e);
  }finally{
    if(!handoff){ refreshing = false; setUpdateBusy(false); }
  }
}
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible' && Date.now() - lastSync > 5 * 60 * 1000) autoSync();
  if(document.visibilityState === 'visible' && Date.now() - lastPull > 60 * 1000) pullSettings();
});

function handleError(e){
  const m = {
    auth:'トークンが無効です。設定から入れ直してください。',
    network:'Raindrop に接続できませんでした。ネット接続を確認してください。',
    rate:'読み込みの上限に達しました。1分ほど待ってから「更新」を押してください。'
  }[e.message] || '読み込みに失敗しました。「更新」をもう一度押してください。';
  statusEl.textContent = m;
  if(e.message === 'auth') openToken();
}

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
