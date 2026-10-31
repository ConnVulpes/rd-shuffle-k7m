/* 選ぶための部品（folderPicker tagChooser）、情報の画面の中身（renderEdit）、タグのおすすめ、
   似た画像からのタグ（aiTags）。最後にプレビューの閉じ方とタップ（closePeek onPeekClosed）。② で preview.js に寄せる */
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
  box.append(search, list);
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
  tools.append(input, seg);
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

// 閉じたあとの片付けは、close の知らせ（少し遅れて届く）を待たずにその場で行う
function closePeek(){
  if(peek.open){ peek.close(); onPeekClosed(); }
}

let peekCleaned = true, peekSilent = false;
peek.addEventListener('close', onPeekClosed);
function onPeekClosed(){
  if(peekCleaned) return;
  peekCleaned = true;
  popLayer('peek');
  viewEnd();
  const last = peekItem;
  hideCrop();
  peekItem = null; peekVideoFor = null; zoomer.innerHTML = ''; resetZoom(false); edToast.hidden = true; peek.classList.remove('editing', 'hq-loading');
  setBare(false);   // 次に開くときは、ボタンと文字が出ている状態から
  unlockScroll();
  // 一覧にまだ出ていないところまで送っていたら、そこまでカードを足してから合わせる
  const at = last ? order.indexOf(last) : -1;
  while(at >= shownCount && shownCount < poolSize) appendMore();
  if(peekSilent) peekSilent = false; else revealCard(last);
}
// プレビューを閉じたら、最後に見ていたカードが画面に入るところまでスクロールして、軽く光らせる
// （前後に送っているうちに追加で読み込んだカードは、並び終わるのを少し待つ）
function revealCard(it, tries = 0){
  const c = it && cardOf.get(it);
  if(!c) return;
  if(!c._placed || !c.isConnected){ if(tries < 30) setTimeout(() => revealCard(it, tries + 1), 100); return; }
  const top = document.querySelector('header').offsetHeight;
  const r = c.getBoundingClientRect();
  if(r.top < top || r.bottom > innerHeight){
    const room = innerHeight - top;
    const y = scrollY + r.top - top - Math.max(12, (room - r.height) / 2);
    window.scrollTo({ top:Math.max(0, y), behavior:'instant' });
  }
  c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
}
const touchUI = matchMedia('(hover:none)').matches;
peek.addEventListener('click', e => {
  // ボタン類や編集パネルを押したときは何もしない。
  // 押した直後に作り直されて画面から外れた部品（フォルダの選択欄など）は closest で親をたどれないので、
  // 押した時点の経路（composedPath）で判断する
  if(!e.target.isConnected) return;
  if(e.composedPath().some(n => n.matches && n.matches('.lb-top, .lb-nav, .lb-edit, .lb-toast, .lb-bright, .lb-hq, .lb-like, .lb-sim, .lb-info, .crop'))) return;
  if(zoomDragged){ zoomDragged = false; return; }   // ドラッグで動かした直後のクリックは無視
  // ズーム中はクリック（タップ）で元の大きさに戻す
  if(zoom.s !== 1){ resetZoom(true); setBare(false); return; }
  if(e.target.closest('video[controls]')) return;
  // 画像の真ん中の正方形を押すと、ボタンと文字を消す・戻す（情報の画面を開いている間は今までどおり）
  if(!peek.classList.contains('editing') && inPeekCenter(e.clientX, e.clientY)){ setBare(!peekBare); return; }
  // スマホ：画面の左半分をタップで前へ、右半分で次へ（閉じるのは×ボタン）
  if(touchUI){ stepPeek(e.clientX < window.innerWidth / 2 ? -1 : 1); return; }
  // PC：消している間は、どこを押しても戻すだけ（見えない矢印の場所を押して閉じてしまわないように）
  if(peekBare){ setBare(false); return; }
  // 画像やボタン以外（後ろが透けているところ）を押すと閉じる
  if(e.target === peek || e.target === peekBody || e.target === zoomer) closePeek();
});
$('peekClose').addEventListener('click', closePeek);
document.querySelector('#peekRd .lb-rd-ic').innerHTML = RD_ICON;

