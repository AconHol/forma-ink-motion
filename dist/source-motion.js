export const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
export const lerp=(a,b,t)=>a+(b-a)*t;
export const smooth=t=>{t=clamp(t);return t*t*t*(t*(t*6-15)+10);};
export const pose=()=>({x:0,y:0,r:0,a:1});
export const mixPose=(a,b,t)=>({x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),r:lerp(a.r,b.r,t),a:lerp(a.a,b.a,t)});
const trackCache=new WeakMap();
export function sampleTrack(track,t){
 if(!track?.length)return pose();
 let frames=trackCache.get(track);
 if(!frames){let previous=pose();frames=track.map(f=>{previous={...previous,...f};return {...previous};});trackCache.set(track,frames);}
 if(t<=frames[0].t)return {...pose(),...frames[0]};
 for(let i=1;i<frames.length;i++)if(t<=frames[i].t){const a=frames[i-1],b=frames[i],q=smooth((t-a.t)/(b.t-a.t));return mixPose(a,b,q);}
 return {...pose(),...frames[frames.length-1]};
}
export const transform=(p,pivot)=>`translate(${p.x.toFixed(3)} ${p.y.toFixed(3)}) rotate(${p.r.toFixed(4)} ${pivot[0]} ${pivot[1]})`;
export function localMatrix(p,[x,y]){const r=p.r*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return [c,s,-s,c,p.x+x-c*x+s*y,p.y+y-s*x-c*y];}
export const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
export const unit=()=>[1,0,0,1,0,0];
export const point=(m,[x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
export function inverse(m){const d=m[0]*m[3]-m[1]*m[2];return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];}
export function matrices(nodes,poses){const map=new Map(nodes.map(n=>[n.id,n])),cache=new Map();const get=id=>{if(cache.has(id))return cache.get(id);const n=map.get(id),m=mul(n.parent?get(n.parent):unit(),localMatrix(poses.get(id)||pose(),n.pivot));cache.set(id,m);return m;};nodes.forEach(n=>get(n.id));return cache;}
export function evaluateRig(scene,t,reduced=false){
 const poses=new Map(scene.nodes.map(n=>[n.id,sampleTrack(n.motion,t)]));
 if(reduced)for(const n of scene.nodes){const p=poses.get(n.id);if(n.parent){p.x=0;p.y=0;p.r=0;}else{p.x=0;p.r=0;p.y*=.06;}}
 for(const n of scene.nodes)if(n.roll){const driver=poses.get(n.roll.driver);if(driver)poses.get(n.id).r=driver.x/n.roll.radius*180/Math.PI;}
 return poses;
}
export function departureRig(scene,from,t,fallback){
 const poses=new Map(),figureQ=smooth(clamp((t-.28)/.72)),plateQ=smooth(clamp(t/.24));
 for(const n of scene.nodes){
  const initial=from.get(n.id),base=sampleTrack(n.motion,1);
  if(!n.part){poses.set(n.id,{...initial,a:initial.a*(1-plateQ)});continue;}
  let target={...base};
  if(!n.parent)target={...base,...(scene.rootExits?.[n.id]||fallback),a:1};
  if(n.exitFade)target.a=0;
  poses.set(n.id,mixPose(initial,target,figureQ));
 }
 for(const n of scene.nodes)if(n.roll)poses.get(n.id).r=poses.get(n.roll.driver).x/n.roll.radius*180/Math.PI;
 return poses;
}
export function constrainRig(scene,poses){
 let world=matrices(scene.nodes,poses);const map=new Map(scene.nodes.map(n=>[n.id,n]));
 for(const c of scene.constraints||[])if(c.type==='two-bone'){
  const upper=map.get(c.upper),lower=map.get(c.lower),up=poses.get(c.upper),lo=poses.get(c.lower),parent=upper.parent?world.get(upper.parent):unit();
  const target=point(inverse(parent),point(world.get(c.target.node),c.target.point));
  const s=[upper.pivot[0]+up.x,upper.pivot[1]+up.y],e=lower.pivot,b=c.end,l1=Math.hypot(e[0]-upper.pivot[0],e[1]-upper.pivot[1]),l2=Math.hypot(b[0]-e[0],b[1]-e[1]);
  let dx=target[0]-s[0],dy=target[1]-s[1],d=Math.hypot(dx,dy);
  if(d>l1+l2-.0001){const shift=Math.min(c.shoulderAllowance||0,d-l1-l2+.0001);up.x+=dx/d*shift;up.y+=dy/d*shift;s[0]+=dx/d*shift;s[1]+=dy/d*shift;dx=target[0]-s[0];dy=target[1]-s[1];d=Math.hypot(dx,dy);}
  const reach=clamp(d,Math.abs(l1-l2)+.0001,l1+l2-.0001),theta=Math.atan2(dy,dx),bend=c.bend||1;
  const shoulderAngle=theta+bend*Math.acos(clamp((l1*l1+reach*reach-l2*l2)/(2*l1*reach),-1,1));
  up.r=(shoulderAngle-Math.atan2(e[1]-upper.pivot[1],e[0]-upper.pivot[0]))*180/Math.PI;
  const elbow=[s[0]+l1*Math.cos(shoulderAngle),s[1]+l1*Math.sin(shoulderAngle)];
  lo.r=(Math.atan2(target[1]-elbow[1],target[0]-elbow[0])-Math.atan2(b[1]-e[1],b[0]-e[0]))*180/Math.PI-up.r;
  world=matrices(scene.nodes,poses);
 }
 for(const c of scene.constraints||[])if(c.type==='orientation'){
  const p=poses.get(c.node),current=world.get(c.node),target=world.get(c.target);
  p.r+=(Math.atan2(target[1],target[0])-Math.atan2(current[1],current[0]))*180/Math.PI+(c.offset||0);world=matrices(scene.nodes,poses);
 }
 for(const c of scene.constraints||[])if(c.type==='arrow'){
  const n=map.get(c.node),p=poses.get(c.node);if(!n||!p)continue;
  const anchor=point(world.get(c.nock.node),c.nock.point),aim=point(world.get(c.aim.node),c.aim.point),parent=n.parent?world.get(n.parent):unit(),localAnchor=point(inverse(parent),anchor);
  const restAngle=Math.atan2(c.restAim[1]-c.restNock[1],c.restAim[0]-c.restNock[0]);
  p.r=(Math.atan2(aim[1]-anchor[1],aim[0]-anchor[0])-Math.atan2(parent[1],parent[0])-restAngle)*180/Math.PI;
  const rad=p.r*Math.PI/180,dx=c.restNock[0]-n.pivot[0],dy=c.restNock[1]-n.pivot[1];
  p.x=localAnchor[0]-n.pivot[0]-(Math.cos(rad)*dx-Math.sin(rad)*dy);p.y=localAnchor[1]-n.pivot[1]-(Math.sin(rad)*dx+Math.cos(rad)*dy);
 }
 world=matrices(scene.nodes,poses);
 if(scene.cropPadding){
  const ownership=new Map(),limits=new Map();
  const rootOf=id=>{if(ownership.has(id))return ownership.get(id);let n=map.get(id);const root=n.parent?rootOf(n.parent):id;ownership.set(id,root);return root;};
  for(const n of scene.nodes)if(n.part&&Object.keys(n.sourceClipPoints||{}).length){const root=rootOf(n.id);if(!limits.has(root))limits.set(root,{xmin:-Infinity,xmax:Infinity,ymin:-Infinity,ymax:Infinity});const limit=limits.get(root);
   for(const [edge,points] of Object.entries(n.sourceClipPoints))for(const p of points){const q=point(world.get(n.id),p);if(edge==='left')limit.xmax=Math.min(limit.xmax,-q[0]);else if(edge==='right')limit.xmin=Math.max(limit.xmin,1023-q[0]);else if(edge==='top')limit.ymax=Math.min(limit.ymax,-q[1]);else limit.ymin=Math.max(limit.ymin,1535-q[1]);}
  }
  for(const [root,l] of limits){if(l.xmin>l.xmax+1e-7||l.ymin>l.ymax+1e-7)throw new Error('Opposing source crop constraints: '+scene.id+'/'+root);const p=poses.get(root);const x=clamp(0,l.xmin,l.xmax),y=clamp(0,l.ymin,l.ymax);if(Math.abs(x)>1e-8)p.x+=x;if(Math.abs(y)>1e-8)p.y+=y;}
  world=matrices(scene.nodes,poses);
 }
 const strings=[],wraps=[];
 for(const c of scene.constraints||[])if(c.type==='bowstring'){
  const m=inverse(world.get(c.node)),nock=point(world.get(c.nock.node),c.nock.point);
  const anchor=a=>{const reference=point(world.get(a.node),a.point);if(!a.groove)return reference;const center=point(world.get(a.node),map.get(a.node).pivot),dx=nock[0]-center[0],dy=nock[1]-center[1],distance=Math.hypot(dx,dy),r=a.groove.radius,theta=Math.atan2(dy,dx),offset=Math.acos(clamp(r/distance,-1,1));const points=[theta+offset,theta-offset].map(t=>[center[0]+r*Math.cos(t),center[1]+r*Math.sin(t)]);return points.sort((p,q)=>Math.hypot(p[0]-reference[0],p[1]-reference[1])-Math.hypot(q[0]-reference[0],q[1]-reference[1]))[0];};
  const worldAnchors=[anchor(c.top),nock,anchor(c.bottom)],pts=worldAnchors.map(p=>point(m,p));
  strings.push({id:c.node,d:pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(3)} ${p[1].toFixed(3)}`).join(' '),worldAnchors});
  for(const [i,a] of [[0,c.top],[2,c.bottom]])if(a.groove?.wrap){
   const w=a.groove.wrap,r=a.groove.radius,center=map.get(a.node).pivot,fx=w.fixed[0]-center[0],fy=w.fixed[1]-center[1],fr=Math.hypot(fx,fy),fixedLocal=[center[0]+r*fx/fr,center[1]+r*fy/fr],fixedWorld=point(world.get(a.node),fixedLocal),inv=inverse(world.get(w.node)),join=point(inv,worldAnchors[i]),fixed=point(inv,fixedWorld),localCenter=point(inv,point(world.get(a.node),center));
   const start=w.join==='start'?join:fixed,end=w.join==='start'?fixed:join,angle0=Math.atan2(start[1]-localCenter[1],start[0]-localCenter[0]),angle1=Math.atan2(end[1]-localCenter[1],end[0]-localCenter[0]),delta=Math.atan2(Math.sin(angle1-angle0),Math.cos(angle1-angle0));
   wraps.push({id:w.node,d:`M${start[0].toFixed(3)} ${start[1].toFixed(3)} A${r} ${r} 0 0 ${delta>=0?1:0} ${end[0].toFixed(3)} ${end[1].toFixed(3)}`,join:w.join,joinWorld:worldAnchors[i],fixedWorld});
  }
 }
 return {poses,world,strings,wraps};
}

function toLab(hex){const v=hex.match(/\w\w/g).map(h=>parseInt(h,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);const l=Math.cbrt(.4122214708*v[0]+.5363325363*v[1]+.0514459929*v[2]),m=Math.cbrt(.2119034982*v[0]+.6806995451*v[1]+.1073969566*v[2]),s=Math.cbrt(.0883024619*v[0]+.2817188376*v[1]+.6299787005*v[2]);return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];}
function fromLab([L,a,b]){const l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;return '#'+[4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s].map(c=>Math.round(clamp(c<=.0031308?12.92*c:1.055*Math.max(0,c)**(1/2.4)-.055)*255).toString(16).padStart(2,'0')).join('');}
export const mixColor=(a,b,t)=>t<=0?a:t>=1?b:fromLab(toLab(a).map((v,i)=>lerp(v,toLab(b)[i],t)));
export const mixTheme=(a,b,t)=>Object.fromEntries(Object.keys(b).map(k=>[k,mixColor(a[k]||b[k],b[k],t)]));

// Closest-to-identity affine mapping of the actual source paper, ink and
// cobalt anchors. The fourth gray anchor is deliberately not overfit: those
// nearly coplanar measurements otherwise amplify source grain by 10–200×.
// Only colour channels change; all source pixel coordinates remain intact.
export function sourceColourMatrix(source,colors){
 const keys=['paper','ink','accent'];
 const target=keys.map(k=>colors[k].match(/\w\w/g).map(v=>parseInt(v,16)/255));
 const a=Array.from({length:4},(_,r)=>Array.from({length:3},(_,c)=>(r===c?1:0)+source.projection[r].reduce((v,p,i)=>v+p*(target[i][c]-source.anchors[i][c]),0)));
 const out=[];for(let c=0;c<3;c++)out.push(a[0][c],a[1][c],a[2][c],0,a[3][c]);out.push(0,0,0,1,0);return out;
}

export const ACTS=[
  {
    "id": "bronya",
    "name": "理之律者",
    "title": "HERRSCHER\nOF REASON",
    "credit": "HONKAI IMPACT",
    "act": "PROJECT BUNNY / 重构",
    "signature": "FORM / JOIN / REST",
    "caption": "双轮归轴，骑手与车身一同收势。",
    "story": "机车与骑手从画幅下方驶入，双轮归轴，银发随后落定。道路、色块与文字逐层显现，合成原有的骑行海报。"
  },
  {
    "id": "kiana",
    "name": "琪亚娜",
    "title": "FLAME\nSCION",
    "credit": "HONKAI IMPACT",
    "act": "GUARD / 持剑",
    "signature": "ARRIVE / GUARD / HOLD",
    "caption": "双手贴合剑柄，剑锋引出整场入画。",
    "story": "大剑与肩臂先入画，双手始终守住原有握柄位置。披风和白发随后回摆，她稳住持剑的身形。"
  },
  {
    "id": "elysia",
    "name": "爱莉希雅",
    "title": "HUMAN\nEGO",
    "credit": "HONKAI IMPACT",
    "act": "CRYSTAL / 引弓",
    "signature": "TURN / RAISE / AIM",
    "caption": "晶弓转入瞄准方向，拉弦手随之归位。",
    "story": "肩臂带动完整晶弓抬起，弦与箭保持原稿形状。拉弦手随弓回到脸侧，花饰和长发缓缓收势。"
  },
  {
    "id": "aemeath",
    "name": "爱弥斯",
    "title": "RESONANCE",
    "credit": "WUTHERING WAVES",
    "act": "RESONANCE / 悬浮",
    "signature": "DEPLOY / FLOAT / REST",
    "caption": "少女与机兵一前一后抵达。",
    "story": "机兵的翼甲和手掌先后展开，少女轻轻浮入画心。衣摆与长发延迟跟随，各自回到定稿中的位置。"
  },
  {
    "id": "vyron",
    "name": "威龙 · 凌霄戍卫",
    "title": "ORBITAL\nGUARD",
    "credit": "DELTA FORCE",
    "act": "ORBIT / 漂移",
    "signature": "DRIFT / CORRECT / HOLD",
    "caption": "宇航服漂移到位，顶装光学盒随支架收势。",
    "story": "宇航员保持持枪姿态漂移而来，膝踝、手指与顶装夜视支架轻轻收势。轨道、空间站与背景色版随后显现。"
  },
  {
    "id": "luna",
    "name": "露娜 · 黑天际线",
    "title": "SCHWARZ\nSKYLINE",
    "credit": "DELTA FORCE",
    "act": "SKYLINE / 瞄准",
    "signature": "RISE / RAISE / SIGHT",
    "caption": "天际线展开，完整复合弓抬到瞄准方向。",
    "story": "她转肩举弓，拉弦手跟随箭尾归位，披襟和银发轻轻停住。城市轮廓与天际线随后逐层显现。"
  }
];
