import {ACTS,clamp,lerp,smooth,pose,mixPose,sampleTrack,point,unit,mul,inverse,evaluateRig,departureRig,constrainRig,mixTheme,sourceColourMatrix} from './source-motion.js';
import {paintInkPlates,equipmentPose,cubicPrint} from './print-motion.js?v=8.1.0';
import {createInkRenderer} from './ink-renderer.js?v=8.1.0';
const NS='http://www.w3.org/2000/svg',$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const svg=(name,attrs={})=>{const n=document.createElementNS(NS,name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
const state=$('#render-status'),mount=$('#scene-mount'),paperMount=$('#paper-mount'),jointMount=$('#joints-mount'),timeline=$('#timeline');
let stageCanvas=document.createElement('canvas');stageCanvas.id='source-canvas';stageCanvas.setAttribute('aria-hidden','true');$('#poster-surface').prepend(stageCanvas);let stageContext;
function fallbackStage(reason){const copy=stageCanvas.cloneNode();copy.classList.remove('is-gpu');stageCanvas.replaceWith(copy);stageCanvas=copy;stageContext=stageCanvas.getContext('2d',{alpha:false});state.dataset.rendererFallback=reason;state.dataset.compositor='canvas2d';for(const scene of M.scenes)if(scene.cache.paperImage)scene.cache.paperPattern=stageContext.createPattern(scene.cache.paperImage,'repeat');if(M.data)applyTheme(M.theme);resizeStage();controls();}
try{stageContext=createInkRenderer(stageCanvas)||stageCanvas.getContext('2d',{alpha:false});}catch(error){const copy=stageCanvas.cloneNode();stageCanvas.replaceWith(copy);stageCanvas=copy;stageContext=stageCanvas.getContext('2d',{alpha:false});state.dataset.rendererFallback=error.message;}
stageCanvas.addEventListener('forma-renderer-lost',()=>fallbackStage('Graphics context restored through source Canvas2D renderer'));
const AUDIT_NATIVE=new URLSearchParams(location.search).has('audit');
function resizeStage(native=false){
 const width=1024;
 if(stageCanvas.width!==width){stageCanvas.width=width;stageCanvas.height=width*1.5;}
 if(M.data)paintStage();
}
const M={data:null,scenes:[],sprites:new Map(),index:0,phase:'loading',start:0,duration:1000,progress:0,paused:false,out:[],arrival:null,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,speed:1,joints:false,texture:false,theme:null,ramp:null,frame:0,transitions:0,settled:0,themeFrames:0,lastControls:0,loadToken:0,requested:null,warmTimer:0};
const themeStyle=colors=>Object.entries(colors).map(([k,v])=>`--${k}:${v}`).join(';');
const PRINT_STORIES={"bronya":["摩托沿速度线滑入，轻微回弹后锁定原位。","车身与两轮作为一个完整物件，从左下方驶入并减速收稳；骑手轮廓、原有场景和背景几何均保留。"],"kiana":["人物滑入，剑身收稳，火焰沿剑锋展开。","人物、大剑实体与剑锋火焰分为三组：人物斜向缓入，剑身围绕握点减速收稳，火焰随后沿剑锋铺展；双手始终跟随人物，落定后保持原构图。"],"elysia":["晶弓先到，箭矢随后沿箭杆方向入位。","晶弓缓出旋入并轻微回弹，箭矢以独立时序滑入。手指和弓弦保留，人物及背景仍沿原墨版方向展开。"],"aemeath":["机兵错峰浮升，减速回落，与少女构图归位。","机兵作为完整物件独立入场，少女保持原有轮廓，晶体与背景细节随非线性的墨浪显现。"],"vyron":["步枪先入，头顶夜视仪随后收稳。","枪械与三目夜视仪分开错峰入场。夜视仪的三个矩形光学盒与翻折支架保留，宇航服及轨道背景保持原稿。"],"luna":["复合弓旋入，箭矢随后沿射线滑入。","复合弓与箭矢分别计时，以缓出和短暂回弹收势。握弓手保持前景遮挡，弓弦、瞄具与天际线细节保留。"]};
for(const act of ACTS){act.caption=PRINT_STORIES[act.id][0];act.story=PRINT_STORIES[act.id][1];}
const ROOT_EXITS={bronya:{x:1450,y:-95,r:-3},kiana:{x:1250,y:-340,r:12},elysia:{x:-1030,y:-150,r:-7},aemeath:{x:70,y:-1580,r:-5},vyron:{x:1230,y:-1080,r:18},luna:{x:-1140,y:85,r:-4}};
const sourceMaterial=(source,name)=>{const index={paper:0,ink:1,accent:2}[name];const rgb=index===undefined?(source.gray||[128,136,165]):source.anchors[index].map(n=>Math.round(n*255));return '#'+rgb.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');};
// Bake the actual alpha silhouettes once. Cropping only reduces the transparent
// bitmap extent; the visible boundary is the anatomical/source graphic path.
// Animation then moves cached alpha images instead of repainting complex masks.
async function prepareSourceSprites(data,image,onProgress){
 const cache=new Map(),nodes=new Map(data.nodes.map(n=>[n.id,n]));let pixels=0,bytes=0,decoding=[];
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 if(!ctx)throw new Error('transparent source canvas unavailable');
 for(let i=0;i<data.nodes.length;i++){
  const n=data.nodes[i],bounds=n.spriteBounds;
  if(bounds){
   const [x,y,w,h]=bounds;canvas.width=w;canvas.height=h;ctx.setTransform(1,0,0,1,-x,-y);
   if(n.hiddenPath){ctx.fillStyle=sourceMaterial(data.source,n.material||'ink');ctx.fill(new Path2D(n.hiddenPath),'evenodd');}
   if(n.visiblePath){ctx.save();ctx.clip(new Path2D(n.visiblePath),'evenodd');ctx.drawImage(image,0,0);ctx.restore();}
   if(n.exclusionPaths){ctx.globalCompositeOperation='destination-out';ctx.fillStyle='#000';for(const d of [...n.exclusionPaths,...(n.exclusionParts||[]).map(id=>nodes.get(id).visiblePath)])if(d)ctx.fill(new Path2D(d),'evenodd');ctx.globalCompositeOperation='source-over';}
   const uri=canvas.toDataURL('image/png');const decoded=new Image();decoded.src=uri;cache.set(n.id,{uri,bounds,image:decoded});pixels+=w*h;bytes+=uri.length;decoding.push(decoded.decode());
  }
  if(i%20===0||i===data.nodes.length-1){await Promise.all(decoding);decoding=[];onProgress((i+1)/data.nodes.length);await new Promise(requestAnimationFrame);}
 }
 canvas.width=canvas.height=1;cache.stats={images:cache.size,pixels,encodedCharacters:bytes};return cache;
}
async function loadSourceSprites(data,onProgress){
 const cache=new Map();let pending=[],pixels=0,bytes=0;
 if(data.source.paperGrainTile?.uri){const image=new Image();image.src=data.source.paperGrainTile.uri;await image.decode();cache.paperImage=window.createImageBitmap?await createImageBitmap(image,{premultiplyAlpha:'premultiply',colorSpaceConversion:'none'}):image;cache.paperPattern=stageContext.createPattern(cache.paperImage,'repeat');}
 const assets=[...data.nodes,...(data.equipment||[]),...(data.equipment||[]).flatMap(o=>o.underpaint?[o.underpaint]:[]),...(data.foreground?[data.foreground]:[])];
 for(let i=0;i<assets.length;i++){
  const n=assets[i];if(n.spriteBounds){if(!n.sprite?.uri)throw new Error('missing alpha sprite '+data.id+'/'+n.id);const decoded=new Image();decoded.src=n.sprite.uri;pending.push(decoded.decode().then(async()=>{if(window.createImageBitmap)cache.get(n.id).image=await createImageBitmap(decoded,{premultiplyAlpha:'premultiply',colorSpaceConversion:'none'});}));cache.set(n.id,{uri:n.sprite.uri,bounds:n.spriteBounds,image:decoded});pixels+=n.spriteBounds[2]*n.spriteBounds[3];bytes+=n.sprite.uri.length;}
  if(i%40===0||i===assets.length-1){await Promise.all(pending);pending=[];onProgress((i+1)/assets.length);}
 }
 stageContext.warm?.(cache);cache.stats={images:cache.size,pixels,encodedCharacters:bytes};return cache;
}
class RigScene{
 constructor(data,theme,cache=M.sprites.get(data.id),exportSVG=false){
  this.data=data;this.theme=theme;this.node=svg('g',{'data-scene':data.id,'aria-hidden':'true'});this.paper=svg('g',{'data-paper':data.id,'aria-hidden':'true'});this.node.style.display='none';this.paper.style.display='none';this.parts=new Map();this.last=evaluateRig(data,0);this.visible=false;this.progress=0;
  this.cache=cache||new Map();this.exportSVG=exportSVG;
  for(const n of data.nodes){
   const g=svg('g',{'data-part':n.id,'data-role':n.role,'data-parent':n.parent||'','data-render-parent':n.renderParent??n.parent??'','data-semantic':n.semantic,'data-rig':String(n.part)});
   const sprite=cache.get(n.id);
   if(sprite&&exportSVG){const [x,y,width,height]=sprite.bounds,p=svg('image',{x,y,width,height,preserveAspectRatio:'none','data-sprite-source':data.id,'data-source-region':n.id,href:sprite.uri});g.append(p);}
   this.parts.set(n.id,{data:n,node:g,transform:'',opacity:''});
  }
  if(exportSVG)for(const n of data.nodes){const parentId=n.renderParent??n.parent;const parent=n.role==='paper'?this.paper:parentId?this.parts.get(parentId).node:this.node;parent.append(this.parts.get(n.id).node);}
  this.debug=svg('g',{'data-joints':data.id,'pointer-events':'none'});this.debug.style.display='none';this.lastWorld=null;
 }
 show(){this.visible=true;this.node.style.display='';this.paper.style.display='';this.debug.style.display='';this.node.setAttribute('aria-hidden','false');this.paper.setAttribute('aria-hidden','false');}
 hide(){this.visible=false;this.node.style.display='none';this.paper.style.display='none';this.debug.style.display='none';this.node.setAttribute('aria-hidden','true');this.paper.setAttribute('aria-hidden','true');}
 draw(poses){
  const result=constrainRig(this.data,poses);this.last=poses;this.lastWorld=result.world;
  if(this.exportSVG)for(const [id,p] of poses){const n=this.parts.get(id),parentId=n.data.renderParent??n.data.parent;const m=parentId?mul(inverse(result.world.get(parentId)),result.world.get(id)):result.world.get(id);const identity=m.every((v,i)=>Math.abs(v-unit()[i])<.000001),transform=identity?'':`matrix(${m.map(v=>v.toFixed(6)).join(' ')})`,opacity=p.a>=.99999?'':clamp(p.a).toFixed(4);if(n.transform!==transform){if(transform)n.node.setAttribute('transform',transform);else n.node.removeAttribute('transform');n.transform=transform;}if(n.opacity!==opacity){if(opacity)n.node.setAttribute('opacity',opacity);else n.node.removeAttribute('opacity');n.opacity=opacity;}}
  for(const s of result.strings){const path=this.parts.get(s.id)?.node.querySelector('[data-string]');if(path)path.setAttribute('d',s.d);}
  for(const s of result.wraps){const path=this.parts.get(s.id)?.node.querySelector('[data-wrap]');if(path)path.setAttribute('d',s.d);}
  this.debug.replaceChildren();
  if(M.joints)for(const n of this.data.nodes.filter(n=>n.part)){
   const q=point(result.world.get(n.id),n.pivot);
   if(n.parent){const parent=this.parts.get(n.parent).data,p=point(result.world.get(n.parent),parent.pivot);this.debug.append(svg('path',{d:`M${p[0]} ${p[1]}L${q[0]} ${q[1]}`,fill:'none',stroke:'var(--accent-ink)','stroke-width':2,'stroke-dasharray':'6 6',opacity:'.65'}));}
   this.debug.append(svg('circle',{cx:q[0],cy:q[1],r:n.visiblePath?4:7,fill:'var(--paper)',stroke:'var(--accent-ink)','stroke-width':3}));
  }
  return result;
 }
 intro(t){this.progress=clamp(t);if(this.exportSVG||M.joints)return this.draw(evaluateRig(this.data,1,M.reduced));}
 snapshot(){return new Map([...this.last].map(([id,p])=>[id,{...p}]));}
}
function paintStage(){
 if(!stageContext||!M.data)return;
 const ctx=stageContext,k=stageCanvas.width/1024;
 ctx.beginFrame?.(M.phase==='idle'&&M.progress>=1&&!M.out.length);
 ctx.setTransform(k,0,0,k,0,0);ctx.globalAlpha=1;
 ctx.fillStyle=M.scenes[M.index]?.cache.paperPattern||sourceMaterial(M.data.scenes[0].source,'paper');ctx.fillRect(0,0,1024,1536);
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='low';
 const active=M.scenes[M.index],ordered=[...M.out.map(x=>x.scene),active].filter((s,i,a)=>s?.visible&&a.indexOf(s)===i);
 for(const scene of ordered)paintInkPlates(ctx,scene,scene.progress||0,M.reduced,M.joints&&scene===active);
 ctx.endFrame?.(M.colourMatrix);
 ctx.globalAlpha=1;state.dataset.paintedSprites=String(ordered.reduce((sum,s)=>sum+s.cache.size,0));
}
const restAuditCache=new Map();let restAuditSerial=0;
async function auditNativeRest(scene){
 const key=M.data.signature+'/'+scene.data.id+'/'+(stageContext.kind||'canvas2d'),index=M.index;
 if(restAuditCache.has(key)){Object.assign(state.dataset,restAuditCache.get(key));return;}
 if(!crypto.subtle||scene.restAuditPending)return;scene.restAuditPending=true;const serial=++restAuditSerial;
 try{
  // Audit the actual composed stage, before its single CSS colour operation.
  // A separate readback context keeps the animation canvas accelerated.
  const copy=document.createElement('canvas');let rgb;
  if(stageContext.readRawRGB)rgb=stageContext.readRawRGB();else{copy.width=1024;copy.height=1536;const ctx=copy.getContext('2d',{willReadFrequently:true});ctx.drawImage(stageCanvas,0,0);const rgba=ctx.getImageData(0,0,1024,1536).data;rgb=new Uint8Array(1024*1536*3);for(let i=0,j=0;i<rgba.length;i+=4){rgb[j++]=rgba[i];rgb[j++]=rgba[i+1];rgb[j++]=rgba[i+2];}}
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',rgb))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const report={nativeCanvasAuditScene:scene.data.id,nativeCanvasRGBSHA256:hash,nativeCanvasMatchesOriginal:String(hash===scene.data.source.decodedRGBSHA256)};restAuditCache.set(key,report);
  if(M.index===index&&M.phase==='idle'&&M.progress>=1&&serial===restAuditSerial)Object.assign(state.dataset,report);
  copy.width=copy.height=1;
 }catch(error){state.dataset.nativeCanvasAuditError=error.message;}finally{scene.restAuditPending=false;}
}

function applyTheme(colors){M.theme=colors;const root=document.documentElement;for(const [k,v] of Object.entries(colors))root.style.setProperty('--'+k,v);root.style.setProperty('--blue',colors['accent-ink']||colors.accent);root.style.setProperty('--muted',colors.shade);root.style.setProperty('--rule',colors.ink+'35');document.querySelector('meta[name="theme-color"]')?.setAttribute('content',colors.paper);if(M.data){M.colourMatrix=sourceColourMatrix(M.data.scenes[0].source,colors);if(!stageContext.endFrame)$('#page-colour-map').setAttribute('values',M.colourMatrix.map(n=>n.toFixed(8)).join(' '));$('#paper-base').setAttribute('fill',sourceMaterial(M.data.scenes[0].source,'paper'));}}
function rampTheme(index,immediate=false){const target=M.data.themes.find(t=>t.id===ACTS[index].id).colors;if(immediate||!M.theme){applyTheme({...target});M.ramp=null;return;}M.ramp={from:{...M.theme},to:target,start:performance.now(),duration:M.reduced?200:400};}
function themeFrame(now){if(!M.ramp)return;const q=clamp((now-M.ramp.start)/M.ramp.duration);applyTheme(mixTheme(M.ramp.from,M.ramp.to,cubicPrint(q,'glide')));M.themeFrames++;if(q>=1)M.ramp=null;}
const GLYPHS=['<circle cx="28" cy="74" r="22"/><circle cx="82" cy="74" r="22"/><path d="M9 101L102 15M28 74L56 30L82 74"/>','<path d="M21 105L83 8L94 17L44 103ZM35 72L68 96M62 5L56 27M82 75L103 55"/>','<path d="M58 6Q110 56 58 106L58 6ZM58 6L17 56L58 106M8 56H106"/>','<path d="M56 6L67 43L106 56L67 69L56 106L44 69L6 56L44 43Z"/><circle cx="56" cy="56" r="44"/>','<ellipse cx="56" cy="56" rx="52" ry="19" transform="rotate(-35 56 56)"/><circle cx="56" cy="56" r="32"/><path d="M48 28H64V70H48ZM51 22V15M61 22V15"/>','<path d="M7 106V79H22V90H35V55H50V80H65V40H80V67H94V18H105V106M9 24L101 91M84 90L101 91L96 74"/>'];
function metadata(){const a=ACTS[M.index];$('#act-tag').textContent=a.act;$('#scene-name').textContent=a.title;$('#scene-credit').textContent=a.credit;$('#scene-story').textContent=a.story;$('#signature-label').textContent=a.signature;$('#scene-caption').textContent=a.caption;$('#act-glyph').innerHTML=`<svg viewBox="0 0 112 112" aria-hidden="true">${GLYPHS[M.index]}</svg>`;$('#poster-title').textContent=a.name+'动态海报';$('#poster-desc').textContent=a.story;$('#poster').setAttribute('data-character',a.id);for(const b of $$('.character-link')){const yes=b.dataset.character===a.id;b.classList.toggle('is-active',yes);b.setAttribute('aria-pressed',String(yes));}document.title=a.name+' — FORMA / INK IN MOTION';try{history.replaceState(null,'','#'+a.id);}catch{} }
function wake(){if(!M.frame)M.frame=requestAnimationFrame(tick);}
function trimCaches(){
 // All six scenes remain decoded, so switching never triggers a network read.
}
async function ensureScene(index){
 const scene=M.scenes[index];scene.usedAt=performance.now();if(scene.cache.size)return;
 if(!scene.loading)scene.loading=loadSourceSprites(scene.data,()=>{}).then(cache=>{scene.cache=cache;M.sprites.set(scene.data.id,cache);}).finally(()=>{scene.loading=null;trimCaches();});
 await scene.loading;
}
function warmNext(){
 // Every scene is already warm before the loader is dismissed.
}
function replay(){if(M.phase==='loading')return;M.loadToken++;M.requested=null;$('#stage-loading').hidden=true;for(const b of $$('.is-queued'))b.classList.remove('is-queued');M.out=[];M.scenes.forEach(s=>s.hide());const scene=M.scenes[M.index];scene.show();M.phase='intro';M.progress=0;M.paused=false;M.arrival=null;M.start=performance.now();M.duration=scene.data.duration/M.speed;scene.intro(0);resizeStage();metadata();controls();wake();}
async function choose(index){
 if(M.phase==='loading')return;index=(index+6)%6;if(index===M.index){replay();return;}
 const token=++M.loadToken;M.requested=index;
 for(const b of $$('.character-link'))b.classList.toggle('is-queued',b.dataset.character===ACTS[index].id);
 const loading=$('#stage-loading');loading.textContent='正在准备 '+ACTS[index].id.toUpperCase();loading.hidden=M.scenes[index].cache.size>0;
 try{await ensureScene(index);}catch(error){if(token===M.loadToken){loading.textContent='载入失败，请再次选择角色';state.dataset.error=error.message;}return;}
 if(token!==M.loadToken)return;M.requested=null;loading.hidden=true;for(const b of $$('.is-queued'))b.classList.remove('is-queued');
 const now=performance.now(),incoming=M.scenes[index],previous=M.scenes[M.index],progress=incoming.visible?incoming.progress:0;
 for(const scene of M.scenes)if(scene!==previous&&scene!==incoming)scene.hide();
 M.out=previous.visible?[{scene:previous,fromProgress:previous.progress,start:now,duration:M.reduced?180:300}]:[];
 if(AUDIT_NATIVE)M.audit={start:now,last:now,samples:[]};M.index=index;M.progress=progress;M.arrival=null;M.phase='transition';M.paused=false;M.duration=incoming.data.duration/M.speed;M.start=now-progress*M.duration;
 incoming.intro(progress);incoming.show();M.transitions++;resizeStage();metadata();rampTheme(index);controls();wake();
}
function departing(item,t){
 return departureRig(item.scene.data,item.from,t,ROOT_EXITS[item.scene.data.id]);
}
function tick(now){
 const workStart=performance.now();M.frame=0;if(M.paused||document.hidden)return;themeFrame(now);
 const p=Math.max(M.progress,clamp((now-M.start)/M.duration));M.progress=p;const active=M.scenes[M.index];active.intro(p);
 for(const item of M.out){const q=clamp((now-item.start)/item.duration);if(q>=1)item.scene.hide();else item.scene.intro(item.fromProgress*(1-cubicPrint(q,'calm')));}
 M.out=M.out.filter(x=>x.scene.visible);
 if(p>=1&&!M.out.length){if(M.phase!=='idle'){M.phase='idle';active.intro(1);M.settled++;resizeStage(true);trimCaches();warmNext();}}else M.phase=M.out.length?'transition':'intro';
 paintStage();controls(false,p>=1);
 if(M.audit){const a=M.audit,elapsed=now-a.start;a.samples.push({t:Math.round(elapsed*10)/10,gap:Math.round((now-a.last)*10)/10,workMs:Math.round((performance.now()-workStart)*100)/100});a.last=now;if(elapsed>=Math.min(1000,M.duration)||M.phase==='idle'){state.dataset.frameAudit=JSON.stringify({scene:active.data.id,elapsed,frames:a.samples.length,fps:a.samples.length*1000/elapsed,maxGap:Math.max(...a.samples.map(s=>s.gap)),samples:a.samples});M.audit=null;}}
 if(M.phase!=='idle'||M.ramp)wake();
}
function controls(paint=true,force=true){
 if(M.phase==='idle'&&stageCanvas.width!==1024)resizeStage(true);
 if(paint)paintStage();const now=performance.now();if(!force&&now-M.lastControls<80)return;M.lastControls=now;
 const s=M.scenes[M.index],p=M.phase==='idle'?1:M.progress;timeline.disabled=M.phase==='loading'||M.out.length>0;timeline.value=String(Math.round(p*1000));timeline.style.setProperty('--progress',`${p*100}%`);timeline.setAttribute('aria-valuetext',`动画进度 ${Math.round(p*100)}%`);const d=s.data.duration/1000;$('#timecode').textContent=`${(p*d).toFixed(1)} / ${d.toFixed(1)}`;$('#stage-state').textContent=M.phase==='idle'?'IN PRINT':M.paused?'PAUSED':M.out.length?'CHANGING SCENES':'IN MOTION';const play=M.paused||M.phase==='idle';$('#play').setAttribute('aria-label',M.phase==='idle'?'重播动画':play?'继续动画':'暂停动画');const icon=play?'play':'pause';if($('#play-icon').dataset.icon!==icon){$('#play-icon').dataset.icon=icon;$('#play-icon').innerHTML=play?'<path d="M7 4L19 12L7 20Z"/>':'<path d="M8 5V19M16 5V19"/>';}
 Object.assign(state.dataset,{phase:M.phase,scene:s.data.id,progress:String(p),paused:String(M.paused),equipmentCount:String(s.data.equipment?.length||0),layers:String(s.data.nodes.length),bodyParts:String(s.data.nodes.filter(n=>n.part).length),visibleScenes:String(M.scenes.filter(s=>s.visible).length),transitions:String(M.transitions),settled:String(M.settled),texture:String(M.texture),themeFrames:String(M.themeFrames),themeAccent:M.theme?.accent||'',rigidTransforms:'true'});
 if(AUDIT_NATIVE&&(M.paused||M.phase==='idle')){if(!s.lastWorld)s.draw(s.last);state.dataset.poseAudit=JSON.stringify({scene:s.data.id,time:p,wave:s.data.wave,inkProgress:s.progress,renderer:'independent-source-equipment-v7',equipment:(s.data.equipment||[]).map(o=>({id:o.id,pivot:o.pivot,pose:equipmentPose(o,p,M.reduced),entry:o.entry})),filter:getComputedStyle(stageCanvas).filter,canvas:[stageCanvas.width,stageCanvas.height],parts:s.data.nodes.filter(n=>s.cache.has(n.id)).map(n=>({id:n.id,role:n.role,matrix:s.lastWorld.get(n.id),alpha:s.last.get(n.id).a}))});}
 if(AUDIT_NATIVE&&M.phase==='idle'&&M.progress>=1&&!M.out.length){if(window.requestIdleCallback)requestIdleCallback(()=>auditNativeRest(s),{timeout:500});else setTimeout(()=>auditNativeRest(s),0);}
 state.textContent=ACTS[M.index].name+' · '+(M.phase==='idle'?'海报已完整构成':M.paused?'动作已暂停':'正在入场');
}
function shiftPausedClock(now){const dt=Math.max(0,now-(M.pausedAt??now));M.start+=dt;for(const x of M.out)x.start+=dt;if(M.arrival)M.arrival.start+=dt;if(M.ramp)M.ramp.start+=dt;M.pausedAt=now;}
function pause(){if(M.phase==='loading')return;if(M.phase==='idle'){replay();return;}M.paused=!M.paused;if(M.paused){if(M.frame)cancelAnimationFrame(M.frame);M.frame=0;M.pausedAt=performance.now();}else{shiftPausedClock(performance.now());wake();}controls();}
function paper(){const c=$('#paper-film'),ctx=c.getContext('2d',{alpha:true});if(!ctx)return;let seed=193743;const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};const data=ctx.createImageData(c.width,c.height),a=data.data;for(let i=0;i<a.length;i+=4){const pale=rnd()>.57;a[i]=pale?250:45;a[i+1]=pale?238:36;a[i+2]=pale?216:24;a[i+3]=rnd()>.996?110:Math.floor(rnd()*40);}ctx.putImageData(data,0,0);ctx.lineWidth=.55;for(let i=0;i<1700;i++){const x=rnd()*1024,y=rnd()*1536,l=2+rnd()*10;ctx.strokeStyle=i%2?'rgba(250,238,216,.11)':'rgba(55,38,19,.075)';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+l*.4,y+l);ctx.stroke();}}
function pressed(action,on){for(const b of $$(`[data-action="${action}"]`)){b.setAttribute('aria-pressed',String(on));const label=b.querySelector('span:last-child');if(label)label.textContent=on?'ON':'OFF';}}
function texture(){M.texture=!M.texture;$('#paper-film').classList.toggle('is-off',!M.texture);pressed('texture',M.texture);controls();}
function reduced(){M.reduced=!M.reduced;pressed('motion',M.reduced);replay();}
function joints(){M.joints=!M.joints;pressed('joints',M.joints);M.scenes.filter(s=>s.visible).forEach(s=>s.draw(s.snapshot()));paintStage();}
function speed(){const p=M.progress,now=performance.now();if(M.paused)shiftPausedClock(now);M.speed=M.speed===1?.5:1;M.duration=M.scenes[M.index].data.duration/M.speed;M.start=now-p*M.duration;for(const b of $$('[data-action="speed"]'))b.querySelector('span:last-child').textContent=M.speed+'×';if(!M.paused&&M.phase!=='idle')wake();}
async function fullScreen(){const shell=$('#stage-shell');if(shell.classList.contains('fallback-fullscreen')){shell.classList.remove('fallback-fullscreen');return;}try{if(document.fullscreenElement)await document.exitFullscreen();else await shell.requestFullscreen();}catch{shell.classList.add('fallback-fullscreen');}}
async function download(){
 const data=M.scenes[M.index].data,theme=M.data.themes.find(t=>t.id===data.id),s=new RigScene(data,theme,M.sprites.get(data.id),true);
 s.intro(1);s.debug.remove();s.show();
 const values=sourceColourMatrix(data.source,theme.colors).map(n=>n.toFixed(8)).join(' '),rawPaper=sourceMaterial(data.source,'paper');
 const uris=new Map();for(const n of [...data.nodes,...(data.equipment||[])]){let uri=n.sprite.uri;if(!uri.startsWith('data:')){const cached=s.cache.get(n.id),copy=document.createElement('canvas');copy.width=cached.bounds[2];copy.height=cached.bounds[3];copy.getContext('2d').drawImage(cached.image,0,0);uri=copy.toDataURL('image/png');copy.width=copy.height=1;}uris.set(n.id,uri);}
 for(const image of [...s.paper.querySelectorAll('image'),...s.node.querySelectorAll('image')])image.setAttribute('href',uris.get(image.getAttribute('data-source-region')));
 const equipment=(data.equipment||[]).map(o=>{const [x,y,width,height]=o.spriteBounds;return `<g id="${o.id}" data-layer-group="${o.role||'equipment'}"><image x="${x}" y="${y}" width="${width}" height="${height}" href="${uris.get(o.id)}"/></g>`;}).join('');
 const text=`<svg xmlns="${NS}" width="1024" height="1536" viewBox="0 0 1024 1536" style="${themeStyle(theme.colors)}"><title>${data.id.toUpperCase()} — FORMA</title><metadata>${JSON.stringify({source:data.id,sourceRGBSHA256:data.source.decodedRGBSHA256,packetSignature:M.data.signature,renderer:'independent-source-equipment-v7'})}</metadata><defs><filter id="export-palette" filterUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1536" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${values}"/></filter></defs><g filter="url(#export-palette)"><rect width="1024" height="1536" fill="${rawPaper}"/>${s.paper.outerHTML}${s.node.outerHTML}${equipment}</g></svg>`;
 const url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='forma-source-'+data.id+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function bind(){
 let hiddenAt=null;document.addEventListener('visibilitychange',()=>{if(document.hidden){hiddenAt=performance.now();if(M.frame)cancelAnimationFrame(M.frame);M.frame=0;}else if(hiddenAt!==null){const dt=performance.now()-hiddenAt;M.start+=dt;for(const item of M.out)item.start+=dt;if(M.ramp)M.ramp.start+=dt;if(M.pausedAt)M.pausedAt+=dt;if(M.audit){M.audit.start+=dt;M.audit.last+=dt;}hiddenAt=null;if(!M.paused&&M.phase!=='idle'&&M.phase!=='loading')wake();}});
 timeline.disabled=true;
 for(const b of $$('.character-link')){b.dataset.testid='select-'+b.dataset.character;b.addEventListener('click',()=>choose(ACTS.findIndex(a=>a.id===b.dataset.character)));}
 $('#prev').addEventListener('click',()=>choose(M.index-1));$('#next').addEventListener('click',()=>choose(M.index+1));$('#play').addEventListener('click',pause);$('#replay').addEventListener('click',replay);
 const actions={texture,motion:reduced,fullscreen:fullScreen,download,joints,speed};for(const b of $$('[data-action]'))b.addEventListener('click',()=>{if(M.phase!=='loading')actions[b.dataset.action]?.();});
 $('#fullscreen-close').addEventListener('click',fullScreen);
 timeline.addEventListener('input',()=>{if(timeline.disabled||M.out.length)return;if(M.frame)cancelAnimationFrame(M.frame);M.frame=0;M.ramp=null;M.arrival=null;M.progress=Number(timeline.value)/1000;M.phase=M.progress>=1?'idle':'intro';M.paused=true;M.pausedAt=performance.now();M.start=M.pausedAt-M.progress*M.duration;rampTheme(M.index,true);M.scenes[M.index].intro(M.progress);controls();});
 for(const [id,panelId] of [['help-toggle','help-panel'],['about-toggle','about-panel']]){const b=$('#'+id),p=$('#'+panelId);b.addEventListener('click',()=>{p.showModal();b.setAttribute('aria-expanded','true');});p.querySelector('[data-close-dialog]').addEventListener('click',()=>p.close());p.addEventListener('close',()=>b.setAttribute('aria-expanded','false'));}
 document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#stage-shell').classList.remove('fallback-fullscreen');if(e.altKey||e.ctrlKey||e.metaKey||e.target.matches('input,textarea,select')||document.querySelector('dialog[open]'))return;if(e.key==='ArrowRight'){e.preventDefault();choose(M.index+1);}else if(e.key==='ArrowLeft'){e.preventDefault();choose(M.index-1);}else if(e.code==='Space'){e.preventDefault();pause();}else if(e.key.toLowerCase()==='r')replay();});
 const surface=$('#poster-surface');let start=null;surface.style.touchAction='pan-y';surface.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;start=[e.clientX,e.clientY];surface.setPointerCapture(e.pointerId);});surface.addEventListener('pointerup',e=>{if(!start)return;const x=e.clientX-start[0],y=e.clientY-start[1];if(Math.abs(x)>45&&Math.abs(x)>Math.abs(y)*1.3)choose(M.index+(x<0?1:-1));start=null;});surface.addEventListener('pointercancel',()=>start=null);
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&!M.paused&&M.phase!=='idle'){M.resumeOnVisible=true;pause();}else if(!document.hidden&&M.resumeOnVisible){M.resumeOnVisible=false;if(M.paused)pause();}});
 window.addEventListener('hashchange',()=>{const n=ACTS.findIndex(a=>a.id===location.hash.slice(1));if(n>=0&&n!==M.index)choose(n);});$('#load-retry').addEventListener('click',()=>location.reload());
}
/*INLINE_DATA_BEGIN*/
async function loadData(){
 const response=await fetch('assets/source-equipment-v7.json',{signal:AbortSignal.timeout(45000)});if(!response.ok)throw new Error('source data '+response.status);
 const size=Number(response.headers.get('Content-Length'))||0,reader=response.body?.getReader();if(!reader)return response.json();
 const chunks=[];let received=0;
 while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.byteLength;const q=size?Math.min(70,received/size*70):Math.min(65,received/350000);$('#load-count').textContent=Math.round(q)+'%';$('#load-bar').style.width=q+'%';$('#load-caption').textContent='正在读取原稿细节与分层轮廓';}
 const bytes=new Uint8Array(received);let at=0;for(const q of chunks){bytes.set(q,at);at+=q.byteLength;}return JSON.parse(new TextDecoder().decode(bytes));
}
/*INLINE_DATA_END*/
async function boot(){const began=performance.now();try{
 bind();paper();resizeStage();new ResizeObserver(resizeStage).observe($('#poster-surface'));M.data=await loadData();if(M.data.version!==3||M.data.scenes.length!==6)throw new Error('incomplete approved-source collection');
 M.index=Math.max(0,ACTS.findIndex(a=>a.id===location.hash.slice(1)));rampTheme(M.index,true);
 for(let i=0;i<6;i++){
  const data=M.data.scenes.find(s=>s.id===ACTS[i].id),theme=M.data.themes.find(t=>t.id===ACTS[i].id);if(!data?.nodes.length||!theme||!data.source?.losslessVerified)throw new Error('missing approved source '+ACTS[i].id);
  const scene=new RigScene(data,theme,new Map());M.scenes.push(scene);paperMount.append(scene.paper);mount.append(scene.node);jointMount.append(scene.debug);
 }
 const order=[M.index,...ACTS.map((_,i)=>i).filter(i=>i!==M.index)];let prepared=0;
 for(let i=0;i<order.length;i+=2)await Promise.all(order.slice(i,i+2).map(async index=>{await ensureScene(index);prepared++;const progress=70+prepared/6*30;$('#load-count').textContent=Math.round(progress)+'%';$('#load-bar').style.width=progress+'%';$('#load-caption').textContent='正在准备全部海报 · '+prepared+' / 6';}));
 await Promise.all([document.fonts.load('16px "Anton"'),document.fonts.load('12px "JetBrains Mono"')]);await document.fonts.ready;
 stageContext.ready?.();state.dataset.compositor=stageContext.kind||'canvas2d';

 applyTheme(M.theme);pressed('texture',M.texture);$('#paper-film').classList.toggle('is-off',!M.texture);
 $('#load-caption').textContent='原稿分层就绪，开始第一场动作';metadata();await new Promise(r=>setTimeout(r,Math.max(0,(M.reduced?100:250)-(performance.now()-began))));
 $('#app').classList.add('is-ready');$('#app').setAttribute('aria-busy','false');$('#loader').classList.add('is-gone');$('#loader').setAttribute('aria-hidden','true');Object.assign(state.dataset,{ready:'true',assetCount:'6',version:'3',assetSignature:M.data.signature,bodyNodes:String(M.data.scenes.reduce((n,s)=>n+s.nodes.filter(n=>n.part).length,0)),sourceGeometry:'approved-original-pixels',renderer:'independent-source-equipment-v7',spriteCount:String([...M.sprites.values()].reduce((sum,c)=>sum+c.size,0)),loadMilliseconds:String(Math.round(performance.now()-began))});M.phase='intro';replay();
 }catch(error){console.error('FORMA boot failed',error);$('#load-caption').textContent='载入失败：'+error.message;$('#load-count').textContent='—';$('#load-retry').hidden=false;state.dataset.error=error.message;}}
boot();
