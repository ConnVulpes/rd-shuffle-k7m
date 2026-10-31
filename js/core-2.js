/* 更新：新着（syncNew）と変更分（syncChanged）、アプリに戻ったときの自動の確認。
   後半は一覧の並べ方（order sortPool shuffle setSort render simPool appendMore）。② で list.js に寄せる */
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

let order = [];
let shownCount = 0;
let poolSize = 0;

// 検索用の文字列（タイトル・URL・タグ・フォルダ名）はその場で作って覚えておく
const hayCache = new WeakMap();
function hayOf(x){
  let h = hayCache.get(x);
  if(!h){
    h = [x.t, x.l, x.d, (x.g || []).join(' '), collName(x)].join(' ').toLowerCase();
    hayCache.set(x, h);
  }
  return h;
}
function sortPool(pool){
  const a = pool.slice();
  const byDate = (x, y) => (x.a || '').localeCompare(y.a || '') || x.i - y.i;
  if(state.sort === 'new') return a.sort((x, y) => byDate(y, x));
  if(state.sort === 'old') return a.sort(byDate);
  if(state.sort === 'title') return a.sort((x, y) => jaCmp((x.t || x.l), y.t || y.l));
  // ♥ した順：♥ したものだけを、最後に ♥ した順に
  if(state.sort === 'liked') return a.filter(x => likesOf(x)).sort((x, y) => heat.get(y.i).tl - heat.get(x.i).tl || likesOf(y) - likesOf(x));
  // ランダム：熱いものほどくじが当たりやすい（並び全体に散らばって、少し多めに前の方に来る）
  const s = heatStrength();
  if(!s || !heat.size) return shuffleArray(a);
  const now = Date.now();
  return a.map(x => [x, -Math.log(1 - Math.random()) / heatWeight(x.i, now, s)]).sort((p, q) => p[1] - q[1]).map(p => p[0]);
}
// シャッフルボタン：並び順をシャッフルにして並べ直す
function shuffle(){
  exitSimilar();
  if(state.sort !== 'shuffle'){ state.sort = 'shuffle'; store.set('sort', 'shuffle'); applySortUI(); }
  render();
}
// 並び順：右の「ランダム ▾」から選ぶ。⇆ はランダムのときだけ出す
const SORT_NAMES = { shuffle:'ランダム', new:'新しい順', old:'古い順', title:'タイトル順', liked:'♥ した順' };
function applySortUI(){
  if(!(state.sort in SORT_NAMES)) state.sort = 'shuffle';
  $('sortLabel').textContent = SORT_NAMES[state.sort];
  shuffleBtn.hidden = state.sort !== 'shuffle';
  document.querySelectorAll('#sortMenu .menu-item').forEach(b => { b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', String(b.dataset.sort === state.sort)); });
}
function setSort(v){
  exitSimilar();
  state.sort = v; store.set('sort', v); applySortUI();
  if(cache) render();
}
// 今の条件（範囲・種類・検索・並び順）で並べ直す
function render(){
  if(!cache){ refreshAll(); return; }
  clearSelection();
  // 似ているものを並べている間は、元の一覧の絞り込みも並び順も使わず、近い順のまま（似た画像の条件があれば、合うものだけ）
  // サムネが出ないものだけのときは、今の絞り込みの中から
  const pool = sim ? simPool() : cache.items.filter(makeFilter(state.filter)).filter(x => !ntMode || isNoThumb(x));
  order = sim ? pool.slice() : sortPool(pool);
  poolSize = order.length;
  renderDeepBar();
  shownCount = 0;
  cardEls = [];
  placeGen++; placeQueue = Promise.resolve(); placing = 0;
  const oldHero = heroOf(); if(oldHero) oldHero.remove();
  layout(true);
  if(sim){
    // 押した画像を1列目の先頭に（一覧の中には出さない）。画像が読み込まれて高さが決まってから、ほかのカードを並べ始める
    const h = card(sim.center, true), gen = placeGen;
    putHero(h);
    placeQueue = placeQueue.then(() => Promise.race([h._ready, sleep(3000)])).then(() => { if(gen === placeGen) syncHeroGap(); });
  }
  watchHero();
  window.scrollTo({ top:0, behavior:'instant' });
  empty.hidden = poolSize > 0;
  if(!poolSize){
    moreEl.hidden = true;
    statusEl.textContent = 'この条件のブックマークはありません。左上の「絞り込み」で条件を変えてください。';
    return;
  }
  appendMore();
  paintSimNone();
}
// 似た画像の並び：押した画像を先頭に、条件に合うものだけを似ている順に（押した画像は条件に関係なく出す）
function simPool(){
  if(!simF) return sim.list;
  const f = makeFilter(simF);
  return [sim.center, ...sim.list.filter(x => x !== sim.center && f(x))];
}
// 似た画像を絞り込んで合うものがないとき：「合うものがありません」［絞り込みを変える］
function paintSimNone(){
  const box = $('simNone');
  const on = !!(sim && simF && poolSize <= 1);
  box.hidden = !on;
  if(!on) return;
  const h = heroOf();
  if(colCount >= 3 && h && cols[2]){
    // 列が3本以上：上の画像の右の空き（3列目から右端まで、上の画像と同じ高さ）の真ん中
    const a = cols[2].getBoundingClientRect(), z = cols[cols.length - 1].getBoundingClientRect(), hr = h.getBoundingClientRect();
    box.classList.add('beside');
    Object.assign(box.style, { left:(a.left + scrollX) + 'px', width:(z.right - a.left) + 'px', top:(hr.top + scrollY) + 'px', height:Math.max(hr.height, 160) + 'px' });
  }else{
    box.classList.remove('beside');
    box.removeAttribute('style');
  }
}
$('simNoneBtn').addEventListener('click', () => openFilter());

// 画像の大きさが分かってから列に入れる。先に入れると高さ0として数えてしまい、
// 縦長の画像が同じ列に偏って、下の方が1列だけになる。
let placeGen = 0, placeQueue = Promise.resolve(), placing = 0;
function appendMore(){
  const next = order.slice(shownCount, shownCount + state.count);
  const gen = placeGen;
  // 似た画像の画面では、押した画像（いちばん上に置いたもの）は一覧に入れない
  const els = next.filter(it => !(sim && it === sim.center)).map(it => { const c = card(it); cardEls.push(c); return c; });
  shownCount += next.length;
  placing += els.length;
  placeQueue = placeQueue.then(async () => {
    for(const c of els){
      if(gen !== placeGen) return;
      await Promise.race([c._ready, sleep(3000)]);
      if(gen !== placeGen) return;
      c._placed = true;
      placeCard(c);
      placing--;
    }
  });
  updateStatus();
}

