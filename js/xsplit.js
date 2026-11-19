/* X の投稿の画像を、1枚ずつ別のブックマークに分ける。
   ・最初の1回（前からある分）：splitScan で投稿ごとの画像の数を調べ（Mac の Chrome だけ）、増える件数を見せてから splitRun で作る
   ・そのあと保存した分：splitAuto が、どの端末でも自動で分ける
   ・プレビューの「n/N」（同じ投稿の画像の画面へ入る入り口）
   分けたものは本物の Raindrop のブックマーク。元のブックマークは書き換えない。
   使うもの：xId xIndex（preview.js）・postId postIndex postOf postPool fxMedia（list.js）・xs xsSet（heat-sync.js）・trashItems（select.js） */

// ---- 途中の結果（ブラウザの中のデータベース rdxs）----
// 投稿ごとに { id, st:'ok'|'gone'|'later', items:[{k,u}], user, tries, first, sess }。'_meta' には調べ始めたときのいちばん大きい ID（w0）
const XS_DB = 'rdxs', XS_ST = 'st';
const xsRows = () => idbDo(XS_DB, XS_ST, 'readonly', s => s.getAll()).then(r => r || []).catch(() => []);
const xsPut = rec => idbDo(XS_DB, XS_ST, 'readwrite', s => s.put(rec, rec.id)).catch(() => null);

let xsBusy = false;           // 調べている・作っている間は、ほかの確認をしない
const xsSess = Date.now();    // この開き方の印（'later' の回数は、1回開くたびに1つだけ数える）
let xsLast = 0;               // 最後に作る問い合わせを送った時刻（1秒に1回まで）
let xsSaveTimer = 0;
const xsVisible = () => document.visibilityState === 'visible';
const xsMaxId = () => cache.items.reduce((m, x) => Math.max(m, x.i), 0);
// その投稿の今あるブックマーク（ゴミ箱でないもの）の番号。2種類以上あれば「済み」
const xsNums = id => new Set(postPool(id).map(x => xIndex(x.l)));
const xsDone = id => xsNums(id).size >= 2;

// 作ったものを手元のキャッシュに足す（保存と数え直しは、途中は間をあけて、終わりに1回）
function xsAdd(rawList, made){
  const fresh = (rawList || []).filter(it => it && !isSettingsRaw(it)).map(compact);
  if(!fresh.length) return 0;
  cache.items = fresh.concat(cache.items);
  made.push(...fresh);
  clearTimeout(xsSaveTimer);
  xsSaveTimer = setTimeout(() => { applyCache(); store.set('cache', cache); }, 5000);
  return fresh.length;
}

// 1つの投稿の、作るもの（POST の1件ずつ）。have = 今ある番号（これは作らない）、o = 元の生のブックマーク、fx = fxMedia の結果
function xsBodies(id, o, fx, have, originLink){
  let user = fx.user;
  if(!user){ try{ user = new URL(originLink).pathname.split('/')[1] || 'i'; }catch(e){ user = 'i'; } }
  const base = Date.parse(o.created) || Date.now();
  const k = xIndex(originLink);   // 元の番号（元が /photo/3 なら 3）。元より前の番号は元より新しく、後ろの番号は古くする
  const coll = o.collection && o.collection.$id != null ? o.collection.$id : o.collectionId;
  const out = [];
  fx.items.forEach((m, i) => {
    const n = i + 1;
    if(have.has(n)) return;
    const cover = m.k === 'p' && isX(m.u) ? smallUrl(m.u) : m.u;   // 写真は小さいサイズ。動画・GIF はサムネのまま
    out.push({
      link:`https://x.com/${user}/status/${id}/${m.k === 'v' ? 'video' : 'photo'}/${n}`,   // GIF は /photo/n
      title:o.title || '', excerpt:o.excerpt || '',
      cover, media:[{ link:cover }],
      type:m.k === 'p' ? (o.type || 'image') : 'video',
      tags:o.tags || [],
      collection:{ $id:coll },
      created:new Date(base - (n - k) * 1000).toISOString()   // 番号1つにつき 1 秒ずつ古く（Raindrop の新しい順でも 1→N に並ぶように）
    });   // pleaseParse は付けない（付けると Raindrop が後からリンクを読み直して、cover や title を上書きする）
  });
  return out;
}

