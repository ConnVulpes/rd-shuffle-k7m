/* 絞り込み（makeFilter）、絞り込みの画面（renderFilterDlg）、プリセット（renderPresets） */
// ---- 絞り込み（フォルダ・タグの「含む／除く」、種類、言葉）----
// fi/fx = 含む/除くフォルダ, ti/tx = 含む/除くタグ, tm = 含むタグが複数のとき any|all
const NO_TAG = '\u0000none';
const TYPE_LABEL = { image:'画像', video:'動画', article:'記事', link:'リンク', document:'ドキュメント', audio:'音声' };
const emptyFilter = () => ({ fi:[], fx:[], ti:[], tx:[], tm:'any', type:'', q:'' });
state.filter = Object.assign(emptyFilter(), state.filter || {});
// プリセット：[{ name, f }]（この端末に保存）
let presets = store.get('presets', []);
// 並び順や「どれか／全部」の違いで別物扱いにならないように揃えて比べる
function normF(f){
  f = Object.assign(emptyFilter(), f);
  const n = a => a.map(Number).sort((x, y) => x - y);
  return JSON.stringify([n(f.fi), n(f.fx), [...f.ti].sort(), [...f.tx].sort(), f.ti.length > 1 ? f.tm : 'any', f.type || '', (f.q || '').trim()]);
}
const presetOf = f => presets.find(p => normF(p.f) === normF(f));
// プリセットの名前の初期値（除外も中身を書く）
function presetDefaultName(f){
  const parts = [filterSummary(Object.assign({}, f, { fx:[], tx:[] }))].filter(Boolean);
  const ex = [...f.fx.map(folderShort), ...f.tx.map(tagName)];
  if(ex.length) parts.push('除く ' + ex.join(' / '));
  return parts.join(' · ').slice(0, 30);
}

