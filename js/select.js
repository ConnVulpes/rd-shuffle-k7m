/* まとめて変える（moveMany addTagsMany removeTagsMany）、複数選択（pickCard 下のバー）、長押しのメニュー */
// ---- まとめて変える（複数選択から）----
// Raindrop の「まとめて更新」はフォルダごとにしか送れないので、今いるフォルダごとに分けて送る
function groupBy(list, keyOf){
  const m = new Map();
  list.forEach(x => { const k = keyOf(x); if(!m.has(k)) m.set(k, []); m.get(k).push(x); });
  return m;
}
async function runLimited(list, n, fn){
  let i = 0;
  await Promise.all(Array.from({ length:Math.min(n, list.length) }, async () => { while(i < list.length) await fn(list[i++]); }));
}
// 1件ずつ送る。上限に当たったら少し待ってやり直す。失敗したものを返す
async function putEach(list, bodyOf, label){
  const failed = [];
  let done = 0;
  await runLimited(list, 2, async x => {
    for(let t = 0; ; t++){
      try{ await api(`/raindrop/${x.i}`, { method:'PUT', body:bodyOf(x) }); break; }
      catch(e){
        if(e.message === 'rate' && t < 4){ await sleep(15000); continue; }
        failed.push(x); failed.err = e; break;
      }
    }
    done++;
    if(label && list.length > 3) showToast(`${label}… ${done}/${list.length}`, null);
  });
  return failed;
}
// まとめて変える共通の流れ：
// 1) フォルダごとに「まとめて更新」で送る（100件ずつ）
// 2) そのうち1件を読み直して、本当に変わったか確かめる
// 3) 送れなかった・変わっていなかったものは、1件ずつ送り直す（確実だが遅い）
// groups: 今いるフォルダID → ブックマーク / bulk: まとめて送る中身 / each(x): 1件ずつ送る中身
// applied(サーバーの1件, x): 変わっているか
async function sendMany(groups, bulk, each, applied, label){
  const redo = [];
  for(const [k, list] of groups){
    let ok = true;
    for(let i = 0; i < list.length && ok; i += 100){
      try{ await api(`/raindrops/${k}`, { method:'PUT', body:{ ids:list.slice(i, i + 100).map(x => x.i), ...bulk } }); }
      catch(e){ ok = false; }
    }
    if(ok){
      try{ const r = await api(`/raindrop/${list[0].i}`); ok = !!(r && r.item && applied(r.item, list[0])); }
      catch(e){ /* 確かめられないときは送れたものとして扱う */ }
    }
    if(!ok) redo.push(...list);
  }
  const failed = redo.length ? await putEach(redo, each, label) : [];
  return { failed, redone:redo.length };
}
const resultNote = (failed, redone) => (failed.length ? `（${failed.length}件は失敗）` : '') + (redone && !failed.length ? '（1件ずつ送り直しました）' : '');
// 結果に合わせて、うまくいかなかったものを手元でも元に戻す
function revertFailed(failed, restore){
  if(!failed.length) return;
  failed.forEach(restore);
  afterLocalChange(failed);
}

