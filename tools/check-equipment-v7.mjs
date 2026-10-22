import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {equipmentPose,cubicPrint,plateProgress,wavePolygon,PRINT_CURVES} from '../dist/print-motion.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=JSON.parse(await readFile(path.join(root,'dist/assets/source-equipment-v7.json'),'utf8'));
assert.equal(data.format,'independent-source-equipment-v7');assert.equal(data.scenes.length,6);
const objects=[];
for(const scene of data.scenes){
 assert.equal(scene.duration,1000);assert.equal(scene.nodes.length,4);assert(scene.equipment.length>0);
 for(const n of [...scene.nodes,...scene.equipment,...scene.equipment.flatMap(o=>o.underpaint?[o.underpaint]:[]),scene.foreground]){
  const png=n.sprite.uri.startsWith('data:')?Buffer.from(n.sprite.uri.split(',')[1],'base64'):await readFile(path.join(root,'dist',n.sprite.uri));assert.equal(createHash('sha256').update(png).digest('hex'),n.sprite.sha256);
  assert(n.spriteBounds[2]>0&&n.spriteBounds[3]>0);
 }
 for(const object of scene.equipment){
  assert(object.entry.start>=0&&object.entry.end<=1&&object.entry.start<object.entry.end);
  const first=equipmentPose(object,0),last=equipmentPose(object,1);assert.equal(first.a,0);assert.deepEqual(last,{x:0,y:0,r:0,a:1,progress:1});
  for(let k=0;k<=1000;k++){
   const p=equipmentPose(object,k/1000);assert(Object.values(p).every(Number.isFinite));assert(p.a>=0&&p.a<=1);
   const reduced=equipmentPose(object,k/1000,true);if(reduced.a>0){assert.equal(reduced.x,0);assert.equal(reduced.y,0);assert.equal(reduced.r,0);}
  }
  // Meaningful motion test: the midpoint differs from a linear interpolation,
  // and a bounded overshoot returns exactly to the source position before 1s.
  const e=object.entry,mid=equipmentPose(object,(e.start+e.end)/2),peak=equipmentPose(object,e.start+(e.end-e.start)*(1-e.settle));
  const key=Math.abs(e.from.x)>0?'x':'y';assert(Math.abs(mid[key]-e.from[key]*.5)>Math.abs(e.from[key])*.15);
  assert(Math.abs(peak[key])<=Math.abs(e.from[key])*.03+1e-6);assert(peak[key]*e.from[key]<0);
  objects.push({scene:scene.id,id:object.id,entry:object.entry,midpoint:mid,overshoot:peak,rest:last});
 }
 for(let i=0;i<4;i++){
  assert.equal(plateProgress(0,i),0);assert.equal(plateProgress(1,i),1);let before=0;
  for(let k=0;k<=100;k++){const q=plateProgress(k/100,i);assert(q>=before);before=q;const p=wavePolygon(scene.wave,q,i);assert(p.outer.flat().every(Number.isFinite));}
 }
}
for(const key of Object.keys(PRINT_CURVES)){assert.equal(cubicPrint(0,key),0);assert.equal(cubicPrint(1,key),1);assert(Math.abs(cubicPrint(.5,key)-.5)>.04);}
const report={result:'passed',signature:data.signature,scenes:6,equipment:objects.length,duration:1000,checks:['Original PNG checksums','Independent object schedules','Non-linear Bézier midpoint','Bounded rigid overshoot and exact source-aligned rest','Reduced motion has no displacement','Complete monotonic non-linear ink waves'],objects};
await writeFile(path.join(root,'qa/v7-motion-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,scenes:6,equipment:objects.length,duration:1000,signature:data.signature}));
