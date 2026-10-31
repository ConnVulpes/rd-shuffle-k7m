/* 画像の貼り付けとキー操作（keydown）、起動：設定を画面に反映して並べ、Raindrop から更新する。
   いちばん最後に読み込む */
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
    // キーを押したら、消していたボタンと文字を戻す（ズームのキーと Shift だけのときは戻さない）
    if(!/^[+=-]$/.test(e.key) && e.key !== 'Shift') setBare(false);
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

// 絞り込みの画面の2つの検索欄に「全部消す」×（× の形を作る icon は list.js にあるので、全部を読み込んだここで付ける）。
// 言葉で探すは、手で消したときの 0.2 秒待ちを飛ばして、すぐ件数を出し直す
clearable(fdSearch);
clearable($('fdQ'), () => { clearTimeout(fdQTimer); draft.q = ''; renderFilterDlg(); });
applyCap();
applyWake();
applyCur();
applySize();
state.count = Number(state.count);
if(![20, 40, 80].includes(state.count)) state.count = 40;
applyCount();
bkInit();
if(cache && !(cache.v === 2 && cache.items && cache.colls && cache.tags)) cache = null;
if(cache) applyCache(); else syncFilter();
if(!state.token){
  openToken();
}else if(cache){
  render();
  setTimeout(pullSettings, 1500);
  // 1日以上たっていたら、表示したまま裏で全部取り直す
  if(Date.now() - cache.savedAt > DAY) refreshAll();
  else autoSync();
}else{
  refreshAll();
  setTimeout(pullSettings, 1500);
}
