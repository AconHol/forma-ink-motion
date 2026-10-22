import {spawnSync} from 'node:child_process';
import {existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const candidates=process.env.PYTHON?[process.env.PYTHON]:['python3','python','py'];
if(process.platform==='win32'&&process.env.LOCALAPPDATA&&!process.env.PYTHON){
 const folder=path.join(process.env.LOCALAPPDATA,'Programs','Python');
 if(existsSync(folder))for(const name of readdirSync(folder).sort().reverse()){const file=path.join(folder,name,'python.exe');if(existsSync(file))candidates.push(file);}
}
const python=candidates.find(file=>spawnSync(file,['--version'],{encoding:'utf8',windowsHide:true}).status===0);
if(!python){console.error('Python 3 is required. Install Python or set the PYTHON environment variable to its executable.');process.exit(1);}
for(const script of ['build-equipment-v7.py','prepare-web-assets.py']){
 const result=spawnSync(python,[path.join(root,'tools',script)],{cwd:root,stdio:'inherit',windowsHide:true});
 if(result.status!==0)process.exit(result.status||1);
}
