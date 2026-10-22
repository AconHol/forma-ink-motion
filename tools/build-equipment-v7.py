"""Build disjoint original ink plates + continuous independently moving equipment."""
from pathlib import Path
import io,json,base64,hashlib,copy
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
master=json.loads((ROOT/'source/print-master-v6.json').read_text(encoding='utf-8'))
masks=ROOT/'source/equipment-v7'
manifest=json.loads((masks/'manifest.json').read_text(encoding='utf-8'))
waves={'bronya':{'kind':'linear','angle':0},'kiana':{'kind':'linear','angle':52},'elysia':{'kind':'linear','angle':-34},'aemeath':{'kind':'radial','cx':.56,'cy':.52},'vyron':{'kind':'angular','cx':.51,'cy':.55,'start':-.3},'luna':{'kind':'linear','angle':90,'flip':True}}
packet={'version':3,'format':'independent-source-equipment-v7','width':1024,'height':1536,'themes':master['themes'],'scenes':[],'reference':{'repository':'https://github.com/AconHol/ink-plates','license':'MIT','adaptation':'Staggered whole-object entrances; glide/out/drift/calm cubic Bézier curves and controlled settling. Continuous original source pixels.'}}
def sprite(rgb,mask,crop=False):
 if crop:
  yy,xx=np.where(mask);x0,y0,x1,y1=int(xx.min()),int(yy.min()),int(xx.max())+1,int(yy.max())+1
 else:x0,y0,x1,y1=0,0,1024,1536
 local=mask[y0:y1,x0:x1];rgba=np.zeros((y1-y0,x1-x0,4),np.uint8);rgba[local,:3]=rgb[y0:y1,x0:x1][local];rgba[local,3]=255
 b=io.BytesIO();Image.fromarray(rgba).save(b,'PNG',optimize=True);raw=b.getvalue()
 return {'spriteBounds':[x0,y0,x1-x0,y1-y0],'sprite':{'uri':'data:image/png;base64,'+base64.b64encode(raw).decode('ascii'),'sha256':hashlib.sha256(raw).hexdigest()},'pixelCount':int(mask.sum())}
reports=[]
for source_scene in master['scenes']:
 pid=source_scene['id'];rgb=np.asarray(Image.open(ROOT/'source/approved'/f'{pid}.webp').convert('RGB'))
 config=next(s for s in manifest['scenes'] if s['id']==pid)
 colours=np.array([np.array(a)*255 for a in source_scene['source']['anchors']]+[source_scene['source']['gray']],dtype=np.float32)
 labels=np.argmin(((rgb.astype(np.float32)[:,:,None,:]-colours[None,None,:,:])**2).sum(3),axis=2)
 owned=np.zeros((1536,1024),np.uint8);equipment=[];combined=np.zeros_like(rgb);concealed=[]
 for spec in config['equipment']:
  mask=np.asarray(Image.open(masks/spec['mask']).convert('L'))>=128
  for exclusion in spec.get('exclusionMasks',[]):
   rider=np.asarray(Image.open(masks/exclusion).convert('L'))>=128
   mask&=~rider
   assert not np.any(mask&rider),'Rider must never belong to animated equipment'
  assert not np.any(owned[mask]);owned+=mask;combined[mask]=rgb[mask]
  object_data={**copy.deepcopy(spec),**sprite(rgb,mask,True)}
  if spec.get('reconstruction'):
   repair=np.asarray(Image.open(masks/spec['reconstruction']['file']).convert('RGBA'))
   repair_mask=repair[:,:,3]>=128
   foreground_mask=np.asarray(Image.open(masks/config['foregroundMask']).convert('L'))>=128
   assert not np.any(repair_mask&~foreground_mask),'Concealed repair must be covered by stationary foreground at rest'
   concealed.append((repair[:,:,:3],repair_mask))
   object_data['underpaint']={'id':spec['id']+'-underpaint','role':'concealed-vehicle-surface',**sprite(repair[:,:,:3],repair_mask,True)}
  equipment.append(object_data)
 nodes=[]
 for i,material in enumerate(['paper','ink','accent','silver']):
  mask=(labels==i)&(owned==0);owned+=mask;combined[mask]=rgb[mask]
  nodes.append({'id':f'ink-{i}','parent':None,'renderParent':'','role':'paper' if i==0 else 'background','part':False,'pivot':[512,768],'semantic':f'Continuous original {material} plate with equipment removed','material':material,'motion':[{'t':0,'x':0,'y':0,'r':0,'a':1},{'t':1,'x':0,'y':0,'r':0,'a':1}],**sprite(rgb,mask)})
 foreground_mask=np.asarray(Image.open(masks/config['foregroundMask']).convert('L'))>=128
 foreground={'id':'equipment-foreground',**sprite(rgb,foreground_mask,True)}
 assert np.all(owned==1) and np.array_equal(combined,rgb)
 # Simulate the added underpainting and the actual front-to-back source
 # occlusion at rest; the final image must retain every original pixel.
 restored=combined.copy()
 for repair_rgb,repair_mask in concealed:restored[repair_mask]=repair_rgb[repair_mask]
 restored[foreground_mask]=rgb[foreground_mask]
 assert np.array_equal(restored,rgb),'Concealed vehicle repair leaked through rider at rest'
 digest=hashlib.sha256(combined.tobytes()).hexdigest();assert digest==source_scene['source']['decodedRGBSHA256']
 packet['scenes'].append({'id':pid,'duration':1000,'source':copy.deepcopy(source_scene['source']),'nodes':nodes,'equipment':equipment,'foreground':foreground,'foregroundFollows':config.get('foregroundFollows'),'layerGroups':config.get('layerGroups',[]),'constraints':[],'printPlates':True,'wave':waves[pid]})
 reports.append({'id':pid,'equipment':[e['id'] for e in equipment],'unownedPixels':int((owned==0).sum()),'multiplyOwnedPixels':int((owned>1).sum()),'sourceRGBSHA256':digest,'concealedRepairPixels':sum(int(m.sum()) for _,m in concealed),'restWithRepairRGBSHA256':hashlib.sha256(restored.tobytes()).hexdigest(),'meanRGBError':0,'duration':1000})
 print(json.dumps(reports[-1]),flush=True)
packet['signature']=hashlib.sha256(json.dumps(packet,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
target=ROOT/'dist/assets/source-equipment-v7.json';target.write_text(json.dumps(packet,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
(ROOT/'qa/v7-source-ownership.json').write_text(json.dumps({'signature':packet['signature'],'reports':reports,'checks':['Every original pixel assigned exactly once to ink or equipment','Source colours and final native pixel positions unchanged','Continuous equipment masks, no body-part animation']},indent=2),encoding='utf-8')
print(json.dumps({'bytes':target.stat().st_size,'signature':packet['signature']}),flush=True)
