/* Authenticated play analytics. Completion is reported by the game, not proof for rewards. */
(() => {
 let current=null, starting=false, finishing=false, pendingStart=null, catalog=[];
 const originalStart=startGame, originalWin=win, originalGo=go, originalCard=gameCard, originalMy=my;
 const gameKey=id=>'game-'+String(id+1).padStart(2,'0');
 const errors={GAME_DISABLED:'점검 중인 게임입니다. 다른 게임을 선택해주세요.',UNAUTHENTICATED:'로그인 후 게임을 시작해주세요.',ACCOUNT_UNAVAILABLE:'이용할 수 없는 계정입니다.',PLAY_EXPIRED:'기록 시간이 만료됐어요. 게임을 다시 시작해주세요.',RATE_LIMITED:'요청이 많아요. 잠시 후 다시 시도해주세요.'};
 async function request(path,body,keepalive=false){
  const headers={'Accept':'application/json'};
  if(authBackend==='firebase'){
   const token=await window.WearQuestFirebase?.idToken();if(!token)throw Error(errors.UNAUTHENTICATED);headers.Authorization='Bearer '+token;
  }
  if(body){const session=await authRequest('/session');authCsrf=session.csrfToken;headers['Content-Type']='application/json';headers['X-CSRF-Token']=authCsrf;}
  const response=await fetch(authBase()+'/games/'+path,{method:body?'POST':'GET',credentials:'include',headers,...(body?{body:JSON.stringify(body)}:{}),keepalive,signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw Error(errors[data.code]||'게임 기록을 저장하지 못했어요. 다시 시도해주세요.');return data;
 }
 async function abandon(){const play=current;if(!play||finishing)return;current=null;try{await request('finish',{playId:play.playId,result:'abandoned'},true);}catch{toast('중단 기록을 전송하지 못했어요. 시작 기록은 서버에 남아 있어요.');}}
 startGame=async function(id){
  if(starting||finishing)return;
  if(!authUser){toast('플레이 기록을 저장하려면 로그인해주세요.');return go('login');}
  if(!Number.isInteger(id)||!games[id])return;
  starting=true;const token=sessionToken;
  try{
   await abandon();if(!pendingStart||pendingStart.gameId!==gameKey(id))pendingStart={gameId:gameKey(id),requestId:crypto.randomUUID()};
   const result=await request('start',pendingStart);pendingStart=null;
   if(result.status!=='started')throw Error('종료된 게임입니다. 다시 시작해주세요.');
   current={playId:result.playId,id,uid:authUser.id};
   if(token!==sessionToken){await abandon();return;}
   originalStart(id);
  }catch(error){toast(error.message);}finally{starting=false;}
 };
 win=async function(){
  if(finishing||!current)return;
  const play=current,token=sessionToken;finishing=true;clearInterval(timer);
  try{
   if(authUser?.id!==play.uid)throw Error('로그인 계정이 변경됐어요. 다시 시작해주세요.');
   await request('finish',{playId:play.playId,result:'completed'});current=null;
   if(token===sessionToken&&activeGame===play.id)originalWin();
  }catch(error){if(token===sessionToken&&activeGame===play.id){gameShell(`<div class="celebrate"><h2>클리어 기록 저장 대기</h2><p>${authEscape(error.message)}</p><button class="primary full" onclick="win()">저장 다시 시도</button><button class="secondary full" onclick="go('games')">게임 목록으로</button></div>`);}else toast(error.message);}finally{finishing=false;}
 };
 go=function(r){if(r!=='play')void abandon();return originalGo(r);};
 window.addEventListener('hashchange',()=>{if(location.hash!=='#play')void abandon();});
 gameCard=function(g,i){const config=catalog.find(x=>x.index===i);if(config?.enabled===false)return `<article class="game" aria-label="${authEscape(g[0])} 점검 중"><div class="game-info"><h3>${authEscape(g[0])}</h3><p>운영 점검 중입니다.</p><footer>잠시 후 다시 찾아주세요.</footer></div></article>`;return originalCard(g,i);};
 my=function(){return originalMy()+`<section class="card"><h2>계정 플레이 기록</h2><p>로그인한 계정의 최근 게임 기록을 확인해요.</p><button class="secondary full" onclick="showGameHistory()">내 플레이 기록 보기</button></section>`;};
 window.showGameHistory=async()=>{
  if(!authUser)return go('login');
  try{const {items}=await request('history');openModal(`<h2>최근 플레이 기록</h2><p class="sub">최근 30회 · 기기 체험 포인트와 별도로 저장됩니다.</p>${items.length?items.map(p=>`<div class="checkout-note"><b>${authEscape(p.title)}</b><br>${authEscape(new Date(p.createdAt).toLocaleString('ko-KR'))}<br>${({started:'미완료 (진행 중 또는 이탈)',completed:'클리어',abandoned:'중단'})[p.status]}${p.durationMs!==null?' · '+Math.round(p.durationMs/1000)+'초':''}</div>`).join(''):'<p>아직 저장된 플레이 기록이 없어요.</p>'}`);}catch(e){toast(e.message);}
 };
 fetch(authBase()+'/games/catalog',{credentials:'include',signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{catalog=d.items;if(route==='games'||route==='home')render();}).catch(()=>{});
})();
