/* まとめて変える（moveMany addTagsMany removeTagsMany restoreTags）。
   後半は情報の画面の開け閉めと大きさ（applyEditOpen layoutEdit つまみ・幅）。② で edit.js に寄せる */
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
  const list = items.filter(x => x.k !== to);
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

let sheetFull = store.get('sheetfull', false);   // スマホ：画面いっぱいに広げているか
let sideW = store.get('sidew', 380);              // PC：左パネルの幅
let tagSort = store.get('tagsort', 'count');      // 'count' よく使う順 | 'name' 名前順
let edFilter = { text:'' }, edFilterFor = null;
let sheetDragH = 0;                               // つまみをドラッグ中の高さ
const wideUI = () => window.innerWidth >= 760;

// later = 前後に送ったとき：画像を先に描かせて、パネルの作り直しは次の描画に回す
// （続けて送ったときは最後の1回だけ作る）
let editRaf = 0;
function applyEditOpen(later){
  edPanel.hidden = !editOpen || !peekItem;
  peek.classList.toggle('editing', !edPanel.hidden);
  $('peekEdit').setAttribute('aria-pressed', String(editOpen));
  cancelAnimationFrame(editRaf);
  if(!edPanel.hidden){
    layoutEdit();
    // 作り直すまでの間は、前のブックマークのパネルを押せないようにしておく
    if(later){ edPanel.classList.add('stale'); editRaf = requestAnimationFrame(() => requestAnimationFrame(renderEdit)); }
    else renderEdit();
  }
  else ['--edit-h', '--edit-l', '--toast-b'].forEach(k => peek.style.removeProperty(k));
}
function setEditOpen(v){ editOpen = v; store.set('editing', v); edView = ''; if(v) setBare(false); applyEditOpen(); }
// パネルの位置と大きさを決めて、画像エリア・トーストの位置もそれに合わせる
function layoutEdit(){
  if(edPanel.hidden) return;
  const wide = wideUI();
  edPanel.classList.toggle('side', wide);
  edPanel.classList.toggle('sheet', !wide);
  edPanel.classList.toggle('full', !wide && sheetFull && !sheetDragH);
  if(wide){
    const w = Math.round(Math.min(Math.max(sideW, 280), Math.min(640, window.innerWidth - 300)));
    peek.style.setProperty('--edit-l', w + 'px');
    peek.style.setProperty('--edit-h', '0px');
    peek.style.setProperty('--toast-b', '16px');
  }else{
    const H = window.innerHeight;
    const h = Math.round(sheetDragH || (sheetFull ? H : Math.max(280, H * 0.55)));
    peek.style.setProperty('--edit-l', '0px');
    peek.style.setProperty('--edit-h', h + 'px');
    peek.style.setProperty('--toast-b', (Math.min(h, H - 70) + 12) + 'px');
  }
}
function setSheetFull(v){ sheetFull = v; store.set('sheetfull', v); layoutEdit(); }
addEventListener('resize', () => layoutEdit());

// スマホ：つまみ（と見出し）を上下にドラッグして高さを変える。離すと「半分」か「いっぱい」に吸い付く
function startSheetDrag(e){
  if(!edPanel.classList.contains('sheet')) return;
  if(e.target.closest('button, input, label, a')) return;
  e.preventDefault();
  const y0 = e.clientY, h0 = edPanel.offsetHeight, H = window.innerHeight;
  let moved = false;
  edPanel.classList.add('drag');
  const move = ev => {
    if(Math.abs(ev.clientY - y0) > 4) moved = true;
    sheetDragH = Math.min(H, Math.max(120, h0 - (ev.clientY - y0)));
    layoutEdit();
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    edPanel.classList.remove('drag');
    const h = sheetDragH; sheetDragH = 0;
    if(!moved){ setSheetFull(!sheetFull); return; }          // つまみをタップ：切り替え
    if(h < H * 0.28){ sheetFull = false; store.set('sheetfull', false); setEditOpen(false); return; }  // 下まで下ろしたら閉じる
    setSheetFull(h > H * 0.7);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
// PC：パネルの右端をドラッグして幅を変える
function startSideResize(e){
  e.preventDefault();
  const x0 = e.clientX, w0 = edPanel.offsetWidth;
  edPanel.classList.add('drag');
  const move = ev => { sideW = w0 + (ev.clientX - x0); layoutEdit(); };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    edPanel.classList.remove('drag');
    sideW = edPanel.offsetWidth; store.set('sidew', sideW);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
