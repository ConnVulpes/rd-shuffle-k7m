/* 土台：定数・小さな道具（$ el esc sleep）・store・state・api・apiText、
   ブックマークとフォルダ・タグの読み込み（loadMeta refreshAll applyCache） */
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

