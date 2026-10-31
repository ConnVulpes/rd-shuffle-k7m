/* バックアップ（bkInit bkRun bkAuto bkPrune bkShare bkPaint）。
   保存先の持ち手は IndexedDB rdbackup（使う idbDo は similar.js にある） */
// ---- バックアップ（Raindrop がなくなっても中身が手元に残るように、定期的に写しを取る）----
// Mac の Chrome：選んだフォルダに、1回ごとに日付のフォルダを作って3つのファイルを書く。
//   前回から「新着＋更新＋アプリ内の編集」が 100 件たまったら、裏で自動に取る（「自動で保存」がオンのとき）。手動はいつでも。
//   自動のフォルダは、新しい 10 個と、それより古いものは月に1つ（12 か月まで）を残す。
// iPhone：フォルダを選べないので、手動で「保存…」を押したときに共有（またはダウンロード）するだけ。
const BK_EVERY = 100, BK_RECENT = 10, BK_MONTHS = 12;
const BK_DIR_RE = /^\d{4}-\d{2}-\d{2} \d{4}(-\d+)? (自動|手動)$/;   // このアプリが作るフォルダの名前の形（これ以外には触らない）。同じ分に2回目なら「2015-2」
const bkCanPick = typeof window.showDirectoryPicker === 'function';
let bkDirH = null;        // 選んだフォルダの持ち手（IndexedDB rdbackup に覚える）
let bkBusy = false, bkTimer = 0, bkAskedAt = 0;
const bkGet = () => idbDo('rdbackup', 'kv', 'readonly', s => s.get('dir')).catch(() => null);
const bkPut = h => idbDo('rdbackup', 'kv', 'readwrite', s => h ? s.put(h, 'dir') : s.delete('dir')).catch(() => null);
const pad2 = n => String(n).padStart(2, '0');
function bkStamp(t, kind){ const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}${pad2(d.getMinutes())} ${kind}`; }
function bkWhen(t){ const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

const bkAutoOn = () => store.get('bkauto', true) !== false;
// 設定の画面の表示を今の状態に合わせる
function bkPaint(){
  const n = store.get('bkcount', 0), at = store.get('bkat', 0);
  $('bkCount').textContent = n ? `${n}件` : 'なし';
  $('bkAt').textContent = at ? bkWhen(at) : 'まだありません';
  const now = $('bkNow');
  now.textContent = bkBusy ? '保存中…' : bkCanPick ? '今すぐ保存' : '保存…';
  now.disabled = bkBusy;
  // 自動バックアップは、フォルダを選べる端末（Mac）だけ
  $('bkAutoSec').hidden = !bkCanPick;
  $('bkAutoToggle').checked = bkAutoOn();
  $('bkDir').textContent = bkDirH ? bkDirH.name : '';
  $('bkPick').textContent = bkDirH ? '変更' : '選ぶ';
}
// 「自動で保存」：保存先がないままオンにしたら、フォルダを選ぶ。選ばなかったらオフに戻す
$('bkAutoToggle').addEventListener('change', async e => {
  const on = e.target.checked;
  store.set('bkauto', on);
  if(on && !bkDirH && !(await bkPick())) store.set('bkauto', false);
  bkPaint();
  if(bkAutoOn()) bkSoon(3000);
});
async function bkInit(){
  store.del('bkkeep');   // 前の版の「残す数」（今は使わない）
  if(bkCanPick){ const h = await bkGet(); if(h && h.kind === 'directory') bkDirH = h; }
  bkPaint();
  bkSoon(8000);   // 前の起動でたまった分。起動直後の自動の更新が終わってから見る
}
// 選び直す（新しいフォルダを選んだら、それからは そこに書く）
async function bkPick(){
  let h;
  try{ h = await window.showDirectoryPicker({ id:'rdbackup', mode:'readwrite' }); }
  catch(e){ return null; }   // キャンセル
  bkDirH = h; await bkPut(h); bkPaint();
  return h;
}
$('bkPick').addEventListener('click', () => { if(!bkBusy) bkPick(); });

// 取り込み・編集のあとに数を足す。たまったら少し置いて裏で確かめる
function bkAdd(n){
  if(!n) return;
  store.set('bkcount', store.get('bkcount', 0) + n);
  if(setDlg.open) bkPaint();
  bkSoon(3000);
}
function bkSoon(ms){
  if(!bkCanPick || !bkAutoOn()) return;   // iPhone と、自動がオフのときは自動で取らない（数えるのは続ける）
  clearTimeout(bkTimer);
  bkTimer = setTimeout(() => (window.requestIdleCallback || (f => setTimeout(f, 0)))(bkAuto, { timeout:5000 }), ms);
}
async function bkAuto(){
  if(!bkAutoOn() || !bkDirH || bkBusy || !cache || store.get('bkcount', 0) < BK_EVERY) return;
  // 更新の最中や、ほかの知らせ（「元に戻す」など）が出ている間は待つ
  if(refreshing || Date.now() - lastSync < 3000 || !edToast.hidden) return bkSoon(3000);
  let p = 'granted';
  try{ if(bkDirH.queryPermission) p = await bkDirH.queryPermission({ mode:'readwrite' }); }catch(e){ p = 'prompt'; }
  if(p === 'granted') return bkRun('自動');
  // 許可がないときは勝手に聞かず、知らせのボタンで1回押してもらう（同じ起動中は10分に1回まで）
  if(Date.now() - bkAskedAt < 10 * 60 * 1000) return;
  bkAskedAt = Date.now();
  showToast('バックアップの許可が切れています', bkResume, 'バックアップを続ける');
}
// 押されたときだけ許可を求めて、そのまま保存する（押した直後に呼ぶ必要があるので、待たずに求める）
function bkResume(){
  const h = bkDirH; if(!h) return;
  const ask = h.requestPermission ? h.requestPermission({ mode:'readwrite' }) : Promise.resolve('granted');
  ask.then(p => { if(p === 'granted') bkRun('自動'); else showToast('バックアップできませんでした', null); }, () => showToast('バックアップできませんでした', null));
}
$('bkNow').addEventListener('click', () => {
  if(bkBusy) return;
  if(!bkCanPick) return bkShare();
  if(!bkDirH){ bkPick().then(h => { if(h) bkRun('手動'); }); return; }   // 保存先がまだなら、選んでからそのまま保存
  const h = bkDirH;
  const ask = h.requestPermission ? h.requestPermission({ mode:'readwrite' }) : Promise.resolve('granted');
  ask.then(p => { if(p === 'granted') bkRun('手動'); else showToast('バックアップできませんでした', null); }, () => showToast('バックアップできませんでした', null));
});

// 型付き配列（地図の数字）は、読み戻せるように { $t:型の名前, b64:中身 } の文字にする
function bkPlain(v){
  if(ArrayBuffer.isView(v)) return { $t:v.constructor.name, b64:b64of(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if(Array.isArray(v)) return v.map(bkPlain);
  if(v && typeof v === 'object'){ const o = {}; for(const k of Object.keys(v)) o[k] = bkPlain(v[k]); return o; }
  return v;
}
// アプリのデータ（トークンは入れない）。items はそのまま cache に戻せる形
async function bkAppJson(){
  const map = await mapLocalGet().catch(() => null);   // 地図が読めなくても、ほかは保存する
  const settings = {};
  ['heatpct', 'heatimp', 'count', 'cap', 'saver', 'hidecur', 'wakepx', 'col', 'sort', 'filter', 'autonext', 'tagsort', 'sidew', 'bkauto']
    .forEach(k => { const v = store.get(k, undefined); if(v !== undefined) settings[k] = v; });
  settings.heatPct = state.heatPct;
  const data = { v:1, at:Date.now(), presets, pins, heat:heatPacked(), settings,
    items:cache.items, colls:cache.colls, tags:cache.tags, map:map ? bkPlain(map) : null };
  // 大きな文字に変えるのは手が空いているときに（一覧やプレビューの反応を遅らせない）
  await new Promise(r => (window.requestIdleCallback || (f => setTimeout(f, 0)))(r, { timeout:2000 }));
  return JSON.stringify(data);
}
// 3つのファイルを作る。書き出しが取れなかったものは入れない
// Raindrop の書き出しは、つながらない・エラー・転送先が読めない・中身を読み切れないときは null（アプリのデータだけでも保存する）
const bkExport = path => apiText(path).catch(() => null);
async function bkFiles(){
  const [html, csv] = await Promise.all([bkExport('/raindrops/0/export.html'), bkExport('/raindrops/0/export.csv')]);
  const files = [];
  if(html != null) files.push({ name:'raindrop.html', type:'text/html', body:html });
  if(csv != null) files.push({ name:'raindrop.csv', type:'text/csv', body:csv });
  files.push({ name:'rd-shuffle.json', type:'application/json', body:await bkAppJson() });
  // partial：取れなかった書き出し（'' は全部取れた）
  return { files, partial:html == null && csv == null ? 'all' : html == null ? 'HTML' : csv == null ? 'CSV' : '' };
}
// 知らせは1つの短い文で、何が取れなかったかを
function bkDone(partial){
  store.set('bkcount', 0); store.set('bkat', Date.now());
  showToast(!partial ? 'バックアップしました' : partial === 'all' ? '保存しました（書き出しは取れませんでした）' : `保存しました（${partial} の書き出しは取れませんでした）`, null);
}
async function bkRun(kind){
  if(bkBusy || !bkDirH || !cache) return;
  bkBusy = true; bkPaint();
  const root = bkDirH;
  try{
    const { files, partial } = await bkFiles();
    // 同じ分にもう取ってあれば、名前の後ろに -2, -3… を付けて別のフォルダに（前の中身と混ぜない）
    const base = bkStamp(Date.now(), kind), [day, hm, kd] = base.split(' ');
    let name = base;
    for(let k = 2; k < 100; k++){
      try{ await root.getDirectoryHandle(name); }catch(e){ if(e && e.name === 'NotFoundError') break; throw e; }
      name = `${day} ${hm}-${k} ${kd}`;
    }
    const dir = await root.getDirectoryHandle(name, { create:true });
    if(await dir.isSameEntry(root)) throw new Error('dir');   // 念のため：日付のフォルダが作れず元のフォルダが返ってきたら書かない
    for(const f of files){
      const w = await (await dir.getFileHandle(f.name, { create:true })).createWritable();
      await w.write(new Blob([f.body], { type:f.type }));
      await w.close();
    }
    await bkPrune(root);
    bkDone(partial);
  }catch(e){
    // 保存先のフォルダが消えた・動かされた：選んでいない状態に戻す
    if(e && (e.name === 'NotFoundError' || e.name === 'NotReadableError')){ bkDirH = null; await bkPut(null); }
    showToast('バックアップできませんでした', null);
  }finally{
    bkBusy = false; bkPaint();
  }
}
// 自動のフォルダを間引く：新しい 10 個は全部残す。それより古いものは、月ごとにいちばん新しい1つだけ残し、
// 12 か月より前のものは消す。手動のフォルダ・名前の形が違うもの・ほかのファイルには触らない
function bkPruneList(names, now){
  const autos = names.filter(n => BK_DIR_RE.test(n) && n.endsWith(' 自動')).sort().reverse();   // 新しい順
  const old = autos.slice(BK_RECENT), lim = new Date(now); lim.setMonth(lim.getMonth() - BK_MONTHS);
  const seen = new Set(), drop = [];
  for(const n of old){
    const [, y, mo, d, h, mi] = n.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})/);
    const t = new Date(+y, mo - 1, +d, +h, +mi);
    const month = y + '-' + mo;
    if(t < lim || seen.has(month)) drop.push(n); else seen.add(month);
  }
  return drop;
}
async function bkPrune(root){
  const names = [];
  for await (const [name, h] of root.entries()) if(h.kind === 'directory') names.push(name);
  for(const name of bkPruneList(names, Date.now())){
    try{ await root.removeEntry(name, { recursive:true }); }catch(e){}
  }
}
// iPhone：共有シート（保存先は「ファイル」など）。共有できないブラウザではダウンロード
async function bkShare(){
  if(bkBusy || !cache) return;
  bkBusy = true; bkPaint();
  let made;
  try{
    const { files, partial } = await bkFiles();
    const pre = bkStamp(Date.now(), '手動') + ' ';
    made = { partial, list:files.map(f => new File([f.body], pre + f.name, { type:f.type })) };
  }catch(e){ showToast('バックアップできませんでした', null); }
  bkBusy = false; bkPaint();
  if(made) bkHand(made, true);
}
function bkHand(made, first){
  const { list, partial } = made;
  if(navigator.share && navigator.canShare && navigator.canShare({ files:list })){
    navigator.share({ files:list }).then(() => { bkDone(partial); bkPaint(); }, e => {
      if(e && e.name === 'AbortError') return;   // キャンセル
      // 準備に時間がかかって「押した直後」でなくなったとき：知らせのボタンからもう一度
      if(first && e && e.name === 'NotAllowedError') showToast('バックアップの準備ができました', () => bkHand(made, false), '共有');
      else showToast('バックアップできませんでした', null);
    });
    return;
  }
  list.forEach(f => { const a = el('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); });
  bkDone(partial); bkPaint();
}