async function moveMany(items, to){
  // ゴミ箱へ送ったもの（選んだまま残っているもの）は移さない（手元の一覧にはもう入っていないので）
  const list = items.filter(x => x.k !== to && x.k !== -99);
  if(!list.length){ showToast(`もう「${folderShort(to)}」に入っています`, null); return; }
  const from = new Map(list.map(x => [x, x.k]));
  const groups = groupBy(list, x => x.k);
  list.forEach(x => { x.k = to; });
  afterLocalChange(list);
  const { failed, redone } = await sendMany(groups, { collection:{ $id:to } }, () => ({ collection:{ $id:to } }),
    srv => srv.collection && srv.collection.$id === to, '移しています');
  revertFailed(failed, x => { x.k = from.get(x); });
  const ok = list.filter(x => !failed.includes(x));
  if(!ok.length){ showToast(`移せませんでした（${whyText(failed.err)}）`, null); return; }
  bkAdd(ok.length);
  showToast(`${ok.length}件を「${folderShort(to)}」に移しました` + resultNote(failed, redone), async () => {
    // 元のフォルダごとに戻す
    ok.forEach(x => { x.k = from.get(x); });
    afterLocalChange(ok);
    const fails = [];
    for(const [k, part] of groupBy(ok, x => from.get(x))){
      const r = await sendMany(new Map([[to, part]]), { collection:{ $id:k } }, () => ({ collection:{ $id:k } }),
        srv => srv.collection && srv.collection.$id === k, '戻しています');
      fails.push(...r.failed);
    }
    revertFailed(fails, x => { x.k = to; });
    showToast(fails.length ? `${fails.length}件は戻せませんでした` : '元に戻しました', null);
  });
}
// タグをまとめて付ける
async function addTagsMany(items, tags){
  const list = items.filter(x => tags.some(t => !(x.g || []).includes(t)));
  if(!list.length){ showToast('もう付いています', null); return; }
  const before = new Map(list.map(x => [x, (x.g || []).slice()]));
  list.forEach(x => { x.g = [...new Set([...(x.g || []), ...tags])]; });
  afterLocalChange(list);
  // まとめて更新の tags は「付け足し」になる。1件ずつ送るときは付け足した後のタグ全部を送る
  const { failed, redone } = await sendMany(groupBy(list, x => x.k), { tags }, x => ({ tags:x.g }),
    srv => tags.every(t => (srv.tags || []).includes(t)), 'タグを付けています');
  revertFailed(failed, x => { x.g = before.get(x); });
  const ok = list.filter(x => !failed.includes(x));
  const label = tags.map(t => '#' + t).join(' ');
  if(!ok.length){ showToast(`付けられませんでした（${whyText(failed.err)}）`, null); return; }
  bkAdd(ok.length);
  showToast(`${ok.length}件に ${label} を付けました` + resultNote(failed, redone), () => restoreTags(ok, before));
}
// タグをまとめて外す（まとめて特定のタグだけ外す方法がないので、1件ずつ送る）
async function removeTagsMany(items, tags){
  const list = items.filter(x => tags.some(t => (x.g || []).includes(t)));
  if(!list.length) return;
  const before = new Map(list.map(x => [x, (x.g || []).slice()]));
  list.forEach(x => { x.g = (x.g || []).filter(t => !tags.includes(t)); });
  afterLocalChange(list);
  const failed = await putEach(list, x => ({ tags:x.g }), 'タグを外しています');
  revertFailed(failed, x => { x.g = before.get(x); });
  const ok = list.filter(x => !failed.includes(x));
  const label = tags.map(t => '#' + t).join(' ');
  if(!ok.length){ showToast(`外せませんでした（${whyText(failed.err)}）`, null); return; }
  bkAdd(ok.length);
  showToast(`${ok.length}件から ${label} を外しました` + resultNote(failed, 0), () => restoreTags(ok, before));
}
// 元に戻す：1件ずつ前のタグに戻す
async function restoreTags(list, before){
  const now = new Map(list.map(x => [x, x.g]));
  list.forEach(x => { x.g = before.get(x); });
  afterLocalChange(list);
  const fails = await putEach(list, x => ({ tags:x.g }), '戻しています');
  revertFailed(fails, x => { x.g = now.get(x); });
  showToast(fails.length ? `${fails.length}件は戻せませんでした` : '元に戻しました', null);
}

