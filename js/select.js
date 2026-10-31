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

// スマホ：カードを長押しで選択を始める
// 似た画像の画面では、長押しでカードの近くに［プレビュー］［選択］を出す（PC のマウスでも）。選んでいる最中は、今どおり選択の切り替え
let press = null;
grid.addEventListener('pointerdown', e => {
  const c = e.target.closest('.card');
  if(!c || c._hero || e.target.closest('.rd-btn, .sel-box')) return;
  if(e.pointerType !== 'touch' && !(sim && e.pointerType === 'mouse' && e.button === 0)) return;
  c._long = false;
  const x = e.clientX, y = e.clientY;
  press = { c, x, y, t:setTimeout(() => {
    if(sim && !selected.size){ c._long = true; openPressMenu(c, x, y); return; }
    if(e.pointerType !== 'touch') return;
    c._long = true;
    pickCard(c._item, false);
    if(navigator.vibrate) navigator.vibrate(10);
  }, 450) };
});
const pressMenu = $('pressMenu');
function openPressMenu(c, x, y){
  pressMenu._card = c;
  pressMenu.hidden = false;
  const w = pressMenu.offsetWidth, h = pressMenu.offsetHeight;
  const left = Math.max(12, Math.min(x - w / 2, innerWidth - w - 12));
  // 指の下に出す。入りきらなければ上に
  const top = y + 16 + h <= innerHeight - 12 ? y + 16 : Math.max(12, y - 16 - h);
  pressMenu.style.left = (left + scrollX) + 'px';
  pressMenu.style.top = (top + scrollY) + 'px';
  if(navigator.vibrate) navigator.vibrate(10);
}
function closePressMenu(){ pressMenu.hidden = true; pressMenu._card = null; }
$('pressPeek').addEventListener('click', () => { const c = pressMenu._card; closePressMenu(); if(c) openPeek(c._item); });
$('pressPick').addEventListener('click', () => { const c = pressMenu._card; closePressMenu(); if(c) pickCard(c._item, false); });
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
grid.addEventListener('contextmenu', e => { if(e.target.closest('.card') && (selected.size || (press && press.c._long))) e.preventDefault(); });
