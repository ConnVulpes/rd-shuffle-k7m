/* 情報の画面（編集パネル）の土台：1件の変更（updateItem addTag removeTag moveTo setCover uploadCover）、
   変えたあとの後始末（afterLocalChange）、下のお知らせ（showToast） */
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

