import { describe, expect, it } from 'vitest';
import { CODE_RUNTIME_VERSION, STARTER_ANIMATION, createRuntimeDocument, validateAnimationCode } from '../services/codeRuntime';

describe('generated animation contract v1', () => {
  it('identifies its runtime version and accepts the complete starter factory', () => {
    expect(CODE_RUNTIME_VERSION).toBe(1);
    expect(validateAnimationCode(STARTER_ANIMATION)).toBeNull();
  });
  it('rejects empty/oversized source and incomplete factories before execution, while accepting Canvas renderFrame', () => {
    expect(validateAnimationCode('')).toMatch(/empty/);
    expect(validateAnimationCode('export default function createAnimation(api) { return {}; }')).toMatch(/contract v1/);
    expect(validateAnimationCode('function renderFrame(time, frame, fps, ctx, width, height) { ctx.fillRect(0, 0, width, height); }')).toBeNull();
    expect(validateAnimationCode('x'.repeat(80_001))).toMatch(/80 KB/);
  });
  it('runs render-time zero-duration setters and matches sampled loop endpoints', () => {
    const sandbox=runSandbox(`export default function createAnimation(api) { const duration=8,root=api.svg(1920,1080,{background:'#000'}),node=api.rect(root,0,0,50,50,{}); return {duration,render(time){const p=Math.max(0,Math.min(1,time/(duration-1/30))),phase=2*Math.PI*p,x=700+100*Math.cos(phase),y=500+100*Math.sin(phase),scale=1+0.2*Math.sin(phase);api.animate(node,'x',x,x,0,0,'linear');api.animate(node,'y',y,y,0,0,'linear');api.animate(node,'scale',scale,scale,0,0,'linear');return root.render(time)},destroy(){}};}`);
    expect(sandbox.messages[0]).toMatchObject({type:'ready',duration:8});
    const first=sandbox.messages[0].svg as string;
    sandbox.messages.length=0;
    sandbox.send({data:{channel:'motion-code-v1',type:'frame',time:239/30}});
    expect(sandbox.messages[0].type).toBe('frame');
    const final=sandbox.messages[0].svg as string;
    const get=(html:string,key:string)=>Number(html.match(new RegExp('<rect[^>]*\\b'+key+'="([^"]+)"'))?.[1]);
    expect(Math.abs(get(first,'x')-get(final,'x'))).toBeLessThan(1e-9);
    expect(Math.abs(get(first,'y')-get(final,'y'))).toBeLessThan(1e-9);
  });
  it('accepts the submitted infinity drawing pattern with zero-duration x/y/scale setters', () => {
    const sandbox=runSandbox(`export default function createAnimation(api) { const duration=8,width=1920,height=1080,root=api.svg(width,height,{background:'#0a0a0a'}),centerX=width/2,centerY=height/2,segments=40,nodes=[];for(let i=0;i<segments;i++)nodes.push(api.rect(root,centerX-25,centerY-25,50,50,{fill:'hsl('+(i/segments*360)+',70%,60%)',rx:10}));return {duration,render(time){const progress=(time%duration)/duration,angle=progress*Math.PI*2;nodes.forEach((node,i)=>{const t=angle+(i/segments)*Math.PI*2,scale=1/(1+Math.sin(t)*Math.sin(t)),x=centerX+(150*Math.cos(t)*scale)*2,y=centerY+(150*Math.sin(t)*Math.cos(t)*scale)*2;api.animate(node,'x',x-25,x-25,0,0,'linear');api.animate(node,'y',y-25,y-25,0,0,'linear');api.animate(node,'scale',scale*1.5,scale*1.5,0,0,'linear')});return root.render(time)},destroy(){}}}`);
    expect(sandbox.messages[0]).toMatchObject({type:'ready',duration:8});
    sandbox.messages.length=0;sandbox.send({data:{channel:'motion-code-v1',type:'pause'}});expect(sandbox.messages[sandbox.messages.length-1]).toMatchObject({type:'tick',playing:false});
    sandbox.send({data:{channel:'motion-code-v1',type:'seek',frameIndex:120}});expect(sandbox.messages[sandbox.messages.length-1]).toMatchObject({type:'tick',frameIndex:120,timeSeconds:4});
    sandbox.send({data:{channel:'motion-code-v1',type:'play'}});expect(sandbox.messages[sandbox.messages.length-1]).toMatchObject({type:'tick',playing:true});
  });
  it('accepts an SVG root wrapper returned directly instead of serialized markup', () => {
    const sandbox=runSandbox(`export default function createAnimation(api){const root=api.svg(800,450,{});return {duration:8,render(){return root},destroy(){}}}`);
    expect(sandbox.messages[0]).toMatchObject({type:'ready',duration:8});
    expect(sandbox.messages[0].svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(sandbox.messages[0].svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
  it('reframes off-center artwork inside the composition without changing the SVG output dimensions', () => {
    const sandbox=runSandbox(`export default function createAnimation(api){const root=api.svg(800,450,{}),line=api.path(root,'M 700 380 L 790 440',{stroke:'#00d4ff',strokeWidth:12});return {duration:8,render(){return root.render(0)},destroy(){}}}`);
    expect(sandbox.messages[0]).toMatchObject({type:'ready',duration:8});
    expect(sandbox.messages[0].svg).toContain('viewBox="0 0 800 450"');
    expect(sandbox.messages[0].svg).toContain('transform="translate(');
    sandbox.messages.length=0;
    sandbox.send({data:{channel:'motion-code-v1',type:'frame',time:1,width:1280,height:720}});
    expect(sandbox.messages[0]).toMatchObject({type:'frame',time:1});
    expect(sandbox.messages[0].svg).toContain('width="1280" height="720"');
    expect(sandbox.messages[0].svg).toContain('viewBox="0 0 800 450"');
  });
  it('falls back to the active SVG root when render mutates it but returns nothing', () => {
    const sandbox=runSandbox(`export default function createAnimation(api){const root=api.svg(800,450,{});return {duration:8,render(){api.rect(root,10,10,20,20,{})},destroy(){}}}`);
    expect(sandbox.messages[0]).toMatchObject({type:'ready',duration:8});
  });
  it('re-renders the current code-animation frame after an iframe viewport resize', () => {
    const sandbox=runSandbox(`export default function createAnimation(api){const root=api.svg(800,450,{}),orb=api.circle(root,400,225,20,{});return {duration:8,render(){return root.render(0)},destroy(){}}}`);
    expect(sandbox.messages[0]).toMatchObject({type:'ready'});
    sandbox.messages.length=0;
    sandbox.resize();
    expect(sandbox.messages[0]).toMatchObject({type:'tick',frameIndex:0});
  });
  it('keeps a circle radius visible when its initial position is the origin before animation moves it', () => {
    const sandbox=runSandbox(`export default function createAnimation(api){const width=1920,height=1080,duration=8,root=api.svg(width,height,{background:'#0f172a',transparent:false}),track=api.path(root,'M 500,540 L 1420,540 Z',{fill:'none',stroke:'#38bdf8',strokeWidth:15}),ball=api.circle(root,0,0,25,{fill:'#f8fafc',stroke:'#ffffff',strokeWidth:5}),glow=api.circle(root,0,0,40,{fill:'#38bdf8',opacity:.3}),centerX=width/2,centerY=height/2,scale=324;return {duration,render(time){const t=time/duration*Math.PI*2,denominator=1+Math.sin(t)**2,x=centerX+scale*Math.cos(t)/denominator,y=centerY+scale*Math.sin(t)*Math.cos(t)/denominator;api.animate(ball,'cx',x,x,0,0);api.animate(ball,'cy',y,y,0,0);api.animate(glow,'cx',x,x,0,0);api.animate(glow,'cy',y,y,0,0);return root},destroy(){}}}`);
    expect(sandbox.messages[0]).toMatchObject({type:'ready'});
    const svg=sandbox.messages[0].svg as string;
    expect(svg).toContain('<path');
    expect(svg).toContain('r="25"');
    expect(svg).toContain('r="40"');
    expect(svg).toContain('cx="1284"');
  });
  it('clips the SVG root and clamps rectangle and circle geometry to its viewport', () => {
    const sandbox=runSandbox(`export default function createAnimation(api){const root=api.svg(800,450,{}),rect=api.rect(root,780,440,100,60,{fill:'#fff'}),circle=api.circle(root,790,440,50,{fill:'#00d4ff'});return {duration:8,render(t){api.animate(rect,'x',5000,5000,0,0);api.animate(rect,'y',5000,5000,0,0);return root.render(t)},destroy(){}}}`);
    expect(sandbox.messages[0]).toMatchObject({type:'ready'});
    const svg=sandbox.messages[0].svg as string;
    expect(svg).toContain('overflow="hidden"');
    expect(svg).toContain('<rect x="780" y="440" width="20" height="10"');
    expect(svg).toContain('<circle cx="750" cy="400" r="50"');
  });
  it('recycles primitives created during render so they do not pile up across sampled frames', () => {
    const sandbox=runSandbox(`export default function createAnimation(api){const root=api.svg(800,450,{});return {duration:8,render(t){api.circle(root,400+t,225,12,{fill:'#00d4ff'});return root.render(t)},destroy(){}}}`);
    expect(sandbox.messages[0]).toMatchObject({type:'ready',duration:8});
    expect((sandbox.messages[0].svg as string).match(/<circle/g)).toHaveLength(1);
  });
  it('supports a real SVG path and circle primitive in the generated scene', () => {
    const sandbox=runSandbox(`export default function createAnimation(api){const root=api.svg(800,450,{}),curve=api.path(root,'M 0 0 L 10 10 Z',{fill:'none',stroke:'#00d4ff',strokeWidth:3}),orb=api.circle(root,20,20,8,{fill:'#fff'});return {duration:8,render(t){const d='M 0 0 L '+t+' 10 Z';api.animate(curve,'d',d,d,0,0);api.animate(orb,'cx',20+t,20+t,0,0);return root.render(t)},destroy(){}}}`);
    expect(sandbox.messages[0]).toMatchObject({type:'ready',duration:8});
    expect(sandbox.messages[0].svg).toContain('<path');
    expect(sandbox.messages[0].svg).toContain('<circle');
  });
  it('explains when render returns a value that cannot be converted to SVG', () => {
    const sandbox=runSandbox(`export default function createAnimation(api){api.svg(800,450,{});return {duration:8,render(){return 7},destroy(){}}}`);
    expect(sandbox.messages[0]).toMatchObject({type:'error',message:expect.stringContaining('Got number')});
  });
  it('returns a runtime error for invalid negative timing rather than crashing silently', () => {
    const sandbox=runSandbox(`export default function createAnimation(api){const root=api.svg(800,450,{}),node=api.rect(root,0,0,10,10,{});return {duration:8,render(t){api.animate(node,'x',0,1,0,-1,'linear');return root.render(t)}}}`);
    expect(sandbox.messages[0]).toMatchObject({type:'error'});
  });
  it('runs the Canvas renderFrame contract with composition timing, helpers, and export dimensions', () => {
    const sandbox=runSandbox(`function renderFrame(time,frame,fps,ctx,width,height){const value=fbm(.1,.2,4);if(Math.abs(motion.loopProgress-time/(8-1/30))>1e-9||!Number.isFinite(value)||TAU<6||smoothstep(0,1,.5)!==.5)throw Error('Canvas helpers are unavailable');ctx.fillRect(0,0,width,height);}`);
    expect(sandbox.messages[0]).toMatchObject({type:'ready',duration:8});
    expect(sandbox.messages[0].svg).toBeUndefined();
    sandbox.messages.length=0;
    sandbox.send({data:{channel:'motion-code-v1',type:'frame',time:2,width:640,height:360}});
    expect(sandbox.messages[0]).toMatchObject({type:'frame',time:2});
    expect(sandbox.messages[0].svg).toContain('width="640" height="360"');
    expect(sandbox.messages[0].svg).toContain('viewBox="0 0 640 360"');
    expect(sandbox.messages[0].svg).toContain('data:image/png;base64,ZmFrZQ==');
    expect(sandbox.canvases[0]).toMatchObject({width:1066,height:598});
  });
  it('keeps preview zoom centered, clips oversized compositions, and never lets export resize preview pixels', () => {
    const sandbox=runSandbox(`function renderFrame(time,frame,fps,ctx,width,height){ctx.fillRect(0,0,width,height);}`);
    sandbox.send({data:{channel:'motion-code-v1',type:'zoom',factor:2}});
    expect(Number.parseFloat(sandbox.compositionStage.style.width)).toBeGreaterThan(sandbox.previewViewport.clientWidth);
    expect(sandbox.previewViewport.scrollLeft).toBeGreaterThan(0);
    sandbox.send({data:{channel:'motion-code-v1',type:'frame',time:1,width:3840,height:2160}});
    expect(sandbox.messages[sandbox.messages.length-1].svg).toContain('width="3840" height="2160"');
    expect(sandbox.canvases[0]).toMatchObject({width:1066,height:598});
  });
});

interface MessageLike { data: Record<string, unknown> }
interface FakeElement { tag:string; attrs:Map<string,string>; children:FakeElement[]; parent?:FakeElement; style:Record<string,string>; classList:{add(...tokens:string[]):void}; setAttribute(key:string,value:string):void; getAttribute(key:string):string|null; append(child:FakeElement):void; remove():void; getBBox():{x:number;y:number;width:number;height:number}; readonly outerHTML:string }
function makeElement(tag:string):FakeElement {const attrs=new Map<string,string>();const children:FakeElement[]=[];return {tag,attrs,children,style:{},classList:{add(){}},setAttribute(key,value){attrs.set(key,String(value))},getAttribute(key){return attrs.get(key)||null},append(child){children.push(child);child.parent=this},remove(){if(this.parent){const index=this.parent.children.indexOf(this as unknown as FakeElement);if(index>=0)this.parent.children.splice(index,1)}},getBBox(){if(tag==='rect'){const x=Number(attrs.get('x')||0),y=Number(attrs.get('y')||0);return {x,y,width:Number(attrs.get('width')||0),height:Number(attrs.get('height')||0)}}if(tag==='circle'){const cx=Number(attrs.get('cx')||0),cy=Number(attrs.get('cy')||0),r=Number(attrs.get('r')||0);return {x:cx-r,y:cy-r,width:2*r,height:2*r}}if(tag==='path'){const pairs=[...String(attrs.get('d')||'').matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/gi)].map(match=>[Number(match[1]),Number(match[2])]);if(!pairs.length)return {x:0,y:0,width:0,height:0};const xs=pairs.map(pair=>pair[0]),ys=pairs.map(pair=>pair[1]),left=Math.min(...xs),top=Math.min(...ys);return {x:left,y:top,width:Math.max(...xs)-left,height:Math.max(...ys)-top}}if(tag==='g'||tag==='svg'){const boxes=children.map(child=>child.getBBox()).filter(box=>box.width>0&&box.height>0);if(!boxes.length)return {x:0,y:0,width:0,height:0};const left=Math.min(...boxes.map(box=>box.x)),top=Math.min(...boxes.map(box=>box.y)),right=Math.max(...boxes.map(box=>box.x+box.width)),bottom=Math.max(...boxes.map(box=>box.y+box.height));return {x:left,y:top,width:right-left,height:bottom-top}}return {x:0,y:0,width:0,height:0}},get outerHTML(){const a=[...attrs].map(([k,v])=>`${k}="${v}"`).join(' ');return `<${tag} ${a}>${children.map(child=>child.outerHTML).join('')}</${tag}>`}};}
function runSandbox(code:string){
 const messages:Array<Record<string,unknown>>=[];let handler:((event:MessageLike)=>void)|undefined;const resizeObservers:Array<()=>void>=[];const windowHandlers=new Map<string,Array<(event:MessageLike)=>void>>();
 const fakeWindow={devicePixelRatio:2,addEventListener(type:string,fn:(event:MessageLike)=>void){const handlers=windowHandlers.get(type)||[];handlers.push(fn);windowHandlers.set(type,handlers);if(type==='message')handler=fn}};
 const canvases:Array<{width:number;height:number;style:Record<string,string>}>=[];const fakeCanvas=()=>{const context={fillStyle:'',setTransform(){},clearRect(){},save(){},restore(){},fillRect(){}};const canvas={width:300,height:150,style:{},getContext(){return context},toDataURL(){return 'data:image/png;base64,ZmFrZQ=='},remove(){}};canvases.push(canvas);return canvas};
 const previewViewport={clientWidth:800,clientHeight:450,scrollLeft:0,scrollTop:0};const compositionStage=makeElement('div') as FakeElement & {replaceChildren:(...elements:FakeElement[])=>void;clientWidth:number;clientHeight:number};compositionStage.replaceChildren=(...elements)=>{compositionStage.children.splice(0,compositionStage.children.length);for(const element of elements)compositionStage.append(element)};Object.defineProperties(compositionStage,{clientWidth:{get:()=>Number.parseFloat(compositionStage.style.width)||800},clientHeight:{get:()=>Number.parseFloat(compositionStage.style.height)||450}});const fakeDocument={getElementById(id:string){return id==='preview-viewport'?previewViewport:id==='composition-stage'?compositionStage:null},createElementNS(_ns:string,tag:string){return makeElement(tag)},createElement(tag:string){if(tag==='canvas')return fakeCanvas();return makeElement(tag)},body:{replaceChildren(..._elements:FakeElement[]){}}};
 class FakeResizeObserver {constructor(private callback:()=>void){}observe(){resizeObservers.push(()=>this.callback())}}
 const html=createRuntimeDocument();const script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));expect(script.length).toBeGreaterThan(0);
 new Function('window','parent','document','performance','setInterval','clearInterval','ResizeObserver',script)(fakeWindow,{postMessage(message:Record<string,unknown>){messages.push(message)}},fakeDocument,{now:()=>0},()=>1,()=>{},FakeResizeObserver);
 if(!handler)throw new Error('Sandbox did not register its message handler.');
 handler({data:{channel:'motion-code-v1',type:'run',code,duration:8,fps:30,looping:true}});
 return {messages,canvases,compositionStage,previewViewport,send:handler,resize(){previewViewport.clientWidth=640;previewViewport.clientHeight=360;for(const listener of windowHandlers.get('resize')||[])listener({data:{}});for(const observer of resizeObservers)observer()}};
}
