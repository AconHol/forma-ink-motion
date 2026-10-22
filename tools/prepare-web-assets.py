"""Convert rebuilt source sprites to exact external WebP assets."""
from pathlib import Path
import json,base64,hashlib,io
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];dist=ROOT/'dist';file=dist/'assets/source-equipment-v7.json'
data=json.loads(file.read_text(encoding='utf-8'));source_signature=data['signature'];count=0
folder=dist/'assets/sprites';folder.mkdir(parents=True,exist_ok=True)
for scene in data['scenes']:
 for node in [*scene['nodes'],*scene['equipment'],*(o['underpaint'] for o in scene['equipment'] if o.get('underpaint')),scene['foreground']]:
  uri=node['sprite']['uri']
  if uri.startswith('data:'):
   source=Image.open(io.BytesIO(base64.b64decode(uri.split(',',1)[1]))).convert('RGBA');stream=io.BytesIO();source.save(stream,'WEBP',lossless=True,method=4,exact=True);raw=stream.getvalue()
   assert np.array_equal(np.asarray(source),np.asarray(Image.open(io.BytesIO(raw)).convert('RGBA'))),'Lossless RGBA roundtrip failed'
   digest=hashlib.sha256(raw).hexdigest();name=scene['id']+'-'+node['id']+'-'+digest[:10]+'.webp';(folder/name).write_bytes(raw)
   node['sprite']={'uri':'assets/sprites/'+name,'sha256':digest}
  else:
   assert hashlib.sha256((dist/uri).read_bytes()).hexdigest()==node['sprite']['sha256']
  count+=1
data['sourceSignature']=source_signature;data['encoding']='external-lossless-webp-identical-rgba';data.pop('signature',None)
data['signature']=hashlib.sha256(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
file.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8');print(json.dumps({'sprites':count,'bytes':file.stat().st_size,'rgbaRoundtrip':'exact','signature':data['signature']}))