// 作る問い合わせ：1秒に1回まで。429 は 60 秒待って同じものを送り直す。通信の失敗・ほかのエラーはそのまま投げる（そこで止める）
async function xsPost(items){
  for(let t = 0; ; t++){
    const wait = xsLast + 1000 - Date.now();
    if(wait > 0) await sleep(wait);
    xsLast = Date.now();
    try{
      const r = await api('/raindrops', { method:'POST', body:{ items } });
      return (r && r.items) || [];
    }catch(e){
      if(e.message === 'rate' && t < 10){ await sleep(60000); continue; }
      throw e;
    }
  }
}

// ---- 最初の1回：調べる ----
// 前からある X の投稿（始めた時点のいちばん大きい ID 以下）の画像の数を、アプリが見えている間だけ、同時に3件まで調べる。
// 結果は rdxs に残し、次に開いたときは続きから
async function splitScan(){
  if(xsBusy || !bkCanPick || !state.token || !cache || refreshing || (xs && xs.on)) return;
  xsBusy = true;
  let go = false;
  try{
    const rec = new Map(); let meta = null;
    (await xsRows()).forEach(r => { if(!r) return; if(r.id === '_meta') meta = r; else rec.set(r.id, r); });
    if(!meta){ meta = { id:'_meta', w0:xsMaxId(), at:Date.now() }; await xsPut(meta); }
    const w0 = meta.w0;
    // 済みでない X の投稿（w0 以下のブックマークを含むもの）
    const ids = new Set();
    cache.items.forEach(it => { if(it.k === -99 || it.i > w0) return; const id = postId(it); if(id) ids.add(id); });
    const todo = [...ids].filter(id => !xsDone(id));
    const fin = r => !!r && (r.st === 'ok' || r.st === 'gone');
    const queue = todo.filter(id => !fin(rec.get(id)));
    let at = 0;
    const WAITS = [5000, 15000, 60000];   // 'later' は 5〜60 秒で待ち直す（今回は最大3回）
    const work = async () => {
      while(at < queue.length){
        if(xs && xs.on) return;   // ほかの端末で終わっていたら、やめる
        const id = queue[at++];
        for(let a = 0; a < WAITS.length; a++){
          while(!xsVisible()) await sleep(1000);   // 見えなくなったら止め、見えたら続き
          const fx = await fxMedia(id);
          const r = rec.get(id) || { id, first:Date.now(), tries:0 };
          if(fx.st === 'later'){
            if(r.sess !== xsSess){ r.tries++; r.sess = xsSess; }   // 回数は、開くたびに1つ
            r.st = (r.tries >= 3 || Date.now() - r.first >= 7 * DAY) ? 'gone' : 'later';   // 3回か7日で 'gone' として確定
            if(r.st === 'gone') r.items = [];
          }else{
            r.st = fx.st; r.items = fx.items; r.user = fx.user;
          }
          rec.set(id, r); xsPut(r);
          if(fin(r)) break;
          if(a < WAITS.length - 1) await sleep(WAITS[a]);
        }
      }
    };
    await Promise.all([work(), work(), work()]);
    if(xs && xs.on) return;
    if(todo.some(id => !fin(rec.get(id)))) return;   // まだ終わっていない分がある：次に開いたときに続き
    // 数える：2件以上の画像がある投稿と、作ると増える件数（今ある番号は除く）
    let posts = 0, add = 0;
    todo.forEach(id => {
      const r = rec.get(id);
      if(!r || r.st !== 'ok' || r.items.length < 2) return;
      const have = xsNums(id);
      let miss = 0; for(let n = 1; n <= r.items.length; n++) if(!have.has(n)) miss++;
      if(miss){ posts++; add += miss; }
    });
    if(!add){ xsSet({ on:true, upto:w0 }); return; }   // 増えるものがなければ、知らせずに自動へ
    go = true;   // 確認はせず、そのまま作る（xsBusy を戻してから）
  }catch(e){
    /* 失敗は黙って、次に開いたときに続きから */
  }finally{
    xsBusy = false;
  }
  if(go) splitRun();
}