function unionDesc(ids){
  const s = new Set();
  ids.forEach(id => descendants(Number(id)).forEach(v => s.add(v)));
  return s;
}
const hasTag = (x, t) => t === NO_TAG ? !(x.g && x.g.length) : x.g.includes(t);
function typeOk(x, type){
  return type === 'video' ? (x.y === 'video' || (x.m || []).some(m => m.t === 'video')) : x.y === type;
}
function makeFilter(f){
  const inF = f.fi.length ? unionDesc(f.fi) : null;
  const exF = f.fx.length ? unionDesc(f.fx) : null;
  const terms = (f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return x => {
    if(inF && !inF.has(x.k)) return false;
    if(exF && exF.has(x.k)) return false;
    if(f.ti.length && !(f.tm === 'all' ? f.ti.every(t => hasTag(x, t)) : f.ti.some(t => hasTag(x, t)))) return false;
    if(f.tx.length && f.tx.some(t => hasTag(x, t))) return false;
    if(f.type && !typeOk(x, f.type)) return false;
    if(terms.length){ const h = hayOf(x); if(!terms.every(t => h.includes(t))) return false; }
    return true;
  };
}
const folderShort = id => id === -1 ? '未整理' : ((collLabel.get(id) || '').split(' / ').pop() || '（消えたフォルダ）');
const tagName = t => t === NO_TAG ? 'タグなし' : '#' + t;

// 上のバーのボタンに今の条件を短く出す
function filterSummary(f){
  const parts = [];
  if(f.fi.length) parts.push(f.fi.map(folderShort).join(' / '));
  if(f.ti.length) parts.push(f.ti.map(tagName).join(f.tm === 'all' ? ' かつ ' : ' / '));
  if(f.type) parts.push(TYPE_LABEL[f.type]);
  if(f.q) parts.push(`「${f.q}」`);
  const ex = f.fx.length + f.tx.length;
  if(ex) parts.push(`除外${ex}`);
  return parts.join(' · ');
}
// 消えたフォルダやタグを条件から外して、ボタンの表示を合わせる
function syncFilter(){
  const f = state.filter;
  if(cache){
    const fids = new Set(cache.colls.map(c => c.id)); fids.add(-1);
    const tnames = new Set(cache.tags.map(t => t.name)); tnames.add(NO_TAG);
    const keepF = a => a.filter(id => fids.has(Number(id))).map(Number);
    const keepT = a => a.filter(t => tnames.has(t));
    const before = JSON.stringify(f);
    f.fi = keepF(f.fi); f.fx = keepF(f.fx); f.ti = keepT(f.ti); f.tx = keepT(f.tx);
    if(JSON.stringify(f) !== before) store.set('filter', f);
  }
  const sum = filterSummary(f);
  const pre = sum && presetOf(f);   // プリセットと同じ条件なら、その名前を出す
  const label = $('filterLabel');
  label.textContent = pre ? pre.name : (sum || 'すべて');
  label.className = sum ? '' : 'muted';
  $('filterBtn').classList.toggle('active', !!sum);
  $('filterBtn').title = (sum ? '絞り込み中：' + sum : 'すべてを表示中') + '（F で開く）';
}

// ---- 絞り込み画面 ----
const filterDlg = $('filterDlg'), fdList = $('fdList'), fdSearch = $('fdSearch');
let draft = emptyFilter(), fdTab = 'folder';
// fdFor：今開いている絞り込みの画面が、元の一覧の条件（'list'）と似た画像の条件（'sim'）のどちらを変えるか
let fdFor = 'list';
const cloneF = f => JSON.parse(JSON.stringify(f));

function toggleIn(listIn, listEx, v, which){
  // which: 'in' | 'ex'。同じものをもう一度押すと解除
  const i = listIn.indexOf(v), e = listEx.indexOf(v);
  if(i >= 0) listIn.splice(i, 1);
  if(e >= 0) listEx.splice(e, 1);
  if(which === 'in' && i < 0) listIn.push(v);
  if(which === 'ex' && e < 0) listEx.push(v);
}
function triButtons(isIn, isEx, onIn, onEx){
  const box = el('span', 'tri');
  [['inc', '含む', isIn, onIn], ['exc', '除く', isEx, onEx]].forEach(([cls, label, on, fn]) => {
    const b = el('button', cls, label); b.type = 'button'; b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', fn);
    box.append(b);
  });
  return box;
}
let fdPickedOpen = false;
function fitPicked(){
  const picked = $('fdPicked');
  picked.querySelectorAll('.chip-more').forEach(x => x.remove());
  const chips = [...picked.querySelectorAll('.chip')];
  chips.forEach(c => { c.hidden = false; });
  picked.classList.toggle('open', fdPickedOpen);
  if(chips.length < 2 || !picked.clientWidth) return;
  const more = el('button', 'chip-more'); more.type = 'button';
  if(fdPickedOpen){
    more.textContent = '折りたたむ';
    more.addEventListener('click', () => { fdPickedOpen = false; fitPicked(); });
    picked.append(more);
    return;
  }
  const right = picked.getBoundingClientRect().right - parseFloat(getComputedStyle(picked).paddingRight);
  if(chips[chips.length - 1].getBoundingClientRect().right <= right + 0.5) return;   // 全部入っている
  let n = 0;
  chips.forEach((c, i) => { if(i && (n || c.getBoundingClientRect().right > right - 64)){ c.hidden = true; n++; } });
  more.textContent = `＋${n}`; more.title = 'すべて表示';
  more.addEventListener('click', () => { fdPickedOpen = true; fitPicked(); });
  picked.append(more);
}
function renderFilterDlg(){
  const f = draft;
  // 選んでいる条件（押すと外れる）
  const picked = $('fdPicked');
  picked.innerHTML = '';
  const chip = (text, ex, onRemove) => {
    const c = el('button', 'chip' + (ex ? ' ex' : ''), text); c.type = 'button'; c.title = '外す';
    c.addEventListener('click', () => { onRemove(); renderFilterDlg(); });
    picked.append(c);
  };
  f.fi.forEach(id => chip(folderShort(id), false, () => toggleIn(f.fi, f.fx, id, '')));
  f.ti.forEach(t => chip(tagName(t), false, () => toggleIn(f.ti, f.tx, t, '')));
  f.fx.forEach(id => chip('除く ' + folderShort(id), true, () => toggleIn(f.fi, f.fx, id, '')));
  f.tx.forEach(t => chip('除く ' + tagName(t), true, () => toggleIn(f.ti, f.tx, t, '')));
  if(f.type) chip(TYPE_LABEL[f.type], false, () => { f.type = ''; });
  if(f.q) chip(`「${f.q}」`, false, () => { f.q = ''; $('fdQ').value = ''; });
  if(!picked.children.length) picked.append(el('span', 'none', '条件なし（すべてを表示）'));
  fitPicked();

  document.querySelectorAll('#fdTabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === fdTab)));
  $('fdListPane').hidden = fdTab === 'other';
  $('fdOtherPane').hidden = fdTab !== 'other';
  $('fdMatch').hidden = fdTab !== 'tag';
  document.querySelectorAll('#fdMatchSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.match === f.tm)));
  document.querySelectorAll('#fdTypes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === f.type)));

  if(fdTab !== 'other'){
    fdSearch.placeholder = fdTab === 'folder' ? 'フォルダを探す' : 'タグを探す';
    const q = fdSearch.value.trim().toLowerCase();
    const y = fdList.scrollTop;
    fdList.innerHTML = '';
    const rows = [];
    if(fdTab === 'folder'){
      const unsorted = { id:-1, label:'未整理', count: folderCount.get(-1) || 0 };
      [unsorted, ...(cache ? cache.colls.map(c => ({ id:c.id, label:c.label, count:folderCount.get(c.id) || 0 })) : [])]
        .forEach(c => rows.push({ key:c.id, label:c.label, count:c.count, inL:f.fi, exL:f.fx }));
    }else{
      const none = cache ? cache.items.filter(x => !(x.g && x.g.length)).length : 0;
      [{ name:NO_TAG, count:none }, ...(cache ? cache.tags : [])]
        .forEach(t => rows.push({ key:t.name, label:t.name === NO_TAG ? 'タグなし' : t.name, count:t.count, inL:f.ti, exL:f.tx }));
    }
    rows.filter(r => !q || r.label.toLowerCase().includes(q)).forEach(r => {
      const isIn = r.inL.includes(r.key), isEx = r.exL.includes(r.key);
      const row = el('div', 'fd-row' + (isIn ? ' in' : isEx ? ' ex' : ''));
      const nm = el('span', 'nm');
      const segs = r.label.split(' / ');
      if(segs.length > 1) nm.append(el('span', 'path', segs.slice(0, -1).join(' / ') + ' / '), segs[segs.length - 1]);
      else nm.textContent = r.label;
      nm.title = r.label;
      row.append(nm, el('span', 'cnt', r.count.toLocaleString()), triButtons(isIn, isEx,
        () => { toggleIn(r.inL, r.exL, r.key, 'in'); renderFilterDlg(); },
        () => { toggleIn(r.inL, r.exL, r.key, 'ex'); renderFilterDlg(); }));
      fdList.append(row);
    });
    if(!fdList.children.length){ const n = el('div', 'none', '見つかりません'); n.style.padding = '10px 12px'; fdList.append(n); }
    fdList.scrollTop = y;
  }
  // 似た画像の条件のときは、今の似た画像の並び（押した画像を除く）の中で数える
  const hit = !cache ? 0 : fdFor === 'sim' && sim ? sim.list.filter(x => x !== sim.center).filter(makeFilter(f)).length : cache.items.filter(makeFilter(f)).length;
  $('fdHit').textContent = `該当 ${hit.toLocaleString()}件`;
  if(!presetNaming) renderPresets();   // 名前を入れている途中は作り直さない（入力が消えないように）
}

// ---- 絞り込みのプリセット（名前を付けて保存。押すとすぐその条件にする）----
let presetEdit = false, presetNaming = false;
const savePresets = () => { store.set('presets', presets); settingsChanged(); };
function renderPresets(){
  const box = $('fdPresets');
  box.innerHTML = '';
  if(presetNaming){
    const input = el('input', 'fd-pre-name'); input.type = 'text'; input.maxLength = 30; input.enterKeyHint = 'done';
    input.placeholder = 'プリセットの名前';
    input.value = presetDefaultName(draft);
    const ok = el('button', 'fd-pre-ok', '保存'); ok.type = 'button';
    const no = el('button', 'fd-pre-cancel', 'やめる'); no.type = 'button';
    const done = () => { presetNaming = false; renderPresets(); };
    const save = () => {
      const name = input.value.trim() || presetDefaultName(draft) || '名前なし';
      const p = { name, f:cloneF(draft) };
      const i = presets.findIndex(x => x.name === name);   // 同じ名前なら上書き
      if(i >= 0) presets[i] = p; else presets.push(p);
      savePresets();
      syncFilter();
      done();
    };
    ok.addEventListener('click', save);
    no.addEventListener('click', done);
    input.addEventListener('keydown', e => {
      if(e.key === 'Enter'){ e.preventDefault(); save(); }
      if(e.key === 'Escape'){ e.preventDefault(); done(); }
    });
    box.append(input, ok, no);
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return;
  }
  box.append(el('span', 'fd-pre-lab', 'プリセット'));
  const cur = normF(draft);
  presets.forEach((p, i) => {
    const b = el('button', 'fd-pre' + (presetEdit ? ' del' : ''), p.name); b.type = 'button';
    b.title = presetEdit ? `「${p.name}」を削除` : (filterSummary(Object.assign(emptyFilter(), p.f)) || 'すべて');
    b.setAttribute('aria-pressed', String(!presetEdit && normF(p.f) === cur));
    b.addEventListener('click', () => {
      if(presetEdit){ presets.splice(i, 1); savePresets(); syncFilter(); if(!presets.length) presetEdit = false; renderPresets(); return; }
      draft = Object.assign(emptyFilter(), cloneF(p.f));
      $('fdQ').value = draft.q || '';
      applyFilterDlg();
    });
    box.append(b);
  });
  if(presetEdit){
    const fin = el('button', 'fd-pre-edit', '完了'); fin.type = 'button';
    fin.addEventListener('click', () => { presetEdit = false; renderPresets(); });
    box.append(fin);
    return;
  }
  const add = el('button', 'fd-pre-add', '＋ 今の条件を保存'); add.type = 'button';
  add.disabled = !filterSummary(draft);
  add.title = add.disabled ? '条件を選ぶと保存できます' : '今選んでいる条件に名前を付けて保存';
  add.addEventListener('click', () => { presetNaming = true; renderPresets(); });
  box.append(add);
  if(presets.length){
    const ed = el('button', 'fd-pre-edit', '削除…'); ed.type = 'button';
    ed.addEventListener('click', () => { presetEdit = true; renderPresets(); });
    box.append(ed);
  }
}
function openFilter(tab){
  // 似た画像の画面では、似た画像の条件を編集する（元の一覧の条件は変えない）
  fdFor = sim ? 'sim' : 'list';
  draft = fdFor === 'sim' ? Object.assign(emptyFilter(), simF ? cloneF(simF) : {}) : cloneF(state.filter);
  presetEdit = false; presetNaming = false; fdPickedOpen = false;
  if(tab) fdTab = tab;
  fdSearch.value = '';
  $('fdQ').value = draft.q || '';
  renderFilterDlg();
  filterDlg.showModal(); syncModal(); fitPicked();
  if(tab === 'other') $('fdQ').focus();
}
$('filterBtn').addEventListener('click', () => openFilter());
document.querySelectorAll('#fdTabs button').forEach(b => b.addEventListener('click', () => { fdTab = b.dataset.tab; fdSearch.value = ''; fdList.scrollTop = 0; renderFilterDlg(); }));
document.querySelectorAll('#fdMatchSeg button').forEach(b => b.addEventListener('click', () => { draft.tm = b.dataset.match; renderFilterDlg(); }));
document.querySelectorAll('#fdTypes button').forEach(b => b.addEventListener('click', () => { draft.type = b.dataset.type; renderFilterDlg(); }));
fdSearch.addEventListener('input', renderFilterDlg);
let fdQTimer = 0;
$('fdQ').addEventListener('input', () => { clearTimeout(fdQTimer); fdQTimer = setTimeout(() => { draft.q = $('fdQ').value.trim(); renderFilterDlg(); }, 200); });
// Enter：閉じたあとに戻った先のボタン（開いたボタン）が Enter で押されて、また開かないように止める
$('fdQ').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); draft.q = $('fdQ').value.trim(); applyFilterDlg(); } });
$('fdClear').addEventListener('click', () => { draft = emptyFilter(); $('fdQ').value = ''; renderFilterDlg(); });
$('fdCancel').addEventListener('click', () => filterDlg.close());
function applyFilterDlg(){
  if(fdFor === 'sim'){
    // 似た画像の条件：今の段の並びだけ変える（段は増やさない。元の一覧の条件はそのまま）
    simF = filterSummary(draft) ? cloneF(draft) : null;
    filterDlg.close();
    if(sim && cache) render();
    return;
  }
  exitSimilar();
  state.filter = cloneF(draft);
  store.set('filter', state.filter);
  filterDlg.close();
  syncFilter();
  if(cache) render();
}
$('fdOk').addEventListener('click', applyFilterDlg);
filterDlg.addEventListener('click', e => { if(e.target === filterDlg) filterDlg.close(); });
