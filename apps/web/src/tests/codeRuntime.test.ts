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
