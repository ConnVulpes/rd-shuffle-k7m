/* 起動：設定を画面に反映し、手元のデータで並べて、Raindrop から更新する。
   いちばん最後に読み込む */
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
