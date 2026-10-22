// Print-wave geometry adapted from AconHol/ink-plates (MIT).
// See THIRD_PARTY_ink-plates_LICENSE.txt for the original notice.
export const clampPrint=n=>Math.max(0,Math.min(1,n));
// Curves used by ink-plates: glide into position, then calm the overshoot.
export const PRINT_CURVES={out:[.16,1,.3,1],glide:[.22,.61,.28,1],drift:[.32,.02,.24,1],calm:[.36,.01,.16,1],breath:[.42,0,.32,1]};
const curveTables=new Map();
export function cubicPrint(t,curve='glide'){
 t=clampPrint(t);if(t===0||t===1)return t;
 const key=Array.isArray(curve)?curve.join(','):curve;
 let table=curveTables.get(key);
 if(!table){table=new Float64Array(513);for(let i=0;i<=512;i++)table[i]=solvePrint(i/512,curve);curveTables.set(key,table);}
 const q=t*512,i=Math.floor(q);return table[i]+(table[i+1]-table[i])*(q-i);
}
function solvePrint(t,curve){
 if(t===0||t===1)return t;
 const [x1,y1,x2,y2]=Array.isArray(curve)?curve:PRINT_CURVES[curve];
 const at=(u,a,b)=>3*(1-u)*(1-u)*u*a+3*(1-u)*u*u*b+u*u*u;
 let lo=0,hi=1,u=t;
 for(let k=0;k<18;k++){const x=at(u,x1,x2);if(Math.abs(x-t)<1e-7)break;if(x<t)lo=u;else hi=u;u=(lo+hi)/2;}
 return at(u,y1,y2);
}
export const easePrint=t=>cubicPrint(t,'calm');
export function equipmentPose(object,t,reduced=false){
 const e=object.entry,q=clampPrint((t-e.start)/(e.end-e.start));
 if(q===0)return {x:e.from.x,y:e.from.y,r:e.from.r,a:0,progress:0};
 if(q===1)return {x:0,y:0,r:0,a:1,progress:1};
 if(reduced)return {x:0,y:0,r:0,a:cubicPrint(q,'breath'),progress:q};
 const split=1-e.settle;
 const left=q<split?1-(1+e.overshoot)*cubicPrint(q/split,e.ease):-e.overshoot*(1-cubicPrint((q-split)/e.settle,'calm'));
 return {x:e.from.x*left,y:e.from.y*left,r:e.from.r*left,a:cubicPrint(q/.24,'out'),progress:q};
}
const hashPrint=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
const TAU_PRINT=Math.PI*2;
export function plateProgress(t,index){
 const start=[0,.10,.04,.16][index],end=[.62,.96,.88,.99][index];
 return easePrint((t-start)/(end-start));
}
export function wavePolygon(wave,p,index){
 const flipped=Boolean(wave.flip)!==Boolean(index%2),q=flipped?1-p:p;
 if(wave.kind==='radial'){
  const cx=wave.cx*1024,cy=wave.cy*1536,r=Math.hypot(Math.max(cx,1024-cx),Math.max(cy,1536-cy))+32;
  const circle=Array.from({length:81},(_,k)=>{const a=k/80*TAU_PRINT,rr=q*r+(hashPrint(k*2.9)-.5)*10*p*(1-p);return [cx+Math.cos(a)*rr,cy+Math.sin(a)*rr];});
  return flipped?{outer:[[-40,-40],[1064,-40],[1064,1576],[-40,1576]],hole:circle}:{outer:circle};
 }
 if(wave.kind==='angular'){
  const cx=wave.cx*1024,cy=wave.cy*1536,start=(wave.start||0)*TAU_PRINT,end=start+(flipped?-1:1)*p*TAU_PRINT;
  return {outer:[[cx,cy],...Array.from({length:65},(_,k)=>{const a=start+(end-start)*k/64;return [cx+Math.cos(a)*2400,cy+Math.sin(a)*2400];})]};
 }
 const a=(wave.angle||0)*Math.PI/180,ux=Math.cos(a),uy=Math.sin(a),px=-uy,py=ux;
 const projection=[[0,0],[1024,0],[0,1536],[1024,1536]].map(([x,y])=>x*ux+y*uy),mn=Math.min(...projection)-24,mx=Math.max(...projection)+24;
 const front=mn+q*(mx-mn),back=flipped?mx+2400:mn-2400;
 const pts=Array.from({length:35},(_,k)=>{const along=(k/34-.5)*4800,jag=(hashPrint(k*3.17)-.5)*14*Math.sin(p*Math.PI);return [ux*(front+jag)+px*along,uy*(front+jag)+py*along];});
 pts.push([ux*back+px*2400,uy*back+py*2400],[ux*back-px*2400,uy*back-py*2400]);
 return {outer:pts};
}
function polyPrint(ctx,pts){ctx.moveTo(...pts[0]);for(let i=1;i<pts.length;i++)ctx.lineTo(...pts[i]);ctx.closePath();}
export function paintInkPlates(ctx,scene,t,reduced=false,legend=false){
 const data=scene.data,cache=scene.cache,p=clampPrint(t);
 if(p<=0)return;
 // A light proof comes from the same ink plates, never a terminal image swap.
 const proof=.055*(1-easePrint(p/.6));
 if(proof>0){ctx.save();ctx.globalAlpha=proof;for(const n of data.nodes)ctx.drawImage(cache.get(n.id).image,0,0);ctx.restore();}
 for(let i=0;i<data.nodes.length;i++){
  const n=data.nodes[i],sprite=cache.get(n.id),q=reduced?easePrint(p):plateProgress(p,i);if(q<=0)continue;
  ctx.save();
  if(reduced){ctx.globalAlpha=q;ctx.drawImage(sprite.image,0,0);ctx.restore();continue;}
  if(q<1){const geometry=wavePolygon(data.wave,q,i);ctx.beginPath();polyPrint(ctx,geometry.outer);if(geometry.hole)polyPrint(ctx,geometry.hole);ctx.clip('evenodd');
   // Subpixel register slip belongs to each ink plate; all channels reach zero.
   const slip=(i%2?1:-1)*1.2*(1-q);ctx.translate(slip,0);
  }
  ctx.drawImage(sprite.image,0,0);ctx.restore();
 }
 if(!reduced&&p<.84)paintInkFocus(ctx,data.id,p);
 // Equipment is absent from the base plates. Each continuous source-alpha asset
 // has its own clock, rigid pose and Bézier settling; no duplicate stays behind.
 for(const object of data.equipment||[]){
  const pose=equipmentPose(object,p,reduced);if(pose.a<=0)continue;
  const sprite=cache.get(object.id),[x,y]=sprite.bounds,[px,py]=object.pivot;
  ctx.save();ctx.globalAlpha=pose.a;
  if(pose.x||pose.y||pose.r){ctx.translate(px+pose.x,py+pose.y);ctx.rotate(pose.r*Math.PI/180);ctx.translate(-px,-py);}
  if(object.role==='flame'&&!reduced&&p<1){
   const reveal=cubicPrint((p-object.reveal.start)/(object.reveal.end-object.reveal.start),'glide');
   if(reveal<=0){ctx.restore();continue;}
   if(reveal<1){const geometry=wavePolygon({kind:'linear',angle:object.reveal.angle},reveal,0);ctx.beginPath();polyPrint(ctx,geometry.outer);ctx.clip();}
   // A short extension along the blade, then a calm return to the source.
   const stretch=1+.012*Math.sin(Math.PI*pose.progress)**2;
   ctx.translate(px,py);ctx.scale(stretch,stretch);ctx.translate(-px,-py);
  }
  if(object.underpaint){const underpaint=cache.get(object.underpaint.id);ctx.drawImage(underpaint.image,...underpaint.bounds.slice(0,2));}
  ctx.drawImage(sprite.image,x,y);ctx.restore();
 }
 // Source hands and rider stay in front of the equipment at their original pose.
 if(data.foreground){
  const f=cache.get(data.foreground.id),owner=(data.equipment||[]).find(o=>o.id===data.foregroundFollows);ctx.save();
  if(owner){const pose=equipmentPose(owner,p,reduced),[px,py]=owner.pivot;ctx.globalAlpha=pose.a;ctx.translate(px+pose.x,py+pose.y);ctx.rotate(pose.r*Math.PI/180);ctx.translate(-px,-py);}
  else ctx.globalAlpha=cubicPrint((p-.12)/.56,'glide');
  ctx.drawImage(f.image,...f.bounds.slice(0,2));ctx.restore();
 }
 if(legend){ctx.save();ctx.fillStyle='rgba(232,217,198,.93)';ctx.fillRect(24,24,312,48);for(let i=0;i<4;i++){ctx.fillStyle=['#e8d9c6','#111113','#0f3d9e','#8890a8'][i];ctx.fillRect(40+i*70,37,40,20);}ctx.restore();}
}
function paintInkFocus(ctx,id,p){
 if(id==='elysia'||id==='luna'||id==='kiana')return;
 const envelope=Math.sin(Math.PI*clampPrint(p/.84))**2;if(envelope<.01)return;
 ctx.save();ctx.globalAlpha=.28*envelope;ctx.strokeStyle='#0f3d9e';ctx.lineWidth=2.2;ctx.lineCap='round';ctx.beginPath();
 if(id==='bronya'){for(let i=0;i<5;i++){const y=1010+i*74,x=40+easePrint(p)*180;ctx.moveTo(x,y);ctx.lineTo(x+72+i*18,y-21);} }
 else if(id==='elysia'){ctx.moveTo(994,48);ctx.lineTo(356,589);ctx.lineTo(848,1277);ctx.moveTo(356,589);ctx.lineTo(990,681);}
 else if(id==='luna'){ctx.moveTo(628,146);ctx.lineTo(338,710);ctx.lineTo(935,1215);ctx.moveTo(338,710);ctx.lineTo(939,590);ctx.moveTo(921,590);ctx.lineTo(957,590);ctx.moveTo(939,572);ctx.lineTo(939,608);}
 else if(id==='kiana'){ctx.moveTo(278,440);ctx.lineTo(345,1410);ctx.moveTo(315,499);ctx.lineTo(379,1370);}
 else if(id==='aemeath'){for(let i=0;i<5;i++){const x=460+i*43,y=700+Math.sin(i)*120,r=14+15*cubicPrint(p/.84,'glide');ctx.moveTo(x,y-r);ctx.lineTo(x+r*.55,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r*.55,y);ctx.closePath();}}
 else {ctx.ellipse(556,744,345,170,-.55,-Math.PI*.8,-Math.PI*.8+TAU_PRINT*easePrint(p));}
 ctx.stroke();ctx.restore();
}