// ---- ゴミ箱へ送る（プレビューの1件・選んだもの、どちらもここを通す）----
// Raindrop では、ゴミ箱にあるものへ DELETE を送ると完全に消えてしまう。
// なので、ゴミ箱にあるもの（k が -99）には決して送らない。手元で送ったものも k を -99 にしておく
const TRASH = -99;
// 元に戻している途中のもの。戻し終わる前にまた送ると、Raindrop ではゴミ箱の中のものを消すことになり、完全に消えてしまうので送らない
const restoring = new Set();
const canTrash = it => !!it && it.k !== TRASH && !restoring.has(it);
// 手元から外す：cache.items と今の並び（order）から外し、カードは消さずに「ゴミ箱へ移動」の印を付ける。
// 戻すときのために、元のフォルダと位置を返す
function trashLocal(list){
  const drop = new Set(list);
  const back = list.map(x => ({ x, k:x.k, ci:cache.items.indexOf(x), oi:order.indexOf(x), ord:order }));
  back.forEach(b => { b.shown = b.oi >= 0 && b.oi < shownCount; });
  cache.items = cache.items.filter(x => !drop.has(x));
  // 後ろから外す（前から外すと、あとの位置がずれる）
  back.filter(b => b.oi >= 0).sort((a, b) => b.oi - a.oi).forEach(b => { order.splice(b.oi, 1); poolSize--; if(b.shown) shownCount--; });
  // 類似画像の画面の奥に取っておいた一覧からも外す（戻ったときに、送ったものへ進まないように）。カードには印を付ける
  views.forEach(v => {
    const s = v.snap;
    if(!s || !s.order || s.order === order) return;
    for(let i = s.order.length - 1; i >= 0; i--){
      if(!drop.has(s.order[i])) continue;
      s.order.splice(i, 1); s.poolSize--; if(i < s.shownCount) s.shownCount--;
    }
    (s.cardEls || []).forEach(c => { if(drop.has(c._item)) setGone(c, 'ゴミ箱へ移動'); });
  });
  list.forEach(x => {
    x.k = TRASH;
    hayCache.delete(x);
    const c = cardOf.get(x);
    if(c) setGone(c, 'ゴミ箱へ移動');   // Raindrop 側でゴミ箱に入ったものを取り込んだときと同じ見え方
  });
  afterLocalChange([]);   // タグの数え直し・フォルダの件数・保存
  syncSelection();
  updateStatus();
  if(peekItem) updatePeekNav(peekItem);
  return back;
}
// 手元で戻す：元のフォルダ・cache.items・並びの元の位置へ。カードの印も外す
function untrashLocal(back){
  back.slice().sort((a, b) => a.ci - b.ci).forEach(b => {
    b.x.k = b.k;
    if(!cache.items.includes(b.x)) cache.items.splice(Math.min(Math.max(b.ci, 0), cache.items.length), 0, b.x);
  });
  // 並べ直していなければ、並びの元の位置へ戻す（並べ直したあとなら、次に並べるときに入る）
  back.filter(b => b.oi >= 0 && b.ord === order && !order.includes(b.x)).sort((a, b) => a.oi - b.oi).forEach(b => {
    order.splice(Math.min(b.oi, order.length), 0, b.x); poolSize++; if(b.shown) shownCount++;
  });
  afterLocalChange(back.map(b => b.x));   // カードは今の絞り込みに合えば印を外す（合わなければ理由を出す）
  syncSelection();
  updateStatus();
  if(peekItem) updatePeekNav(peekItem);
}
// Raindrop へ送る。1件は DELETE /raindrop/{id}。複数は今いるフォルダごとに DELETE /raindrops/{フォルダ}（100件ずつ）。
// まとめて送れなかったものは、1件ずつ「まだゴミ箱に入っていないか」を確かめてから送る（2回送って完全に消さないように）
async function sendTrash(back){
  const failed = [];
  if(back.length === 1){
    const b = back[0];
    if(b.k === TRASH) return { failed, redone:0 };
    try{ await api(`/raindrop/${b.x.i}`, { method:'DELETE' }); }
    catch(e){ failed.push(b); failed.err = e; }
    return { failed, redone:0 };
  }
  const redo = [];
  for(const [k, part] of groupBy(back, b => b.k)){
    if(k === TRASH || !part.length) continue;   // 念のため（ids が空だと、フォルダの中身が全部ゴミ箱へ行く）
    let ok = true;
    for(let i = 0; i < part.length && ok; i += 100){
      try{ await api(`/raindrops/${k}`, { method:'DELETE', body:{ ids:part.slice(i, i + 100).map(b => b.x.i) } }); }
      catch(e){ ok = false; }
    }
    // そのうち1件を読み直して、本当にゴミ箱に入ったか確かめる
    if(ok){
      try{ const r = await api(`/raindrop/${part[0].x.i}`); ok = !!(r && r.item && r.item.collection && r.item.collection.$id === TRASH); }
      catch(e){ /* 確かめられないときは送れたものとして扱う */ }
    }
    if(!ok) redo.push(...part);
  }
  let done = 0;
  await runLimited(redo, 2, async b => {
    for(let t = 0; ; t++){
      try{
        const r = await api(`/raindrop/${b.x.i}`);
        const now = r && r.item && r.item.collection ? r.item.collection.$id : null;
        if(now !== TRASH) await api(`/raindrop/${b.x.i}`, { method:'DELETE' });   // もう入っていれば送らない
        break;
      }catch(e){
        if(e.message === 'rate' && t < 4){ await sleep(15000); continue; }
        failed.push(b); failed.err = e; break;
      }
    }
    done++;
    if(redo.length > 3) showToast(`ゴミ箱へ移しています… ${done}/${redo.length}`, null);
  });
  return { failed, redone:redo.length };
}
// ゴミ箱へ送る：画面はすぐ変え、Raindrop へは後ろで送る。送れなかったものは手元を元に戻す
async function trashItems(items){
  const list = items.filter(canTrash);   // もうゴミ箱にあるもの・戻している途中のものは外す
  if(!list.length) return;
  const back = trashLocal(list);
  const { failed, redone } = await sendTrash(back);
  if(failed.length) untrashLocal(failed);
  const ok = back.filter(b => !failed.includes(b));
  if(!ok.length){ showToast(`保存できませんでした（${whyText(failed.err)}）`, null); return; }
  bkAdd(ok.length);
  // 元に戻すは 5 秒（ほかの元に戻すの 6 秒より短く）
  showToast((ok.length === 1 ? 'ゴミ箱へ移動' : `${ok.length}件をゴミ箱へ移動`) + resultNote(failed, redone), () => untrash(ok));
}
// 元に戻す：元のフォルダへ。1件は PUT /raindrop/{id}、複数は「フォルダへ移動」の戻しと同じ流れ
async function untrash(back){
  back.forEach(b => restoring.add(b.x));
  untrashLocal(back);
  const fails = [];
  if(back.length === 1){
    const b = back[0];
    try{ await api(`/raindrop/${b.x.i}`, { method:'PUT', body:{ collection:{ $id:b.k } } }); }
    catch(e){ fails.push(b); }
  }else{
    for(const [k, part] of groupBy(back, b => b.k)){
      const xs = part.map(b => b.x);
      const r = await sendMany(new Map([[TRASH, xs]]), { collection:{ $id:k } }, () => ({ collection:{ $id:k } }),
        srv => srv.collection && srv.collection.$id === k, '戻しています');
      fails.push(...part.filter(b => r.failed.includes(b.x)));
    }
  }
  back.forEach(b => restoring.delete(b.x));
  // 戻せなかったものは、手元もゴミ箱に入った見え方に戻す
  if(fails.length) trashLocal(fails.map(b => b.x));
  syncSelection();
  if(peekItem) updatePeekNav(peekItem);   // 戻し終わったので、ゴミ箱のボタンを押せるように
  showToast(fails.length ? `${fails.length}件は戻せませんでした` : '元に戻しました', null);
}
// プレビュー：見ている1件を送って、次へ進む。いちばん最後の1件なら、プレビューを閉じて一覧に戻す
function trashPeek(){
  const it = peekItem;
  if(!canTrash(it)) return;
  const i = order.indexOf(it);
  if(i < 0 || i >= poolSize - 1) closePeek(); else stepPeek(1);
  trashItems([it]);   // 進んだあとに山から外す（位置の表示はそこで合わせ直す）
}
// 選んでいるものをまとめて送る（開いている画面を閉じ、送ったものは選択から外す）
function trashSelected(){
  if(!selected.size) return;
  const items = [...selected];
  // 送ったものは選択から外す（ゴミ箱のものが選ばれたまま残って、タグなどが送られないように）
  popKind = '';
  items.forEach(x => setPicked(x, false));
  syncSelection();
  trashItems(items);
}
// ---- 重複をまとめてゴミ箱へ（重複して保存したものの画面の ≡ メニュー。本人、11/22）----
// まとまりごとに1件だけ残し、ほかを送る。残すのはタグがいちばん多いもの、同じ数なら最初に保存したもの（dupPool はまとまりの中が古い順）。
// 送るほうにしか付いていないタグは、送る前に残すほうへ足す（タグが消えないように）
function dupPlan(){
  const groups = new Map();
  dupPool().forEach(it => { const k = dupKey(it), g = groups.get(k); if(g) g.push(it); else groups.set(k, [it]); });
  const plan = [];
  groups.forEach(g => {
    const keep = g.reduce((a, b) => (b.g || []).length > (a.g || []).length ? b : a);
    const drop = g.filter(x => x !== keep && canTrash(x));
    if(!drop.length) return;
    const have = new Set(keep.g || []);
    const miss = [...new Set(drop.flatMap(x => x.g || []))].filter(t => !have.has(t));
    plan.push({ keep, drop, miss });
  });
  return plan;
}
function paintDupTrash(){
  const n = dupPlan().reduce((s, p) => s + p.drop.length, 0);
  $('dupTrashVal').textContent = n ? `${n}件` : 'なし';
  $('dupTrash').disabled = !n;
}
async function trashDups(){
  setMenu(false);
  const plan = dupPlan();
  if(!plan.length) return;
  const add = plan.filter(p => p.miss.length);
  let bad = new Set();
  if(add.length){
    const keeps = add.map(p => p.keep), before = new Map(keeps.map(x => [x, (x.g || []).slice()]));
    add.forEach(p => { p.keep.g = [...(p.keep.g || []), ...p.miss]; });
    afterLocalChange(keeps);
    const failed = await putEach(keeps, x => ({ tags:x.g }), 'タグをまとめています');
    revertFailed(failed, x => { x.g = before.get(x); });
    bad = new Set(failed);
    if(keeps.length > failed.length) bkAdd(keeps.length - failed.length);
  }
  // タグを足せなかったまとまりは送らない（タグが消えるので）。元に戻すはゴミ箱から戻すだけで、足したタグはそのまま
  trashItems(plan.filter(p => !bad.has(p.keep)).flatMap(p => p.drop));
}
$('dupTrash').addEventListener('click', trashDups);