// ---- 最初の1回：作る ----
async function splitRun(){
  // ほかの更新の途中に押されたら、終わるのを待ってから（最大2分）
  for(let t = 0; (refreshing || xsBusy) && t < 120; t++) await sleep(1000);
  if(xsBusy || !state.token || !cache || refreshing) return;
  xsBusy = true; refreshing = true; setUpdateBusy(true);
  const made = [];
  let err = null;
  try{
    const metaRec = (await xsRows()).find(r => r && r.id === '_meta');
    const w0 = metaRec ? metaRec.w0 : xsMaxId();
    // 全部を読み直してキャッシュに入れ直す。X のものは、元の生の created・excerpt・type・title などを取っておく（キャッシュの a は日付だけなので）
    const meta = await loadMeta();
    const raw = await fetchAllRaw();
    const seen = new Set(), items = [], rawOf = new Map();
    raw.forEach(it => {
      if(!it || seen.has(it._id) || isSettingsRaw(it)) return;
      seen.add(it._id);
      items.push(compact(it));
      if(/(?:x|twitter)\.com/i.test(it.link || '')) rawOf.set(it._id, it);
    });
    cache = { v:2, savedAt:Date.now(), syncedAt:Date.now(), items, colls:meta.colls, tags:meta.tags };
    store.set('cache', cache);
    applyCache();
    // 作るもの：投稿ごとに、1番から N 番までのうち今ない番号（1番がなければ /photo/1 で作る）
    const rec = new Map();
    (await xsRows()).forEach(r => { if(r && r.id !== '_meta') rec.set(r.id, r); });
    const ids = new Set();
    cache.items.forEach(it => { if(it.k === -99 || it.i > w0) return; const id = postId(it); if(id) ids.add(id); });
    const plan = [];   // 1つの投稿ごとの POST の配列
    ids.forEach(id => {
      const r = rec.get(id);
      if(!r || r.st !== 'ok' || r.items.length < 2 || xsDone(id)) return;
      const origin = postPool(id)[0];
      const o = origin && rawOf.get(origin.i);
      if(!o) return;
      const bodies = xsBodies(id, o, r, xsNums(id), origin.l);
      if(bodies.length) plan.push(bodies);
    });
    const total = plan.reduce((n, b) => n + b.length, 0);
    // 1つの投稿の分は必ず同じ問い合わせに入れる（100件以内。超えるときは投稿の区切りで分ける）
    const batches = [];
    let cur = [];
    plan.forEach(b => { if(cur.length && cur.length + b.length > 100){ batches.push(cur); cur = []; } cur.push(...b); });
    if(cur.length) batches.push(cur);
    let done = 0;
    statusEl.textContent = `分けています ${done.toLocaleString()} / ${total.toLocaleString()}件`;
    for(const batch of batches){
      const got = await xsPost(batch);
      // 返ってきたものは、並び順に頼らず、投稿の ID と番号で元の1件と結び付ける
      const byKey = new Map(got.map(g => [xId(g.link) + '/' + xIndex(g.link), g]));
      const mine = batch.map(b => byKey.get(xId(b.link) + '/' + xIndex(b.link))).filter(Boolean);
      done += xsAdd(mine, made);
      statusEl.textContent = `分けています ${done.toLocaleString()} / ${total.toLocaleString()}件`;
    }
    xsSet({ on:true, upto:w0, bulkAt:Date.now() });
    cache.savedAt = Math.max(cache.savedAt, xs.bulkAt) + 1;   // ほかの端末が全部を読み直す目印（bulkAt）より、手元は新しい
  }catch(e){
    err = e;
  }finally{
    clearTimeout(xsSaveTimer);
    if(made.length){ afterLocalChange(made); bkAdd(made.length); }   // タグの数え直し・保存（途中で止まったときも、ここまでの分は手元に入れる）
    refreshing = false; setUpdateBusy(false); xsBusy = false;
    statusEl.textContent = '';
    if(cache && !views.length && !peek.open) render();
    else if(cache) updateStatus();
  }
  if(err){ handleError(err); return; }
  if(!made.length) return;
  showToast(`X の画像を ${made.length}件に分けました`, null);   // 元に戻すは付けない（戻すと次に開いたとき、また分かれてしまうため）
}

