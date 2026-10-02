/* AdSense display units. Keep live ad nodes in place during SPA data/round updates. */
(() => {
  const client='ca-pub-4004046235562178',slot='9071901111';
  const marker='<!--wearquest-display-ad-->';
  const web=location.protocol==='https:'&&['wearquest-9a45f.web.app','wearquest-9a45f.firebaseapp.com'].includes(location.hostname)&&!window.Capacitor?.isNativePlatform?.();
  let pageKey=null,sections=[],loader=false;
  function requestAds(){
    if(!web)return;
    const pending=[...document.querySelectorAll('.wq-display-ad ins:not([data-requested])')].filter(el=>el.isConnected&&el.getBoundingClientRect().width>0);
    if(!pending.length)return;
    if(!loader){
      loader=true;
      const script=document.createElement('script');script.async=true;script.crossOrigin='anonymous';
      script.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='+client;
      document.head.appendChild(script);
    }
    pending.forEach(el=>{el.dataset.requested='true';try{(window.adsbygoogle=window.adsbygoogle||[]).push({});}catch(error){console.warn('광고를 불러오지 못했습니다.');}});
  }
  function makeAd(){
    const box=document.createElement('aside');box.className='wq-display-ad';box.setAttribute('aria-label','광고');
    box.innerHTML=`<span class="wq-ad-label">ADVERTISEMENT</span><ins class="adsbygoogle" style="display:block" data-ad-client="${client}" data-ad-slot="${slot}" data-ad-format="horizontal" data-full-width-responsive="false"></ins><div class="wq-ad-sample" role="img" aria-label="테스트 광고 · 수익 미발생. WEAR QUEST 수평형 배너 미리보기"><div><span class="wq-ad-sample-tag">테스트 광고 · 수익 미발생</span><strong>PLAY YOUR STYLE.</strong><small>WEAR QUEST · 수평형 배너 미리보기</small></div><span class="wq-ad-sample-art" aria-hidden="true">✳</span></div>`;
    return box;
  }
  window.WearQuestAds={
    placeholder:()=>web?marker:'',
    render(html,key){
      const app=document.getElementById('app'),parts=html.split(marker);
      if(pageKey!==key||sections.length!==parts.length){
        pageKey=key;sections=[];app.replaceChildren();
        parts.forEach((part,index)=>{if(index)app.appendChild(makeAd());const section=document.createElement('div');section.className='wq-content-segment';section.innerHTML=part;sections.push(section);app.appendChild(section);});
      }else parts.forEach((part,index)=>{sections[index].innerHTML=part;});
      requestAnimationFrame(requestAds);
    }
  };
  window.addEventListener('resize',requestAds);
})();
