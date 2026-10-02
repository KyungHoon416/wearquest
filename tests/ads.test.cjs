const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup({native=false,host='wearquest-9a45f.web.app'}={}){
 const ads=[],scripts=[],frames=[];let width=360;
 const app={children:[],replaceChildren(){this.children=[];ads.forEach(a=>a.isConnected=false);},appendChild(el){this.children.push(el);if(el.ad){el.ad.isConnected=true;ads.push(el.ad);}}};
 const document={head:{appendChild:s=>scripts.push(s)},getElementById:()=>app,querySelectorAll:()=>ads.filter(a=>a.isConnected&&!a.dataset.requested),createElement:tag=>({setAttribute(){},set innerHTML(v){this.html=v;if(tag==='aside')this.ad={dataset:{},isConnected:false,getBoundingClientRect:()=>({width})};},get innerHTML(){return this.html;}})};
 const window={Capacitor:{isNativePlatform:()=>native},addEventListener:(name,fn)=>window.resize=fn};
 const ctx={document,window,location:{protocol:'https:',hostname:host},requestAnimationFrame:fn=>frames.push(fn),console};vm.runInNewContext(fs.readFileSync('dist/ads.js','utf8'),ctx);
 return {api:window.WearQuestAds,app,window,scripts,ads,flush:()=>{while(frames.length)frames.shift()();},width:v=>width=v};
}
test('data refresh and game rounds preserve live ad nodes and never request twice',()=>{const s=setup(),ad=s.api.placeholder();s.api.render(ad+'round 1','play');s.flush();const node=s.app.children[1];assert.equal(s.window.adsbygoogle.length,1);s.api.render(ad+'round 2','play');s.flush();assert.equal(s.app.children[1],node);assert.equal(s.window.adsbygoogle.length,1);assert.match(node.innerHTML,/data-ad-format="horizontal"/);assert.equal(s.scripts.length,1);});
test('navigation creates new placements, queued old renders cannot request removed ads',()=>{const s=setup(),ad=s.api.placeholder();s.api.render(ad+'home'+ad,'home');s.api.render('login','login');s.flush();assert.equal(s.scripts.length,0);s.api.render(ad+'games','games');s.flush();assert.equal(s.window.adsbygoogle.length,1);});
test('zero width waits for visible width; resize cannot refresh served units',()=>{const s=setup();s.width(0);s.api.render(s.api.placeholder(),'home');s.flush();assert.equal(s.scripts.length,0);s.width(320);s.window.resize();s.window.resize();assert.equal(s.window.adsbygoogle.length,1);});
test('native and local/test hosts do not load or render live ads',()=>{for(const options of [{native:true},{host:'localhost'}]){const s=setup(options);assert.equal(s.api.placeholder(),'');s.api.render('content','home');s.flush();assert.equal(s.scripts.length,0);}});
