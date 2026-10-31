/* 複数選択（selected pickCard 下のバー）と長押しのメニュー。
   後半は画像の貼り付け（情報の画面のサムネ）とキー操作（keydown）。② で置き場所を決め直す */
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

// 編集パネルを開いているとき：画像を貼り付けたらサムネにする（アドレスの貼り付けはサムネの画面で）
document.addEventListener('paste', e => {
  if(!peek.open || !peekItem || edPanel.hidden) return;
  const t = e.target, inCover = t && t.id === 'edCoverUrl';
  if(t && /^(input|textarea)$/i.test(t.tagName) && !inCover) return;
  const f = [...(e.clipboardData.files || [])].find(x => x.type.startsWith('image/'));
  if(f){ e.preventDefault(); edView = ''; uploadCover(peekItem, f); return; }
  const u = (e.clipboardData.getData('text') || '').trim();
  if(edView === 'cover' && !inCover && /^https?:\/\/\S+$/.test(u)){ e.preventDefault(); edView = ''; setCover(peekItem, u); }
});

// キー操作（プレビュー中と一覧とで分ける）
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && !pressMenu.hidden){ closePressMenu(); return; }
  if(e.key === 'Escape' && !viewMenu.hidden){ setMenu(false); return; }
  if(e.key === 'Escape' && !sortMenu.hidden){ setSortMenu(false); return; }
  if(cropOpen){
    if(e.key === 'Escape'){ e.preventDefault(); cancelCrop(); }
    else if(e.key === 'Enter' && cropRect){ e.preventDefault(); cropSearch(); }
    return;
  }
  if(e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = ['input', 'select', 'textarea'].includes(tag);
  if(peek.open){
    if(typing) return;
    if(e.key === 'ArrowLeft' || e.key === 'ArrowRight'){ e.preventDefault(); stepPeek(e.key === 'ArrowLeft' ? -1 : 1); return; }
    if(e.key === 'e' || e.key === 'E'){ e.preventDefault(); setEditOpen(!editOpen); return; }
    if(e.key === '0'){ e.preventDefault(); resetZoom(true); return; }
    if(e.key === 'ArrowUp' || e.key === 'ArrowDown'){ e.preventDefault(); setBright(bright + (e.key === 'ArrowUp' ? 0.1 : -0.1)); saveBright(); return; }
    if(e.key === 'b' || e.key === 'B'){ e.preventDefault(); setBright(1); saveBright(); return; }
    if((e.key === 'l' || e.key === 'L') && peekItem){ e.preventDefault(); cycleLike(peekItem); return; }
    if(e.key === 'r' || e.key === 'R'){ e.preventDefault(); rotatePeek(e.shiftKey ? -1 : 1); return; }
    if(e.key === 'f' || e.key === 'F'){ e.preventDefault(); flipPeek(); return; }
    if((e.key === 's' || e.key === 'S') && peekItem){ e.preventDefault(); showSimilar(peekItem); return; }
    if((e.key === 'q' || e.key === 'Q') && !$('peekHq').hidden){ e.preventDefault(); $('peekHq').click(); return; }
    if(e.key === '+' || e.key === '=' || e.key === '-'){
      e.preventDefault();
      const r = peekBody.getBoundingClientRect();
      zoomAt(e.key === '-' ? 1 / 1.25 : 1.25, r.left + r.width / 2, r.top + r.height / 2);
      return;
    }
    if(e.key === 't' || e.key === 'T'){ e.preventDefault(); if(!editOpen) setEditOpen(true); const i = $('edTagInput'); if(i) i.focus(); return; }
    if(/^[1-9]$/.test(e.key) && pins[Number(e.key) - 1] && peekItem){ e.preventDefault(); toggleTag(peekItem, pins[Number(e.key) - 1]); return; }
    return;
  }
  if(typing || dlg.open || filterDlg.open || setDlg.open) return;
  if(e.key === 'Escape' && selected.size){ e.preventDefault(); if(popKind){ popKind = ''; renderSelPop(); } else clearSelection(); return; }
  if(e.key === 'Escape' && views.length){ e.preventDefault(); backUI(); return; }
  // 一段奥の画面では並び順は使わない。絞り込みは似た画像の画面だけ（似た画像の条件を編集する）
  if(views.length && (/^[rR]$/.test(e.key) || (!sim && /^[fF\/]$/.test(e.key)))) return;
  if(e.key === 'f' || e.key === 'F'){ e.preventDefault(); openFilter(); return; }
  if(e.key === '/'){ e.preventDefault(); openFilter('other'); return; }
  if(e.key === 'c' || e.key === 'C') toggleCap();
  if(e.key === 'h' || e.key === 'H') toggleCur();
  if(e.key === 'r' || e.key === 'R'){ e.preventDefault(); shuffle(); }
  if(e.key === '1') setSize(170);
  if(e.key === '2') setSize(250);
  if(e.key === '3') setSize(380);
});

