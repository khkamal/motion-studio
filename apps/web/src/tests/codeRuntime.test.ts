import { describe, expect, it } from 'vitest';
import { CODE_RUNTIME_VERSION, STARTER_ANIMATION, createRuntimeDocument, validateAnimationCode } from '../services/codeRuntime';

describe('generated animation contract v1', () => {
  it('identifies its runtime version and accepts the complete starter factory', () => {
    expect(CODE_RUNTIME_VERSION).toBe(1);
    expect(validateAnimationCode(STARTER_ANIMATION)).toBeNull();
  });
  it('rejects empty/oversized source and incomplete factories before execution', () => {
    expect(validateAnimationCode('')).toMatch(/empty/);
    expect(validateAnimationCode('export default function createAnimation(api) { return {}; }')).toMatch(/render/);
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
  });
  it('falls back to the active SVG root when render mutates it but returns nothing', () => {
    const sandbox=runSandbox(`export default function createAnimation(api){const root=api.svg(800,450,{});return {duration:8,render(){api.rect(root,10,10,20,20,{})},destroy(){}}}`);
    expect(sandbox.messages[0]).toMatchObject({type:'ready',duration:8});
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
});

interface MessageLike { data: Record<string, unknown> }
interface FakeElement { tag:string; attrs:Map<string,string>; children:FakeElement[]; style:Record<string,string>; setAttribute(key:string,value:string):void; getAttribute(key:string):string|null; append(child:FakeElement):void; remove():void; readonly outerHTML:string }
function makeElement(tag:string):FakeElement {const attrs=new Map<string,string>();const children:FakeElement[]=[];return {tag,attrs,children,style:{},setAttribute(key,value){attrs.set(key,String(value))},getAttribute(key){return attrs.get(key)||null},append(child){children.push(child)},remove(){},get outerHTML(){const a=[...attrs].map(([k,v])=>`${k}="${v}"`).join(' ');return `<${tag} ${a}>${children.map(child=>child.outerHTML).join('')}</${tag}>`}};}
function runSandbox(code:string){
 const messages:Array<Record<string,unknown>>=[];let handler:((event:MessageLike)=>void)|undefined;
 const fakeWindow={addEventListener(_type:string,fn:(event:MessageLike)=>void){handler=fn}};
 const fakeDocument={createElementNS(_ns:string,tag:string){return makeElement(tag)},body:{replaceChildren(..._elements:FakeElement[]){}}};
 const html=createRuntimeDocument();const script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));expect(script.length).toBeGreaterThan(0);
 new Function('window','parent','document','performance','setInterval','clearInterval',script)(fakeWindow,{postMessage(message:Record<string,unknown>){messages.push(message)}},fakeDocument,{now:()=>0},()=>1,()=>{});
 if(!handler)throw new Error('Sandbox did not register its message handler.');
 handler({data:{channel:'motion-code-v1',type:'run',code,duration:8,fps:30,looping:true}});
 return {messages,send:handler};
}
