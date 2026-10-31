/* 情報の画面（開け閉め・大きさ・つまみ・中身）、選ぶための部品（folderPicker tagChooser）、
   おすすめ（suggestTags）、似た画像からのタグ（aiTags） */
// ---- プレビューから タグ・フォルダ を変える ----
const edPanel = $('edPanel'), edToast = $('edToast');
// 最後に押した面（renderEdit で位置を保つのに使う）
const edPress = { sec:'', at:0 };
edPanel.addEventListener('pointerdown', e => { const s = e.target.closest && e.target.closest('.ed-scroll [data-sec]'); edPress.sec = s ? s.dataset.sec : ''; edPress.at = s ? Date.now() : 0; }, true);
let editOpen = store.get('editing', false);
let pins = store.get('pins', []);
let autoNext = store.get('autonext', true);
let edView = '';           // 開いている小さな画面：'' | 'folder' | 'cover' | 'pins'
let cacheSaveTimer = 0, toastTimer = 0;
const editQueue = new WeakMap();

function recountTags(){
  const m = new Map();
  cache.items.forEach(x => (x.g || []).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
  cache.tags = [...m].map(([name, count]) => ({ name, count })).sort((a, b) => jaCmp(a.name, b.name));
  sugIndex = null; // タグが変わったので、おすすめの数え直しが必要
  simFit = null;   // 似ているものの「曲げた地図」も作り直す
}
// カードの画像だけを作り直す（サムネを変えたとき）
function refreshCardMedia(c, it){
  const a = c.querySelector('.card-link');
  if(!a || !a.firstChild || c._crop) return;   // 切り抜いた部分の画像はそのまま
  if(c._hero) a.firstChild.replaceWith(mediaEl(it, thumbs(it), 0, () => sizeHero(c), true, 'hero'));
  else a.firstChild.replaceWith(mediaEl(it, thumbs(it), 0, undefined, true));
}
// 絞り込みから外れたカードの印。text が空なら外す
const snapOf = it => ({ k:it.k, g:(it.g || []).join('\n') });
function goneWhy(c, it){
  const was = c._was || snapOf(it);
  if(was.k !== it.k) return `移動済み · ${folderShort(it.k)}`;
  if(was.g !== (it.g || []).join('\n')) return 'タグを変更済み';
  return '絞り込みから外れました';
}
function setGone(c, text){
  c.classList.toggle('gone', !!text);
  let tag = c.querySelector(':scope > .gone-tag');
  if(!text){ if(tag) tag.remove(); return; }
  if(!tag){ tag = el('span', 'gone-tag'); c.append(tag); }
  tag.textContent = text;
}
// 手元で変えたあとの後始末：数え直し・保存・カードとプレビューの表示を合わせる
function afterLocalChange(items, { media = false } = {}){
  items = [].concat(items);
  items.forEach(it => hayCache.delete(it));
  recountTags();
  applyCache();
  clearTimeout(cacheSaveTimer);
  cacheSaveTimer = setTimeout(() => store.set('cache', cache), 800);
  const match = makeFilter(state.filter);
  items.forEach(it => {
    const c = cardOf.get(it);
    if(!c) return;
    const old = c.querySelector('.cap');
    if(old) old.replaceWith(captionEl(it));
    if(media) refreshCardMedia(c, it);
    // 今の絞り込みから外れたものは薄くして、理由を出す（並べ直すと消える）
    if(match(it)){ c._was = snapOf(it); setGone(c, ''); }
    else setGone(c, goneWhy(c, it));
  });
  if(popKind === 'tag' && items.some(x => selected.has(x))) renderSelPop();
  if(peekItem && items.includes(peekItem)){
    renderEdit();
    if(media) showPeekMedia(peekItem);
  }
}
const whyText = e => ({ auth:'トークンが無効です', network:'ネットにつながっていません', rate:'少し待ってからもう一度' })[e && e.message] || 'もう一度試してください';
// 下に出るお知らせ（「元に戻す」付き）。プレビュー中はプレビューの中に、そうでなければページの下に出す
// label を渡すと、ボタンの文字を「元に戻す」から変える（バックアップの「バックアップを続ける」など）
function showToast(msg, undo, label){
  // 設定の画面が開いているときは、その中に出す（画面の後ろに隠れないように）
  const sd = document.getElementById('setDlg'), host = peek.open ? peek : sd.open ? sd : cropOpen ? $('crop') : document.body;
  if(edToast.parentNode !== host) host.append(edToast);
  edToast.classList.toggle('page', !peek.open);
  $('edToastMsg').textContent = msg;
  $('edUndo').hidden = !undo;
  $('edUndo').textContent = label || '元に戻す';
  $('edUndo').onclick = () => { edToast.hidden = true; if(undo) undo(); };
  edToast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { edToast.hidden = true; }, undo ? 6000 : 4500);
}
// 1件の変更：すぐ画面に反映し、Raindrop には後ろで送る。失敗したら元に戻す。
// patch に使えるのは g（タグ）・k（フォルダ）・c（サムネ）
function updateItem(it, patch, label, isUndo){
  // 元に戻すときは、変えた項目だけを前の値で送り直す
  const before = {};
  Object.keys(patch).forEach(k => { before[k] = k === 'g' ? (it.g || []).slice() : it[k]; });
  const media = 'c' in patch;
  Object.assign(it, patch);
  afterLocalChange(it, { media });
  const body = {};
  if('g' in patch) body.tags = patch.g;
  if('k' in patch) body.collection = { $id:patch.k };
  if('c' in patch) body.cover = patch.c;
  const run = () => api(`/raindrop/${it.i}`, { method:'PUT', body }).then(r => {
    if(r && r.item){ it.g = r.item.tags || it.g; if(media) it.c = r.item.cover || it.c; afterLocalChange(it); }
    showToast(label, isUndo ? null : () => updateItem(it, before, '元に戻しました', true));
    bkAdd(1);
  }).catch(e => {
    Object.assign(it, before);
    afterLocalChange(it, { media });
    showToast(`保存できませんでした（${whyText(e)}）`, null);
  });
  const q = (editQueue.get(it) || Promise.resolve()).then(run, run);
  editQueue.set(it, q);
  return q;
}
function addTag(it, name){
  name = name.trim().replace(/^#/, '');
  if(!name || (it.g || []).includes(name)) return;
  updateItem(it, { g:[...(it.g || []), name] }, `#${name} を付けました`);
}
function removeTag(it, name){
  updateItem(it, { g:(it.g || []).filter(t => t !== name) }, `#${name} を外しました`);
}
function toggleTag(it, name){ (it.g || []).includes(name) ? removeTag(it, name) : addTag(it, name); }
function moveTo(it, id){
  if(it.k === id) return;
  updateItem(it, { k:id }, `「${folderShort(id)}」に移しました`);
  if(autoNext) setTimeout(() => { if(peekItem === it) stepPeek(1); }, 350);
}
// サムネを画像のアドレスで変える
function setCover(it, url){ updateItem(it, { c:url }, 'サムネを変えました'); }
// サムネを画像そのもの（貼り付け・ファイル）で変える。Raindrop に画像を送って、その住所をカバーにする
async function uploadCover(it, file){
  const before = it.c;
  showToast('サムネを送っています…', null);
  const fd = new FormData();
  fd.append('cover', file, file.name || 'cover.png');
  try{
    const r = await api(`/raindrop/${it.i}/cover`, { method:'PUT', body:fd });
    it.c = (r && r.item && r.item.cover) || it.c;
    afterLocalChange(it, { media:true });
    showToast('サムネを変えました', () => updateItem(it, { c:before }, '元に戻しました', true));
  }catch(e){
    showToast(`サムネを保存できませんでした（${whyText(e)}）`, null);
  }
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
// ---- 選ぶための部品（編集パネルと複数選択の両方で使う）----
// フォルダ：絞り込み欄＋一覧。cur は今のフォルダ（色を付ける）
function folderPicker(cur, onPick){
  const box = el('div', 'ed-picker');
  const search = el('input', 'ed-search'); search.type = 'search'; search.placeholder = 'フォルダを絞り込む'; search.autocomplete = 'off';
  const list = el('div', 'ed-list');
  const fill = () => {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = '';
    [{ id:-1, label:'未整理' }, ...cache.colls].filter(c => !q || c.label.toLowerCase().includes(q)).forEach(c => {
      const b = el('button', cur === c.id ? 'cur' : ''); b.type = 'button';
      const segs = c.label.split(' / ');
      if(segs.length > 1) b.append(el('span', 'path', segs.slice(0, -1).join(' / ') + ' /'));
      b.append(el('span', '', segs[segs.length - 1]), el('span', 'cnt', (folderCount.get(c.id) || 0).toLocaleString()));
      b.addEventListener('click', () => onPick(c.id));
      list.append(b);
    });
    if(!list.children.length){ const n = el('div', 'ed-note', '見つかりません'); n.style.padding = '8px 10px'; list.append(n); }
  };
  search.addEventListener('input', fill);
  search.addEventListener('keydown', e => {
    // 候補が1つに絞れていたら Enter で決める
    if(e.key === 'Enter'){ e.preventDefault(); const b = list.querySelectorAll('button'); if(b.length === 1) b[0].click(); }
  });
  fill();
  box.append(clearable(search), list);
  return { box, search };
}
// タグ：絞り込み欄・並び順・タグのボタン一覧。
// isOn(名前) 押された状態か / onPick(名前) 押したとき / onNew(名前) 新しいタグ（null なら作れない）
// isDisabled(名前, on) 押せない状態か / extra まだ一覧にないけれど出したいタグ / text 絞り込み欄の文字（{text}）
function tagChooser({ isOn, isPartial = () => false, onPick, onNew = null, isDisabled = () => false, extra = [], placeholder, text, id, onBackspace }){
  const box = el('div', 'ed-chooser');
  const tools = el('div', 'ed-tools');
  const input = el('input', 'ed-search'); input.type = 'search'; input.autocomplete = 'off'; input.placeholder = placeholder;
  if(id) input.id = id;
  input.value = text.text;
  const seg = el('div', 'ed-seg');
  const segBtns = [['count', 'よく使う順'], ['name', '名前順']].map(([v, label]) => {
    const b = el('button', '', label); b.type = 'button';
    b.addEventListener('click', () => { tagSort = v; store.set('tagsort', v); paintSeg(); draw(); });
    seg.append(b);
    return [v, b];
  });
  const paintSeg = () => segBtns.forEach(([v, b]) => b.setAttribute('aria-pressed', String(tagSort === v)));
  paintSeg();
  tools.append(clearable(input), seg);
  const grid = el('div', 'ed-grid');
  let shown = [];
  const draw = () => {
    const q = text.text.trim().replace(/^#/, '');
    const ql = q.toLowerCase();
    if(!cache.tags.length && cache.items.some(x => (x.g || []).length)) recountTags();
    let list = cache.tags.slice();
    if(tagSort === 'count') list.sort((a, b) => b.count - a.count || jaCmp(a.name, b.name));
    const missing = extra.filter(t => !list.some(x => x.name === t)).map(t => ({ name:t, count:0 }));
    list = [...missing, ...list];
    if(ql) list = list.filter(t => t.name.toLowerCase().includes(ql));
    shown = list;
    // タグが何百個あっても軽いように、文字列で一度に組み立てる（押したときの処理は grid で受ける）
    grid.innerHTML = list.map((t, i) => {
      const on = isOn(t.name);
      const cls = 'ed-tag' + (on ? ' on' : isPartial(t.name) ? ' some' : '');
      return `<button type="button" class="${cls}" data-i="${i}" aria-pressed="${on}"${isDisabled(t.name, on) ? ' disabled' : ''}><span>#${esc(t.name)}</span>${t.count ? `<span class="cnt">${t.count.toLocaleString()}</span>` : ''}</button>`;
    }).join('');
    if(onNew && q && !list.some(t => t.name === q)){
      const b = el('button', 'ed-tag new'); b.type = 'button';
      b.insertAdjacentHTML('beforeend', icon('plus'));
      b.append(el('span', '', `新しいタグ「#${q}」`));
      b.addEventListener('click', () => { text.text = ''; input.value = ''; onNew(q); });
      grid.append(b);
    }
    if(!grid.children.length) grid.append(el('span', 'ed-note', 'タグがありません'));
  };
  grid.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if(b && !b.disabled && shown[b.dataset.i]) onPick(shown[b.dataset.i].name);
  });
  input.addEventListener('input', () => { text.text = input.value; draw(); });
  input.addEventListener('keydown', e => {
    if(e.key === 'Enter'){
      // ぴったり同じ名前か、候補が1つならそれを押す。何もなければ新しいタグにする
      e.preventDefault();
      const q = text.text.trim().replace(/^#/, '');
      if(!q) return;
      const exact = shown.find(t => t.name === q);
      const pick = exact ? exact.name : (shown.length === 1 ? shown[0].name : null);
      if(!pick && (shown.length || !onNew)) return;
      text.text = ''; input.value = '';
      if(pick) onPick(pick); else onNew(q);
      draw();
    }else if(e.key === 'Backspace' && !input.value && onBackspace) onBackspace();
  });
  draw();
  box.append(tools, grid);
  return { box, grid, input, draw };
}

// ---- 編集パネルの中身 ----
// 上の「いつもの場所」に フォルダ → 付いているタグ → ピン留め → おすすめ → サムネイル の面を並べ、
// その下の一段暗い帯が「すべてのタグ」（見出しと検索欄はスクロールしても上に貼りつく）
function renderEdit(){
  const it = peekItem;
  edPanel.classList.remove('stale');
  if(!it || edPanel.hidden) return;
  if(edFilterFor !== it){ edFilter = { text:'' }; edFilterFor = it; }
  const oldScroll = edPanel.querySelector('.ed-scroll');
  const scrollY = oldScroll ? oldScroll.scrollTop : 0;
  const focusTag = document.activeElement && document.activeElement.id === 'edTagInput';
  // 押したところ（面）の位置を覚えておき、作り直したあとも同じ位置に置く
  // （上の「付いているタグ」が増えて行が増えても、押していたおすすめなどが下にずれないように）
  const anchor = Date.now() - edPress.at < 1500 && edPanel.querySelector(`.ed-scroll [data-sec="${edPress.sec}"]`);
  const anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
  edPanel.innerHTML = '';
  const body = el('div', 'ed-scroll');
  edPanel.append(...editFrame(), body);
  // ピン留めを編集している間は、付いているタグとおすすめは出さない（今までどおり）
  const pinMode = edView === 'pins', home = el('div', 'ed-home');
  home.append(editFolderSec(it));
  if(!pinMode) home.append(editHaveSec(it));
  home.append(editPinSec(it));
  if(!pinMode) home.append(editSugSec(it));
  home.append(editCoverSec(it));
  body.append(home, editTagSec(it));
  layoutEdit();
  body.scrollTop = scrollY;
  const again = anchor && body.querySelector(`[data-sec="${edPress.sec}"]`);
  if(again) body.scrollTop += again.getBoundingClientRect().top - anchorTop;
  watchEdScroll(body);
  if(focusTag){ const i = $('edTagInput'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
// 枠：幅を変えるつまみ（PC）・高さを変えるつまみ（スマホ）・見出し
function editFrame(){
  const rz = el('div', 'ed-resize'); rz.title = 'ドラッグで幅を変える';
  rz.addEventListener('pointerdown', startSideResize);
  const grip = el('div', 'ed-grip'); grip.title = '上下にドラッグで大きさを変える';
  grip.addEventListener('pointerdown', startSheetDrag);
  const head = el('div', 'ed-head');
  head.addEventListener('pointerdown', startSheetDrag);
  // スイッチは文字ごと押せる（label で包む）
  const sw = el('label', 'switch');
  sw.title = 'フォルダを選んだら、自動で次のブックマークに進みます';
  const swIn = el('input'); swIn.type = 'checkbox'; swIn.checked = autoNext;
  swIn.addEventListener('change', () => { autoNext = swIn.checked; store.set('autonext', autoNext); });
  sw.append(el('span', '', '自動で次へ'), swIn);
  const x = el('button', 'ed-x'); x.innerHTML = icon('x'); x.type = 'button'; x.setAttribute('aria-label', '情報を閉じる');
  x.addEventListener('click', () => setEditOpen(false));
  // 見出し：タイトル全文（長ければ数行で「…」）と「作者 · サイト · 10月27日に保存」
  const it = peekItem, ttl = el('div', 'ed-ttl');
  const day = saveDate(it.a);
  ttl.append(el('strong', 'ed-ttl-t', itemTitle(it)), el('span', 'ed-ttl-d', [authorName(it.l), siteName(it), day && day + 'に保存'].filter(Boolean).join(' · ')));
  ttl.firstChild.title = itemTitle(it);
  // 1行目はタイトルと ×（タイトルを幅いっぱいに）。「自動で次へ」は作者・日付の下の行の右に
  head.append(ttl, x, el('div', 'ed-brk'), sw);
  return [rz, grip, head];
}
// 小見出しの付いたひとまとまり。link は小見出しの右に置く文字だけのボタン
function edSec(key, title, link){
  const sec = el('div', 'ed-sec');
  sec.dataset.sec = key;
  const h = el('div', 'ed-h');
  h.append(el('span', '', title));
  if(link) h.append(link);
  sec.append(h);
  return sec;
}
function edLink(text, onClick){
  const b = el('button', 'ed-link', text); b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
function editFolderSec(it){
  const sec = edSec('folder', 'フォルダ');
  const btn = el('button', 'ed-folder'); btn.type = 'button';
  btn.append(el('span', '', collName(it) || '未整理')); btn.insertAdjacentHTML('beforeend', icon(edView === 'folder' ? 'up' : 'down'));
  btn.addEventListener('click', () => { edView = edView === 'folder' ? '' : 'folder'; renderEdit(); });
  sec.append(btn);
  if(edView === 'folder'){
    const p = folderPicker(it.k, id => { edView = ''; moveTo(it, id); });
    sec.append(p.box);
  }
  return sec;
}
// サムネイル：画像の貼り付け（⌘V）・ドロップ・ファイル選択・画像のアドレスで変える
// 1行の面：小さなサムネイル・取り元（サイト名）・右端の矢印。行のどこを押しても変える画面が開く（もう一度押すと閉じる）
function editCoverSec(it){
  const open = edView === 'cover';
  const sec = edSec('cover', 'サムネイル');
  const row = el('button', 'ed-folder ed-cover-row'); row.type = 'button';
  row.setAttribute('aria-expanded', String(open));
  const th = el('span', 'ed-cover-th');
  const t0 = thumbs(it)[0], src = it.c && (directSmall(it.c) || (t0 && !t0.video ? t0.url : ''));
  if(src){
    const im = el('img'); im.alt = ''; im.decoding = 'async'; im.referrerPolicy = 'no-referrer';
    im.addEventListener('error', () => im.remove());
    im.src = src; th.append(im);
  }
  const site = (it.d || siteKey(it.l) || '').replace(/^www\./, '');
  row.append(th, el('span', 'ed-cover-src', it.c ? (site ? `${site} の画像` : '') : 'なし'));
  row.insertAdjacentHTML('beforeend', icon(open ? 'down' : 'right'));
  row.addEventListener('click', () => { edView = open ? '' : 'cover'; renderEdit(); });
  sec.append(row);
  if(!open) return sec;
  const drop = el('div', 'ed-drop');
  drop.append(el('div', '', canHover ? '画像をコピーして ⌘V で貼り付け、またはここにドロップ' : '画像を選ぶか、画像のアドレスを貼り付け'));
  const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
  file.addEventListener('change', () => { if(file.files[0]){ edView = ''; uploadCover(it, file.files[0]); } });
  drop.append(edLink('ファイルから選ぶ', () => file.click()), file);
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    const f = [...(e.dataTransfer.files || [])].find(x => x.type.startsWith('image/'));
    if(f){ edView = ''; uploadCover(it, f); return; }
    const u = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim().split('\n')[0];
    if(/^https?:\/\//.test(u)){ edView = ''; setCover(it, u); }
  });
  const url = el('input', 'ed-search'); url.type = 'url'; url.id = 'edCoverUrl'; url.placeholder = '画像のアドレス（https://…）を入れて Enter'; url.autocomplete = 'off';
  url.addEventListener('keydown', e => {
    if(e.key !== 'Enter') return;
    e.preventDefault();
    const v = url.value.trim();
    if(/^https?:\/\//.test(v)){ edView = ''; setCover(it, v); }
    else showToast('https:// から始まる画像のアドレスを入れてください', null);
  });
  sec.append(drop, url);
  return sec;
}
// ===== タグのおすすめ =====
// 見本にするのは「タグが1つ以上付いているもの」だけ。タグなしは「まだ付けていない」だけなので、
// 「このタグではない」という見本には数えない。タグ付きのものは全部付いている前提で、付いていないタグは「違う」と数える。
// 出どころは3つ：同じ作者（X などのアカウント）・同じサイト・今付いているタグとよく一緒に付けるタグ。
var sugIndex = null; // 起動中に recountTags から先に触られることがあるので var
// 作者が分かるサイトだけ、URL から作者を取り出す
function authorKey(url){
  let u; try{ u = new URL(url); }catch(e){ return ''; }
  const host = u.hostname.replace(/^(www|mobile|m)\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  if(host === 'x.com' || host === 'twitter.com'){
    const s = seg[0] && seg[0].toLowerCase();
    return s && s !== 'i' && /^status/.test(seg[1] || '') ? 'x:' + s : '';
  }
  if(host === 'bsky.app') return seg[0] === 'profile' && seg[1] ? 'bsky:' + seg[1].toLowerCase() : '';
  if(host === 'deviantart.com') return seg[0] && seg[1] === 'art' ? 'da:' + seg[0].toLowerCase() : '';
  if(host === 'instagram.com') return seg[0] && !['p', 'reel', 'reels', 'stories', 'explore'].includes(seg[0]) ? 'ig:' + seg[0].toLowerCase() : '';
  if(/\.tumblr\.com$/.test(host) && host !== 'www.tumblr.com') return 'tb:' + host.split('.')[0];
  if(host === 'youtube.com' && seg[0] && seg[0][0] === '@') return 'yt:' + seg[0].toLowerCase();
  return '';
}
function siteKey(url){
  try{ return new URL(url).hostname.replace(/^(www|mobile|m)\./, ''); }catch(e){ return ''; }
}
// URL から取り出した作者とサイトは、ブックマークごとに覚えておく（タグを押すたびに数え直すので、軽くするため）
const srcKeys = new WeakMap();
function srcOf(it){
  let k = srcKeys.get(it);
  if(!k || k.l !== it.l){ k = { l:it.l, a:authorKey(it.l), s:siteKey(it.l) }; srcKeys.set(it, k); }
  return k;
}
function buildSugIndex(){
  const byAuthor = new Map(), bySite = new Map(), tagItems = new Map();
  const bump = (map, key, tags) => {
    if(!key) return;
    let e = map.get(key); if(!e){ e = { n:0, tags:new Map() }; map.set(key, e); }
    e.n++;
    tags.forEach(t => e.tags.set(t, (e.tags.get(t) || 0) + 1));
  };
  cache.items.forEach(it => {
    const g = it.g || [];
    if(!g.length) return;
    const { a, s } = srcOf(it);
    bump(byAuthor, a, g);
    bump(bySite, s, g);
    g.forEach(t => { let arr = tagItems.get(t); if(!arr){ arr = []; tagItems.set(t, arr); } arr.push(a); });
  });
  // 作者名のタグを見分ける：そのタグの付いたものの大半（8割以上）が同じアカウントから来ていて、
  // しかもそのアカウントのものの半分以上に付いているタグ
  const authorTags = new Set();
  // タグ名がアカウント名と同じなら、1件しかなくても作者名とみなす
  const plain = s => s.toLowerCase().replace(/[\s_.\-@]/g, '');
  const handles = new Set([...byAuthor.keys()].map(a => plain(a.split(':')[1])));
  tagItems.forEach((authors, t) => { if(handles.has(plain(t))) authorTags.add(t); });
  tagItems.forEach((authors, t) => {
    const known = authors.filter(Boolean);
    if(known.length < 2) return;
    const c = new Map(); known.forEach(a => c.set(a, (c.get(a) || 0) + 1));
    let top = '', max = 0; c.forEach((v, a) => { if(v > max){ max = v; top = a; } });
    if(max / authors.length >= 0.8 && max / byAuthor.get(top).n >= 0.5) authorTags.add(t);
  });
  const tagged = cache.items.reduce((n, it) => n + ((it.g || []).length ? 1 : 0), 0);   // タグが付いているものの数
  sugIndex = { items:cache.items, len:cache.items.length, byAuthor, bySite, tagItems, authorTags, tagged, co:new Map() };
}
// あるタグと一緒に付いているタグの数（必要になったタグだけ数える）
function coCounts(t){
  if(sugIndex.co.has(t)) return sugIndex.co.get(t);
  const m = new Map();
  cache.items.forEach(it => { const g = it.g || []; if(g.includes(t)) g.forEach(s => { if(s !== t) m.set(s, (m.get(s) || 0) + 1); }); });
  sugIndex.co.set(t, m);
  return m;
}
// 候補：[{ t, score, why }] を強い順に
function suggestTags(it){
  if(!sugIndex || sugIndex.items !== cache.items || sugIndex.len !== cache.items.length) buildSugIndex();
  const have = new Set(it.g || []);
  const cand = new Map();
  const add = (t, s, why) => {
    if(have.has(t) || s <= 0) return;
    const c = cand.get(t);
    if(!c){ cand.set(t, { t, score:s, why, best:s }); return; }
    // いくつかの出どころで当たったら強くする。理由はいちばん強いものを出す
    c.score = 1 - (1 - c.score) * (1 - s);
    if(s > c.best){ c.best = s; c.why = why; }
  };
  // 同じ作者：n 件中 cnt 件に付いている。1件しかない作者でも出す（作者名のタグを拾うため）
  const src = srcOf(it), a = src.a, ae = a && sugIndex.byAuthor.get(a);
  if(ae){
    // 今開いているものがタグ付きなら、自分の分は数えない
    const self = (it.g || []).length ? 1 : 0;
    const n = ae.n - self;
    if(n > 0) ae.tags.forEach((cnt, t) => {
      cnt -= self && have.has(t) ? 1 : 0;
      if(cnt <= 0) return;
      const p = cnt / (n + 1);
      if(p < 0.3) return;
      add(t, Math.min(1, sugIndex.authorTags.has(t) ? p * 2 : p), `この作者の ${n} 件中 ${cnt} 件に付いています`);
    });
  }
  // 同じサイト：5件以上あって、4割以上に付いているもの（作者名のタグは除く）
  const se = sugIndex.bySite.get(src.s);
  if(se && se.n >= 5) se.tags.forEach((cnt, t) => {
    if(sugIndex.authorTags.has(t) || cnt / se.n < 0.4) return;
    add(t, 0.8 * cnt / (se.n + 1), `このサイトの ${se.n} 件中 ${cnt} 件に付いています`);
  });
  // 今付いているタグとよく一緒に付けるタグ（3件以上あるタグから、4割以上一緒のもの。作者名は除く）
  have.forEach(s => {
    const n = (sugIndex.tagItems.get(s) || []).length;
    if(n < 3 || sugIndex.authorTags.has(s)) return;
    coCounts(s).forEach((cnt, t) => {
      if(sugIndex.authorTags.has(t) || cnt / n < 0.4) return;
      add(t, 0.7 * cnt / n, `#${s} の ${n} 件中 ${cnt} 件で一緒に付いています`);
    });
  });
  return [...cand.values()].sort((x, y) => y.score - x.score || jaCmp(x.t, y.t));
}
// 編集パネルの「ピン留め」（固定したタグ）と「おすすめ」。押すとすぐ付く／外れる。
// 押したものはその場に残して押した状態にする（押すたびに並びが詰まると、続けて押したときに隣を押してしまうため）
let sugShown = { item:null, list:[], fresh:null }, sugTimer = 0;
// 候補のタグのボタン。key は PC で付け外しに使える数字キー（固定したタグだけ）
function candBtn(it, t, kind, key){
  const on = (it.g || []).includes(t);
  const b = el('button', `ed-tag ${kind}${on ? ' on' : ''}`); b.type = 'button';
  b.setAttribute('aria-pressed', String(on));
  if(kind === 'ai') b.title = '似た画像に付いているタグ';
  b.append(el('span', '', '#' + t));
  if(key && canHover) b.append(el('kbd', '', String(key)));
  b.addEventListener('click', () => toggleTag(it, t));
  return b;
}
function editPinSec(it){
  const pinMode = edView === 'pins';
  const sec = edSec('pins', 'ピン留め', edLink(pinMode ? '完了' : '編集', () => { edView = pinMode ? '' : 'pins'; renderEdit(); }));
  sec.querySelector('.ed-h > span').insertAdjacentHTML('afterbegin', icon('pin'));
  const box = el('div', 'ed-face');
  pins.forEach((t, i) => box.append(candBtn(it, t, 'pin', i + 1)));
  if(!box.children.length) box.append(el('span', 'ed-note', 'なし'));
  sec.append(box);
  return sec;
}
// おすすめ：規則のおすすめ（作者・サイト・一緒に付けるタグ）が先、AI の候補が後。
// AI の候補は少し後から足すので、そのあとで規則のおすすめが増えたときは、並びを動かさないように AI の候補の後ろに足す。
// reuse = AI の候補を足すだけのとき（規則のおすすめは数え直さない）
function editSugSec(it, force, reuse){
  if(aiShown.item !== it){ aiShown = { item:it, list:[], ready:false, at:0 }; clearTimeout(aiTimer); aiTimer = 0; }
  const sec = edSec('sug', 'おすすめ');
  sec.querySelector('.ed-h > span').insertAdjacentHTML('afterbegin', icon('bulb'));
  const box = el('div', 'ed-face');
  const rule = editSugBtns(it, force, reuse);
  const ai = aiShown.ready ? aiShown.list.filter(t => !pins.includes(t)).map(t => candBtn(it, t, 'ai')) : [];
  // 規則のおすすめ（作者・サイト・一緒に付けるタグ）→ 似た画像からの候補の順
  rule.forEach(x => box.append(x.b));
  ai.forEach(b => box.append(b));
  if(!box.children.length) box.append(el('span', 'ed-note', 'なし'));
  // AI の候補を数えるのは、開いた・押した反応を返したあと
  if(!aiShown.ready && !aiTimer) aiTimer = setTimeout(() => { aiTimer = 0; fillAi(it); }, 150);
  sec.append(box);
  return sec;
}
// 規則のおすすめのボタン（固定したタグと同じものは出さない）：[{ b:ボタン, at:出した順番 }]
function editSugBtns(it, force, reuse){
  if(sugShown.item !== it) sugShown = { item:it, list:[], fresh:null };
  const stale = !sugIndex || sugIndex.items !== cache.items || sugIndex.len !== cache.items.length;
  let fresh;
  if(reuse && sugShown.fresh) fresh = sugShown.fresh;
  else if(stale && !force && sugShown.fresh){
    // タグを押した直後：数え直しは少し後に回して、押した反応を先に返す（候補は前のものを使う）
    fresh = sugShown.fresh;
    clearTimeout(sugTimer);
    sugTimer = setTimeout(() => {
      if(peekItem !== it || edPanel.hidden) return;
      const old = edPanel.querySelector('.ed-sec[data-sec="sug"]');
      if(old) old.replaceWith(editSugSec(it, true));
    }, 150);
  }else fresh = suggestTags(it);
  sugShown.fresh = fresh;
  const byT = new Map(fresh.map(c => [c.t, c]));
  // 前に出していたものは、同じブックマークを開いている間は同じ位置に残す（候補から外れても消さない）。
  // 新しい候補は後ろに足す（全部で10個まで）
  const keep = sugShown.list.slice();
  // 「AI の候補」にもう出ているタグは、あとから足さない（同じ面で二重に出さない）
  const inAi = t => aiShown.item === it && aiShown.list.includes(t);
  fresh.forEach(c => { if(keep.length < (sugShown.list.length ? 10 : 8) && !keep.includes(c.t) && !pins.includes(c.t) && !inAi(c.t)) keep.push(c.t); });
  sugShown.list = keep;
  return keep.map((t, at) => ({ t, at })).filter(x => !pins.includes(x.t)).map(({ t, at }) => {
    const b = candBtn(it, t, 'sug');
    const c = byT.get(t);
    if(c) b.title = c.why;
    return { b, at };
  });
}
// ===== AI の候補：似た画像に付いているタグ =====
// 似た画像の地図（タグで曲げていない、画像だけの近さ）で近い画像を集め、そこに付いているタグを数える。
// 曲げた地図は、今付いているタグが位置に混ざるので使わない。タグなしの画像は「そのタグではない」とは数えない（数に入れない）。
// 地図は、もう読み込んであるか、この端末に保存してあるものだけを使う（Raindrop から読む・画像を調べることはしない）
const AI_NEAR = 40, AI_TEMP = 0.07, AI_MAX = 10;
// 候補：[{ t, score }] を強い順に。地図がない・この画像が地図にないときは null
function aiTags(it){
  const m = simMap; if(!m || !m.V) return null;
  const r0 = m.pos.get(it.i); if(r0 == null) return null;
  if(!sugIndex || sugIndex.items !== cache.items || sugIndex.len !== cache.items.length) buildSugIndex();
  const byId = new Map(cache.items.map(x => [x.i, x]));
  const d = m.dims, V = m.V, o0 = r0 * d;
  // タグが付いている画像のうち、近い順に AI_NEAR 枚（作者名のタグしかないものは数えない）
  const near = [];   // [近さ, タグ] を近い順に
  for(let r = 0; r < m.n; r++){
    if(r === r0) continue;
    let s = 0; const o = r * d; for(let j = 0; j < d; j++) s += V[o0 + j] * V[o + j];
    if(near.length === AI_NEAR && s <= near[AI_NEAR - 1][0]) continue;
    const x = byId.get(m.ids[r]); if(!x || x === it) continue;
    const g = (x.g || []).filter(t => !sugIndex.authorTags.has(t)); if(!g.length) continue;
    let k = near.length; while(k > 0 && near[k - 1][0] < s) k--;
    near.splice(k, 0, [s, g]); if(near.length > AI_NEAR) near.pop();
  }
  if(!near.length) return [];
  // 近いほど重く。いちばん近いものを基準にして数字が大きくなりすぎないようにする（並びは変わらない）
  const top = near[0][0], score = new Map();
  near.forEach(([s, g]) => { const w = Math.exp((s - top) / AI_TEMP); g.forEach(t => score.set(t, (score.get(t) || 0) + w)); });
  // どこにでも付いているタグが勝ち続けないように、タグ付きのもの全体でそのタグが付いている割合の平方根で割る
  const have = new Set(it.g || []), all = sugIndex.tagged || 1;
  const out = [];
  score.forEach((v, t) => {
    if(have.has(t)) return;
    const rate = (sugIndex.tagItems.get(t) || []).length / all || 1 / all;
    out.push({ t, score:v / Math.sqrt(rate) });
  });
  return out.sort((a, b) => b.score - a.score || jaCmp(a.t, b.t));
}
// 出しているもの：開いているブックマークごとに決めて、押してもその場に残す（並びを動かさない）。
// at = AI の候補を足したときの、規則のおすすめの数（そこに差し込む）
let aiShown = { item:null, list:[], ready:false, at:0 }, aiTimer = 0, aiMapTried = false;
function fillAi(it){
  if(peekItem !== it || edPanel.hidden || aiShown.item !== it || aiShown.ready) return;
  if(!simMap){
    // まだ読み込んでいなければ、この端末に保存してある地図だけを1回読む
    if(aiMapTried) return;
    aiMapTried = true;
    mapLocalGet().then(rec => { if(rec && rec.q && !simMap) useMap(rec); if(simMap) fillAi(it); }).catch(() => {});
    return;
  }
  const res = aiTags(it);
  // 今の「固定」と「おすすめ」に出ているタグ・作者名のタグは出さない
  const shown = new Set([...pins, ...(sugShown.item === it ? sugShown.list : [])]);
  aiShown.list = (res || []).filter(c => !shown.has(c.t) && !sugIndex.authorTags.has(c.t)).slice(0, AI_MAX).map(c => c.t);
  aiShown.at = sugShown.item === it ? sugShown.list.length : 0;
  aiShown.ready = true;
  if(edView === 'pins') return;
  const old = edPanel.querySelector('.ed-sec[data-sec="sug"]');
  if(old) old.replaceWith(editSugSec(it, false, true));
}
// 付いているタグ：塗りで並べる。タグ全体を押すと外れる
function editHaveSec(it){
  const sec = edSec('have', '付いているタグ');
  const wrap = el('div', 'ed-face');
  (it.g || []).forEach(t => {
    const b = el('button', 'ed-tag on'); b.type = 'button';
    b.title = '押すと外す';
    b.append(el('span', '', '#' + t));
    b.addEventListener('click', () => removeTag(it, t));
    wrap.append(b);
  });
  if(!wrap.children.length) wrap.append(el('span', 'ed-note', 'なし'));
  sec.append(wrap);
  return sec;
}
// すべてのタグ：一覧から選ぶ（押すと付く／外れる）。「固定を編集」中は固定するタグを選ぶ
// 下の帯：見出し（タグの形・名前・数）と検索欄・並べ替えは、スクロールしても上に貼りつく
function editTagSec(it){
  const pinMode = edView === 'pins';
  const have = new Set(it.g || []);
  const sec = el('div', 'ed-all'); sec.dataset.sec = 'all';
  const head = el('div', 'ed-all-head');
  const h = el('div', 'ed-all-h');
  h.insertAdjacentHTML('beforeend', icon('tag'));
  const cnt = el('span', 'cnt');
  h.append(el('span', '', 'すべてのタグ'), cnt);
  head.append(h);
  if(pinMode){
    const bn = el('div', 'ed-banner', `固定するタグを選んでいます（${pins.length}/9）`);
    bn.append(edLink('完了', () => { edView = ''; renderEdit(); }));
    head.append(bn);
  }
  const ch = tagChooser({
    id:'edTagInput', text:edFilter, extra:it.g || [],
    placeholder: pinMode ? 'タグを絞り込む' : '絞り込む・新しいタグ（Enter）',
    isOn: name => pinMode ? pins.includes(name) : have.has(name),
    isDisabled: (name, on) => pinMode && !on && pins.length >= 9,
    onPick: name => {
      if(!pinMode){ toggleTag(it, name); return; }
      pins = pins.includes(name) ? pins.filter(x => x !== name) : [...pins, name].slice(0, 9);
      store.set('pins', pins);
      settingsChanged();
      renderEdit();
    },
    onNew: pinMode ? null : name => addTag(it, name),
    onBackspace: pinMode ? null : () => { if((it.g || []).length) removeTag(it, it.g[it.g.length - 1]); }
  });
  ch.grid.classList.toggle('pinmode', pinMode);
  cnt.textContent = cache.tags.length.toLocaleString();   // 一覧を作るときに数え直すので、そのあとで
  head.append(ch.box.querySelector('.ed-tools'));
  // いちばん上へ戻るボタン（すべてのタグの所で上向きにスクロールしたときだけ出す）
  const up = el('button', 'ed-up'); up.type = 'button'; up.innerHTML = icon('up');
  up.setAttribute('aria-label', 'いちばん上へ'); up.title = 'いちばん上へ';
  head.append(up);
  sec.append(head, ch.box);
  return sec;
}
// 「いちばん上へ」の出し入れ：すべてのタグの所まで来ていて、上向きにスクロールしたら出す。下向きなら隠す。いつもの場所では出さない
let edUpOn = false;
function watchEdScroll(body){
  const zone = body.querySelector('.ed-all'), up = body.querySelector('.ed-up');
  if(!zone || !up) return;
  let last = body.scrollTop;
  const inAll = y => y >= zone.offsetTop - 1;
  const set = v => { edUpOn = v; up.classList.toggle('show', v); };
  // 作り直したとき（タグを押したときなど）は、前の状態を引き継ぐ
  set(edUpOn && inAll(last));
  body.addEventListener('scroll', () => {
    const y = body.scrollTop;
    if(!inAll(y)) set(false);
    else if(y < last - 2) set(true);
    else if(y > last + 2) set(false);
    last = y;
  }, { passive:true });
  up.addEventListener('click', () => { set(false); body.scrollTop = 0; last = 0; });
}
$('peekEdit').addEventListener('click', () => setEditOpen(!editOpen));
// 画像の下の2行を押すと情報の画面を開く（前へ・次へには使わない）
$('peekInfo').addEventListener('click', e => { e.stopPropagation(); if(!editOpen) setEditOpen(true); });
// 入力中の Esc はプレビューを閉じずに、入力や一覧だけを閉じる
peek.addEventListener('cancel', e => {
  if(edPanel.contains(document.activeElement) || edView){
    e.preventDefault();
    if(edView){ edView = ''; renderEdit(); }
    else document.activeElement.blur();
    return;
  }
  if(editOpen){ e.preventDefault(); setEditOpen(false); }
});