// ---- そのあと保存した分：自動 ----
// ID が xs.upto より大きいブックマークを含む、済みでない X の投稿を見る。2件以上の画像があれば、作る直前に Raindrop を読み直して、
// 今ない番号（ゴミ箱にあるものも「今ある」。消したものを作り直さない）だけを作る
async function splitAuto(){
  if(!xs || !xs.on){ if(bkCanPick) splitScan(); return; }   // まだ最初の1回が済んでいない
  if(xsBusy || !state.token || !cache || refreshing) return;
  xsBusy = true;
  const made = [];
  try{
    const upto = xs.upto || 0;
    const first = new Map();   // 投稿 ID → upto より大きいブックマークのいちばん小さい ID
    cache.items.forEach(it => {
      if(it.k === -99 || it.i <= upto) return;
      const id = postId(it); if(!id) return;
      const m = first.get(id); if(m == null || it.i < m) first.set(id, it.i);
    });
    const list = [...first].filter(([id]) => !xsDone(id)).sort((a, b) => a[1] - b[1]);
    let pending = Infinity, stop = false;
    for(const [id, minId] of list){
      if(stop){ pending = Math.min(pending, minId); continue; }
      let r;
      try{ r = await xsAutoOne(id, made); }catch(e){ r = 'hold'; stop = true; }   // 通信の失敗・エラーはそこで止める（次の機会に続き）
      if(r === 'hold') pending = Math.min(pending, minId);
    }
    if(made.length){
      clearTimeout(xsSaveTimer);
      afterLocalChange(made);
      showNewNote(`新着 ${made.length}件`, made.length);
      bkAdd(made.length);
    }
    // 見終わったところまで進める（保留中の投稿の手前まで）
    const next = Math.min(pending - 1, xsMaxId());
    if(next > (xs.upto || 0)) xsSet({ upto:next });
  }catch(e){
    /* 黙って、次の機会に */
  }finally{
    xsBusy = false;
  }
}
// 1つの投稿：作ったら作った件数、作らないなら 0、あとでやり直すなら 'hold'
async function xsAutoOne(id, made){
  const origin = postPool(id)[0];
  if(!origin) return 0;
  const fx = await fxMedia(id);
  if(fx.st === 'later') return 'hold';
  if(fx.st === 'gone' || fx.items.length < 2) return 0;
  // 作る直前に Raindrop を読む（ゴミ箱の中も）。検索が効いていれば、1つ目の結果に元の _id が入っている
  const enc = encodeURIComponent;
  let live = (await api(`/raindrops/0?search=${enc('link:' + id)}&perpage=50`)).items || [];
  let trash = (await api(`/raindrops/-99?search=${enc('link:' + id)}&perpage=50`)).items || [];
  if(!live.some(x => x._id === origin.i)){
    // 効いていなければ、元の保存日の前日・当日・翌日を読む
    const day = new Date(origin.a + 'T00:00:00Z').getTime();
    if(!(day > 0)) return 'hold';
    const byDay = async (coll, d) => {
      const out = [];
      for(let p = 0; p < 20; p++){
        const l = (await api(`/raindrops/${coll}?search=${enc('created:' + d)}&perpage=${PER}&page=${p}`)).items || [];
        out.push(...l);
        if(l.length < PER) break;
      }
      return out;
    };
    live = []; trash = [];
    for(const dd of [-1, 0, 1]){
      const d = new Date(day + dd * DAY).toISOString().slice(0, 10);
      live.push(...await byDay(0, d));
      trash.push(...await byDay(-99, d));
    }
    if(!live.some(x => x._id === origin.i)) return 'hold';   // それでも元が見つからなければ、作らずに保留
  }
  const mineOf = list => list.filter(x => x && typeof x.link === 'string' && xId(x.link) === id);
  const liveX = mineOf(live), trashX = mineOf(trash);
  const o = liveX.find(x => x._id === origin.i);
  if(!o) return 'hold';
  if(new Set(liveX.map(x => xIndex(x.link))).size >= 2) return 0;   // もう分けてある（ほかの端末など）
  const have = new Set([...liveX, ...trashX].map(x => xIndex(x.link)));
  const bodies = xsBodies(id, o, fx, have, origin.l);
  if(!bodies.length) return 0;
  const got = await xsPost(bodies);
  const byKey = new Map(got.map(g => [xId(g.link) + '/' + xIndex(g.link), g]));
  return xsAdd(bodies.map(b => byKey.get(xId(b.link) + '/' + xIndex(b.link))).filter(Boolean), made);
}

// ---- プレビューの「n/N」：同じ投稿の画像の画面へ ----
// 2件以上ある投稿のときだけ出す（n は自分の番号、N はその投稿でいちばん大きい番号）
function paintPeekPost(it){
  const b = $('peekPost');
  const L = it ? postOf(it) : [];
  b.hidden = L.length < 2;
  if(L.length >= 2) b.textContent = `${xIndex(it.l)}/${Math.max(...L.map(x => xIndex(x.l)))}`;
}
// 押すと、プレビューを閉じて一段奥へ（「似た画像」と同じ）。今いる段がその投稿の画面なら何もしない
$('peekPost').addEventListener('click', () => {
  const it = peekItem; if(!it) return;
  const id = postId(it);
  if(!id || postMode === id) return;
  if(peek.open){ peekSilent = true; closePeek(); }
  enterView({ kind:'post', id, from:it });
});