// ---- サムネイルが出ないものに、リンク先のページの画像をまとめて付ける（その画面の ≡ メニュー。本人、11/22）----
// よそのサイトのページはブラウザからは読めないので、Raindrop にリンク先を読んでもらう（GET /import/url/parse）。
// 返ってきた画像（media の最初の画像）のアドレスを、そのまま表紙にする（画像そのものは上げない）。
// 読めなかったときの media は "<screenshot>" という文字だけなので、http で始まるものだけを使う。今の表紙と同じものは付けない
let ntBusy = false;
function paintNtFetch(){
  const n = ntPool().filter(it => it.k !== TRASH).length;
  $('ntFetchVal').textContent = ntBusy ? '探しています…' : n ? `${n}件` : 'なし';
  $('ntFetch').disabled = ntBusy || !n;
}
async function pageImage(it){
  for(let t = 0; ; t++){
    try{
      const r = await api(`/import/url/parse?url=${encodeURIComponent(it.l)}`);
      const x = (r && r.item) || {};
      const list = [x.cover, ...(x.media || []).filter(m => m && (!m.type || m.type === 'image')).map(m => m.link)];
      return list.find(u => /^https?:\/\//.test(u || '') && u !== it.c) || '';
    }catch(e){
      if(e.message === 'rate' && t < 4){ await sleep(15000); continue; }
      return '';
    }
  }
}
async function fetchNtCovers(){
  setMenu(false);
  if(ntBusy) return;
  const list = ntPool().filter(it => it.k !== TRASH && /^https?:\/\//.test(it.l || ''));
  if(!list.length) return;
  ntBusy = true;
  const found = new Map();
  let done = 0;
  await runLimited(list, 2, async it => {
    const u = await pageImage(it);
    if(u) found.set(it, u);
    done++;
    showToast(`リンク先の画像を探しています… ${done}/${list.length}`, null);
  });
  const items = [...found.keys()];
  const before = new Map(items.map(x => [x, x.c]));
  items.forEach(x => { x.c = found.get(x); });
  afterLocalChange(items, { media:true });
  const failed = items.length ? await putEach(items, x => ({ cover:x.c }), '画像を付けています') : [];
  if(failed.length){ failed.forEach(x => { x.c = before.get(x); }); afterLocalChange(failed, { media:true }); }
  ntBusy = false;
  const ok = items.filter(x => !failed.includes(x));
  if(ok.length) bkAdd(ok.length);
  const miss = list.length - items.length;
  if(!ok.length){ showToast(failed.length ? `付けられませんでした（${whyText(failed.err)}）` : 'リンク先に画像が見つかりませんでした', null); return; }
  showToast(`${ok.length}件にリンク先の画像を付けました` + (miss ? `（${miss}件は見つかりませんでした）` : '') + (failed.length ? `・${failed.length}件は保存できませんでした` : ''),
    () => restoreCovers(ok, before));
}
// 元に戻す：前の表紙に戻す
async function restoreCovers(list, before){
  list.forEach(x => { x.c = before.get(x); });
  afterLocalChange(list, { media:true });
  const failed = await putEach(list, x => ({ cover:x.c || '' }), '戻しています');
  showToast(failed.length ? `${failed.length}件は戻せませんでした` : '元に戻しました', null);
}
$('ntFetch').addEventListener('click', fetchNtCovers);

$('peekTrash').innerHTML = icon('trash');
$('selTrash').innerHTML = icon('trash');
$('peekTrash').addEventListener('click', trashPeek);
$('selTrash').addEventListener('click', trashSelected);

// ---- 複数選択：カード左上のチェックで選び、下のバーからまとめて移動・タグ付け ----
const selected = new Set();
let lastPick = null;
const selBar = $('selBar'), selPop = $('selPop');
let popKind = '';                  // 下のバーの上に開いている画面：'' | 'move' | 'tag'
let popText = { text:'' };

function setPicked(it, on){
  if(on) selected.add(it); else selected.delete(it);
  const c = cardOf.get(it);
  if(c) c.classList.toggle('picked', on);
}
// range = Shift を押しながら：前に押したものから今のものまでをまとめて選ぶ
function pickCard(it, range){
  if(range && lastPick && lastPick !== it){
    const a = order.indexOf(lastPick), b = order.indexOf(it);
    if(a >= 0 && b >= 0) order.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => { if(cardOf.has(x)) setPicked(x, true); });
  }else setPicked(it, !selected.has(it));
  lastPick = it;
  syncSelection();
}
function clearSelection(){
  [...selected].forEach(x => setPicked(x, false));
  lastPick = null;
  syncSelection();
}
function syncSelection(){
  const n = selected.size;
  document.body.classList.toggle('selecting', n > 0);
  selBar.hidden = !n;
  $('selSpacer').hidden = !n;   // 下のバーに最後のカードが隠れないように（一覧全体の並べ直しは起こさない）
  $('selCount').textContent = `${n.toLocaleString()}件`;
  $('selTrash').disabled = ![...selected].some(canTrash);   // 全部がゴミ箱のもの（か戻している途中）なら押せない
  if(!n){ popKind = ''; }
  renderSelPop();
}
function renderSelPop(){
  const keepY = selPop.scrollTop;
  selPop.hidden = !popKind;
  $('selMove').setAttribute('aria-pressed', String(popKind === 'move'));
  $('selTag').setAttribute('aria-pressed', String(popKind === 'tag'));
  selPop.innerHTML = '';
  if(!popKind) return;
  const items = [...selected];
  if(popKind === 'move'){
    selPop.append(el('div', 'ed-h', `${items.length}件の移動先`));
    const p = folderPicker(null, id => { popKind = ''; renderSelPop(); moveMany(items, id); });
    selPop.append(p.box);
    if(canHover) p.search.focus();
    return;
  }
  // タグ：押すと、選んだもの全部に付く。全部に付いているタグを押すと全部から外れる
  // （一部にだけ付いているタグは枠だけ色を付ける）
  const all = name => items.every(x => (x.g || []).includes(name));
  const some = name => items.some(x => (x.g || []).includes(name));
  const ch = tagChooser({
    text:popText,
    placeholder:'絞り込む・新しいタグ（Enter）',
    isOn: all,
    isPartial: some,
    onPick: name => { (all(name) ? removeTagsMany(items, [name]) : addTagsMany(items, [name])); },
    onNew: name => addTagsMany(items, [name])
  });
  selPop.append(el('div', 'ed-h', `${items.length}件のタグ（押すと全部に付く／もう一度で外れる）`), ch.box);
  selPop.scrollTop = keepY;
  if(canHover){ ch.input.focus(); ch.input.setSelectionRange(ch.input.value.length, ch.input.value.length); }
}
$('selMove').addEventListener('click', () => { popKind = popKind === 'move' ? '' : 'move'; renderSelPop(); });
$('selTag').addEventListener('click', () => { popKind = popKind === 'tag' ? '' : 'tag'; renderSelPop(); });
$('selAll').addEventListener('click', () => { allCards().forEach(c => setPicked(c._item, true)); syncSelection(); });
$('selClose').addEventListener('click', clearSelection);

// ---- カードのメニュー（長押し・右クリック）----
// スマホ：カードを長押しで選択を始める
// 類似画像の画面では、長押しでカードの近くに［プレビュー］［選択］を出す（PC のマウスでも）。選んでいる最中は、今どおり選択の切り替え
// 元の一覧の分けた X の投稿は、長押しで［選択］と、すき間のあとに［同じツイートの画像をスタック］（オンならチェック）を出す（PC のマウスでも）
// PC の右クリックは、ブラウザのメニューの代わりに全部の操作を出す（Shift を押しながらならブラウザのメニュー）
const canFold = it => !sim && !views.length && postOf(it).length >= 2;
let press = null;
grid.addEventListener('pointerdown', e => {
  const c = e.target.closest('.card');
  if(!c || c._hero || e.target.closest('.rd-btn, .sel-box')) return;
  if(e.pointerType !== 'touch' && !((sim || canFold(c._item)) && e.pointerType === 'mouse' && e.button === 0)) return;
  c._long = false;
  const x = e.clientX, y = e.clientY;
  press = { c, x, y, t:setTimeout(() => {
    if((sim || canFold(c._item)) && !selected.size){ c._long = true; openPressMenu(c, x, y, 'press'); return; }
    if(e.pointerType !== 'touch') return;
    c._long = true;
    pickCard(c._item, false);
    if(navigator.vibrate) navigator.vibrate(10);
  }, 450) };
});
const pressMenu = $('pressMenu');
// サイトの名前（「〜で開く」に使う）。知っているサイトは呼び名で、ほかはドメイン
const SITE_NAMES = { 'x.com':'Twitter', 'twitter.com':'Twitter', 'pixiv.net':'pixiv', 'pinterest.com':'Pinterest', 'pinterest.jp':'Pinterest', 'youtube.com':'YouTube', 'youtu.be':'YouTube', 'bsky.app':'Bluesky', 'instagram.com':'Instagram', 'tumblr.com':'Tumblr', 'deviantart.com':'DeviantArt', 'artstation.com':'ArtStation', 'reddit.com':'Reddit' };
function siteLabel(it){
  let h = '';
  try{ h = new URL(it.l).hostname.replace(/^(www|m|mobile)\./, ''); }catch(e){}
  const key = Object.keys(SITE_NAMES).find(k => h === k || h.endsWith('.' + k));
  return key ? SITE_NAMES[key] : (h || 'サイト');
}
// カードに出ている画像の、元の大きさの URL（縮小サービスを通していれば元へ、X は large）。画像がなければ ''
function fullImageUrl(c){
  const im = c && c.querySelector('img.thumb');
  let u = im && (im.currentSrc || im.src) || '';
  if(!u) return '';
  try{
    const p = new URL(u);
    if(p.hostname === 'wsrv.nl' && p.searchParams.get('url')) u = p.searchParams.get('url');
    else if(p.hostname === 'rdl.ink' && p.pathname.startsWith('/render/')) u = decodeURIComponent(p.pathname.slice(8));   // Raindrop の画像の中継
  }catch(e){}
  return isX(u) ? bigUrl(u) : u;
}
// 画像を読み込む。直接読めない（CORS）サイトは縮小サービスを通して元の大きさで
async function imageBlob(u){
  try{ const r = await fetch(u, { referrerPolicy:'no-referrer' }); if(r.ok) return await r.blob(); }catch(e){}
  const r = await fetch(`https://wsrv.nl/?url=${encodeURIComponent(u)}`);
  if(!r.ok) throw new Error('http');
  return r.blob();
}
// クリップボードは PNG しか受け取らないことが多いので、PNG に描き直す
async function pngBlob(b){
  if(b.type === 'image/png') return b;
  const bmp = await createImageBitmap(b);
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  cv.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((res, rej) => cv.toBlob(x => x ? res(x) : rej(new Error('png')), 'image/png'));
}
function copyImage(c){
  const u = fullImageUrl(c); if(!u) return;
  // ClipboardItem は押した直後に作る（Safari は、待ったあとに作ると断る）
  navigator.clipboard.write([new ClipboardItem({ 'image/png':imageBlob(u).then(pngBlob) })])
    .then(() => showToast('画像をコピーしました', null), () => showToast('画像をコピーできませんでした', null));
}
async function saveImage(c){
  const u = fullImageUrl(c); if(!u) return;
  try{
    const b = await imageBlob(u);
    const ext = (b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const base = (decodeURIComponent(new URL(u).pathname.split('/').pop() || '') || 'image').replace(/\.\w+$/, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = `${base}.${ext}`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }catch(e){ showToast('画像を保存できませんでした', null); }
}
// kind：'press' 長押し（短い） / 'context' 右クリック（全部）
function openPressMenu(c, x, y, kind){
  const it = c._item, full = kind === 'context';
  const hasImg = !!fullImageUrl(c) && !c.querySelector('video');
  const item = (label, fn) => {
    const b = el('button', 'menu-item', label); b.type = 'button'; b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => { closePressMenu(); fn(); });
    return b;
  };
  const rows = [];
  if(!full && sim) rows.push(item('プレビュー', () => openPeek(it)));
  rows.push(item('選択', () => pickCard(it, false)));
  if(full){
    if(hasImg){
      rows.push(item('画像をコピー', () => copyImage(c)));
      rows.push(item('画像を保存', () => saveImage(c)));
      rows.push(item('類似画像', () => showSimilar(it)));
    }
    rows.push(item(`${siteLabel(it)}で開く`, () => window.open(it.l, '_blank', 'noopener')));
    rows.push(item('Raindropで開く', () => window.open(raindropUrl(it), '_blank', 'noopener')));
    if(canTrash(it)) rows.push(item('ゴミ箱へ移動', () => { if(selected.has(it)){ setPicked(it, false); syncSelection(); } trashItems([it]); }));
  }
  if(canFold(it)){
    // すき間のあとに、オン・オフで切り替える設定として（オンならチェック）
    rows.push(el('div', 'menu-gap'));
    const f = item('同じツイートの画像をスタック', () => setFold(it, !isFolded(it)));
    f.setAttribute('role', 'menuitemcheckbox'); f.setAttribute('aria-checked', String(isFolded(it)));
    rows.push(f);
  }
  pressMenu.replaceChildren(...rows);
  pressMenu._card = c;
  pressMenu.classList.toggle('ctx', full);
  pressMenu.hidden = false;
  const w = pressMenu.offsetWidth, h = pressMenu.offsetHeight;
  let left, top;
  if(full){
    // 右クリック：ポインタの右下に。入りきらなければ左・上に
    left = x + w <= innerWidth - 8 ? x : Math.max(8, x - w);
    top = y + h <= innerHeight - 8 ? y : Math.max(8, y - h);
  }else{
    left = Math.max(12, Math.min(x - w / 2, innerWidth - w - 12));
    // 指の下に出す。入りきらなければ上に
    top = y + 16 + h <= innerHeight - 12 ? y + 16 : Math.max(12, y - 16 - h);
    if(navigator.vibrate) navigator.vibrate(10);
  }
  pressMenu.style.left = (left + scrollX) + 'px';
  pressMenu.style.top = (top + scrollY) + 'px';
}
function closePressMenu(){ pressMenu.hidden = true; pressMenu._card = null; }
// 外を押したら閉じるだけ（後ろのカードは開かない）。長押しを離したときのクリックは、カードの方で無視する
document.addEventListener('click', e => {
  if(pressMenu.hidden || e.target.closest('#pressMenu')) return;
  const c = e.target.closest('.card');
  if(c && c === pressMenu._card && c._long) return;
  e.preventDefault(); e.stopPropagation(); closePressMenu();
}, true);
const endPress = () => { if(press){ clearTimeout(press.t); press = null; } };
grid.addEventListener('pointermove', e => { if(press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) endPress(); });
grid.addEventListener('pointerup', endPress);
grid.addEventListener('pointercancel', endPress);
// 右クリック：カードのメニュー。指の長押しで来たもの（Android など）は止めるだけ。上の大きい画像と Shift＋右クリックはブラウザのメニュー
grid.addEventListener('contextmenu', e => {
  const c = e.target.closest('.card');
  if(!c) return;
  if(e.pointerType === 'touch' || (press && press.c._long)){ e.preventDefault(); return; }
  if(c._hero || e.shiftKey) return;
  e.preventDefault();
  endPress();
  openPressMenu(c, e.clientX, e.clientY, 'context');
});
