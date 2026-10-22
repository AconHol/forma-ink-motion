// Native-resolution GPU implementation of the small Canvas2D subset used by
// print-motion.js. The source sprites, wave polygons, timing and draw order are
// shared with the reference renderer. No frame skipping or reduced artwork.
const W=1024,H=1536;
const identity=()=>[1,0,0,1,0,0];
const transform=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
const colour=value=>{
 if(typeof value!=='string')return [0,0,0,1];
 if(value[0]==='#'){const h=value.slice(1),s=h.length===3?[...h].map(c=>c+c).join(''):h;return [0,2,4].map(i=>parseInt(s.slice(i,i+2),16)/255).concat(s.length===8?parseInt(s.slice(6),16)/255:1);}
 const a=value.match(/[\d.]+/g)?.map(Number)||[0,0,0,1];return [a[0]/255,a[1]/255,a[2]/255,a[3]??1];
};
const VERT=`#version 300 es
in vec2 position;in vec2 uv;out vec2 tex;uniform vec2 size;
void main(){tex=uv;gl_Position=vec4(position.x/size.x*2.-1.,1.-position.y/size.y*2.,0.,1.);}`;
const INK=`#version 300 es
precision highp float;in vec2 tex;out vec4 pixel;uniform sampler2D image;uniform vec4 solid;uniform float alpha;uniform int textured;uniform int exact;
void main(){vec4 c=textured==1?(exact==1?texelFetch(image,ivec2(floor(tex*vec2(textureSize(image,0)))),0):texture(image,tex)):vec4(solid.rgb*solid.a,solid.a);pixel=c*alpha;}`;
const PRESENT=`#version 300 es
precision highp float;in vec2 tex;out vec4 pixel;uniform sampler2D image;uniform vec4 red;uniform vec4 green;uniform vec4 blue;uniform vec3 offset;
void main(){vec4 c=texture(image,tex);pixel=vec4(clamp(vec3(dot(c,red),dot(c,green),dot(c,blue))+offset,0.,1.),1.);}`;
function program(gl,fragment){
 const build=(kind,source)=>{const shader=gl.createShader(kind);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;};
 const p=gl.createProgram(),v=build(gl.VERTEX_SHADER,VERT),f=build(gl.FRAGMENT_SHADER,fragment);gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
 const uniforms={};for(let i=0;i<gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);i++){const u=gl.getActiveUniform(p,i);uniforms[u.name]=gl.getUniformLocation(p,u.name);}
 return {p,uniforms,position:gl.getAttribLocation(p,'position'),uv:gl.getAttribLocation(p,'uv')};
}
export function createInkRenderer(canvas){
 const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true,premultipliedAlpha:true,powerPreference:'high-performance'});
 if(!gl)return null;
 return new InkGPU(canvas,gl);
}
class InkGPU{
 constructor(canvas,gl){
  this.canvas=canvas;this.gl=gl;this.kind='webgl2';this.ink=program(gl,INK);this.present=program(gl,PRESENT);this.buffer=gl.createBuffer();this.textures=new WeakMap();this.vertices=new Float32Array(8192);this.currentProgram=null;this.stack=[];this.paths=[];this.path=null;
  this.state={matrix:identity(),alpha:1,fill:'#000',stroke:'#000',lineWidth:1,lineCap:'butt',clip:false};
  this.samples=Math.min(4,gl.getParameter(gl.MAX_SAMPLES));this.frames=0;
  canvas.classList.add('is-gpu');canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this.lost=true;canvas.dispatchEvent(new CustomEvent('forma-renderer-lost'));});
 }
 get globalAlpha(){return this.state.alpha;}set globalAlpha(v){this.state.alpha=v;}
 get fillStyle(){return this.state.fill;}set fillStyle(v){this.state.fill=v;}
 get strokeStyle(){return this.state.stroke;}set strokeStyle(v){this.state.stroke=v;}
 get lineWidth(){return this.state.lineWidth;}set lineWidth(v){this.state.lineWidth=v;}
 get lineCap(){return this.state.lineCap;}set lineCap(v){this.state.lineCap=v;}
 save(){this.stack.push({...this.state,matrix:this.state.matrix.slice()});}
 restore(){if(this.stack.length){this.state=this.stack.pop();this.clipMode(this.state.clip);}}
 setTransform(a,b,c,d,e,f){this.state.matrix=[a,b,c,d,e,f];}
 translate(x,y){const m=this.state.matrix;m[4]+=m[0]*x+m[2]*y;m[5]+=m[1]*x+m[3]*y;}
 rotate(a){const m=this.state.matrix,c=Math.cos(a),s=Math.sin(a),[a0,b0,c0,d0]=m;m[0]=a0*c+c0*s;m[1]=b0*c+d0*s;m[2]=-a0*s+c0*c;m[3]=-b0*s+d0*c;}
 scale(x,y){const m=this.state.matrix;m[0]*=x;m[1]*=x;m[2]*=y;m[3]*=y;}
 createPattern(image){return {pattern:image};}
 upload(image,repeat=false){
  let item=this.textures.get(image);if(item)return item;
  const gl=this.gl,texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
  item={texture,width:image.width||image.naturalWidth,height:image.height||image.naturalHeight};this.textures.set(image,item);return item;
 }
 warm(cache){for(const sprite of cache.values())this.upload(sprite.image);if(cache.paperImage)this.upload(cache.paperImage,true);}
 ready(){
  // Allocate the native targets and execute both shader programs behind the
  // loader. The first entrance must not pay allocation or first-draw costs.
  this.beginFrame(true);this.save();this.setTransform(1,0,0,1,0,0);this.globalAlpha=1;this.fillStyle='#000';this.fillRect(0,0,W,H);this.restore();this.endFrame();this.gl.finish();
 }
 targets(){
  if(this.targetReady)return;const gl=this.gl;
  this.rawTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.rawTexture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,W,H);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  this.resolve=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,this.resolve);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.rawTexture,0);
  this.raw=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,this.raw);
  const attach=(format,attachment)=>{const buffer=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,buffer);gl.renderbufferStorageMultisample(gl.RENDERBUFFER,this.samples,format,W,H);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,attachment,gl.RENDERBUFFER,buffer);};
  attach(gl.RGBA8,gl.COLOR_ATTACHMENT0);attach(gl.DEPTH24_STENCIL8,gl.DEPTH_STENCIL_ATTACHMENT);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Native ink framebuffer unavailable');this.targetReady=true;
 }
 use(p){
  const gl=this.gl;gl.useProgram(p.p);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.enableVertexAttribArray(p.position);gl.vertexAttribPointer(p.position,2,gl.FLOAT,false,16,0);if(p.uv>=0){gl.enableVertexAttribArray(p.uv);gl.vertexAttribPointer(p.uv,2,gl.FLOAT,false,16,8);}gl.uniform2f(p.uniforms.size,W,H);if(p.uniforms.image)gl.uniform1i(p.uniforms.image,0);this.currentProgram=p;
 }
 beginFrame(rest=false){
  if(this.lost)return;const gl=this.gl;this.targets();this.rest=rest;gl.bindFramebuffer(gl.FRAMEBUFFER,rest?this.resolve:this.raw);gl.viewport(0,0,W,H);gl.colorMask(true,true,true,true);gl.disable(gl.STENCIL_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);this.state.clip=false;this.use(this.ink);
 }
 send(points,mode){
  const gl=this.gl,n=points.length;if(n>this.vertices.length)this.vertices=new Float32Array(n*2);this.vertices.set(points);gl.bufferData(gl.ARRAY_BUFFER,this.vertices.subarray(0,n),gl.STREAM_DRAW);gl.drawArrays(mode,0,n/4);
 }
 inkUniforms(texture,fill,exact=false){
  const gl=this.gl,p=this.ink;if(this.currentProgram!==p)this.use(p);gl.uniform1f(p.uniforms.alpha,this.state.alpha);gl.uniform1i(p.uniforms.exact,exact?1:0);
  if(texture){gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(p.uniforms.textured,1);}
  else{gl.uniform1i(p.uniforms.textured,0);gl.uniform4fv(p.uniforms.solid,colour(fill));}
 }
 quad(x,y,w,h,u=1,v=1){
  const m=this.state.matrix,a=transform(m,x,y),b=transform(m,x+w,y),c=transform(m,x+w,y+h),d=transform(m,x,y+h);
  this.send([...a,0,0,...b,u,0,...d,0,v,...c,u,v],this.gl.TRIANGLE_STRIP);
 }
 fillRect(x,y,w,h){const fill=this.state.fill;if(fill?.pattern){const item=this.upload(fill.pattern,true);this.inkUniforms(item.texture);this.quad(x,y,w,h,w/item.width,h/item.height);}else{this.inkUniforms(null,fill);this.quad(x,y,w,h);}}
 drawImage(image,x,y){const item=this.upload(image),m=this.state.matrix,exact=m[0]===1&&m[1]===0&&m[2]===0&&m[3]===1&&Number.isInteger(x+m[4])&&Number.isInteger(y+m[5]);this.inkUniforms(item.texture,null,exact);this.quad(x,y,item.width,item.height);}
 beginPath(){this.paths=[];this.path=null;}
 moveTo(x,y){this.path=[transform(this.state.matrix,x,y)];this.paths.push(this.path);}
 lineTo(x,y){if(!this.path)this.moveTo(x,y);else this.path.push(transform(this.state.matrix,x,y));}
 closePath(){if(this.path?.length)this.path.closed=true;}
 ellipse(cx,cy,rx,ry,rotation,a0,a1){const c=Math.cos(rotation),s=Math.sin(rotation),count=Math.max(8,Math.ceil(Math.abs(a1-a0)*14));for(let i=0;i<=count;i++){const a=a0+(a1-a0)*i/count,x=Math.cos(a)*rx,y=Math.sin(a)*ry;if(i===0)this.moveTo(cx+x*c-y*s,cy+x*s+y*c);else this.lineTo(cx+x*c-y*s,cy+x*s+y*c);}}
 clipMode(active){const gl=this.gl;if(active){gl.enable(gl.STENCIL_TEST);gl.stencilMask(0);gl.stencilFunc(gl.NOTEQUAL,0,0xff);gl.stencilOp(gl.KEEP,gl.KEEP,gl.KEEP);}else gl.disable(gl.STENCIL_TEST);}
 clip(){
  const gl=this.gl;gl.enable(gl.STENCIL_TEST);gl.stencilMask(0xff);gl.clearStencil(0);gl.clear(gl.STENCIL_BUFFER_BIT);gl.colorMask(false,false,false,false);gl.stencilFunc(gl.ALWAYS,0,0xff);gl.stencilOp(gl.KEEP,gl.KEEP,gl.INVERT);this.inkUniforms(null,'#fff');
  for(const poly of this.paths)if(poly.length>=3){const points=[];for(const [x,y] of poly)points.push(x,y,0,0);this.send(points,gl.TRIANGLE_FAN);}
  gl.colorMask(true,true,true,true);this.state.clip=true;this.clipMode(true);
 }
 stroke(){
  this.inkUniforms(null,this.state.stroke);const points=[],half=this.state.lineWidth/2;
  for(const poly of this.paths){const n=poly.length+(poly.closed?1:0);for(let i=1;i<n;i++){const a=poly[i-1],b=poly[i%poly.length],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1,nx=-dy/len*half,ny=dx/len*half;points.push(a[0]+nx,a[1]+ny,0,0,b[0]+nx,b[1]+ny,0,0,a[0]-nx,a[1]-ny,0,0,a[0]-nx,a[1]-ny,0,0,b[0]+nx,b[1]+ny,0,0,b[0]-nx,b[1]-ny,0,0);}}
  if(this.state.lineCap==='round')for(const poly of this.paths)for(const [x,y] of [poly[0],poly[poly.length-1]])for(let i=0;i<12;i++){const a=i*Math.PI/6,b=(i+1)*Math.PI/6;points.push(x,y,0,0,x+Math.cos(a)*half,y+Math.sin(a)*half,0,0,x+Math.cos(b)*half,y+Math.sin(b)*half,0,0);}
  if(points.length)this.send(points,this.gl.TRIANGLES);
 }
 endFrame(matrix){
  if(this.lost)return;const gl=this.gl;
  gl.disable(gl.STENCIL_TEST);gl.disable(gl.BLEND);if(!this.rest){gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.raw);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this.resolve);gl.blitFramebuffer(0,0,W,H,0,0,W,H,gl.COLOR_BUFFER_BIT,gl.NEAREST);}
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);this.use(this.present);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.rawTexture);
  const m=matrix||[1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0],u=this.present.uniforms;
  gl.uniform4fv(u.red,m.slice(0,4));gl.uniform4fv(u.green,m.slice(5,9));gl.uniform4fv(u.blue,m.slice(10,14));gl.uniform3f(u.offset,m[4],m[9],m[14]);
  this.send([0,0,0,1,W,0,1,1,0,H,0,0,W,H,1,0],gl.TRIANGLE_STRIP);this.frames++;
 }
 readRawRGB(){
  const gl=this.gl,rgba=new Uint8Array(W*H*4),rgb=new Uint8Array(W*H*3);gl.bindFramebuffer(gl.FRAMEBUFFER,this.resolve);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,rgba);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const from=((H-1-y)*W+x)*4,to=(y*W+x)*3;rgb[to]=rgba[from];rgb[to+1]=rgba[from+1];rgb[to+2]=rgba[from+2];}return rgb;
 }
}
