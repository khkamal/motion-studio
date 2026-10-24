type VercelRequest = { method?: string; body?: unknown };
type VercelResponse = { status(code:number):VercelResponse; json(value:unknown):void };

const SYSTEM = `You are a motion-graphics creative coder. Return executable JavaScript only, no markdown. Contract v1: export default function createAnimation(api) { ... return {duration: seconds, render(timeSeconds){ return SVG string; }, destroy(){}} }. The supplied composition duration and frame rate are authoritative: return duration exactly equal to durationSeconds. render(timeSeconds) is deterministic and receives seconds, not frame numbers. Frame indices are zero-based 0..totalFrames-1; timeSeconds=frameIndex/fps; the final exported sample is at (totalFrames-1)/fps. Use the supplied API only: api.svg(width,height,{background,transparent}), api.rect(root,x,y,w,h,{rx,fill,opacity}), api.text(root,value,x,y,{fill,size,anchor}), api.animate(node,property,from,to,start,duration,easing). Supported properties are opacity, rotation, x, y, scale, plus translateX, translateY, rotate, cx, cy, r, rx, ry, strokeWidth, strokeDashoffset, fontSize, strokeDasharray; easing is linear or easeOut. Declare nonzero-duration api.animate calls once during factory creation, not inside render(). Inside render(), use duration=0 to set an instantaneous value; this is safe and does not allocate a new animation. Duration-zero calls may set safe fill/stroke color strings. Do not pass negative durations. For seamless loops, calculate normalized progress as clamp(timeSeconds/(durationSeconds-1/fps),0,1), then drive cyclic properties with periodic functions such as sin/cos of 2π*progress so frame 0 and frame totalFrames-1 land at the same state. Never use modulo duration in a way that makes the last exported frame jump. Respect composition.looping; do not loop when false. Use only the supplied API; no network, DOM globals, imports, timers, or external resources. Build a polished multi-element, genuinely animated SVG from the request/reference. Viewport dimensions must match composition width/height. The code executes in a restricted iframe.`;
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let requestKeys:string[]=[]; let requestedModel:string|undefined;
  let prompt: string; let image: { mimeType: string; data: string } | undefined; let composition: { durationSeconds:number; fps:number; width:number; height:number; totalFrames:number; aspectRatio:string; frameConvention:string; looping:boolean; startEndStates:string } | undefined;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body.prompt !== 'string' || body.prompt.trim().length > 4000) return res.status(400).json({ error: 'Prompt must be text of at most 4000 characters.' });
    prompt = body.prompt.trim() || 'Create an elegant, original animated graphic based on the reference image.';
    if(body.providerKeys!==undefined){if(!Array.isArray(body.providerKeys)||body.providerKeys.length>10||body.providerKeys.some((key:unknown)=>typeof key!=='string'||key.length<8||key.length>256))return res.status(400).json({error:'Selected Gemini key list is invalid.'});requestKeys=body.providerKeys.map((key:string)=>key.trim()).filter(Boolean);}
    if(body.model!==undefined){if(typeof body.model!=='string'||body.model.length>100)return res.status(400).json({error:'Selected Gemini model is invalid.'});const normalizedModel=body.model.replace(/^models\//,'');if(!/^[A-Za-z0-9._-]+$/.test(normalizedModel))return res.status(400).json({error:'Selected Gemini model is invalid.'});requestedModel=normalizedModel;}
    if(body.composition){const c=body.composition;if(!Number.isFinite(c.durationSeconds)||c.durationSeconds<1||c.durationSeconds>120||![24,25,30,50,60].includes(c.fps)||!Number.isInteger(c.width)||!Number.isInteger(c.height)||c.width<16||c.height<16||c.width>7680||c.height>7680)return res.status(400).json({error:'Invalid composition settings.'});composition=c;}
    if (body.image !== undefined) {
      const i=body.image;
      if (!i || !['image/png','image/jpeg','image/webp'].includes(i.mimeType) || typeof i.data !== 'string' || i.data.length > 5_000_000) return res.status(400).json({error:'Reference must be PNG, JPEG, or WebP and at most 3.5 MB.'});
      image=i;
    }
  } catch { return res.status(400).json({error:'Invalid JSON request.'}); }
  const configuredKeys=(()=>{const many=process.env.GEMINI_API_KEYS?.trim();if(many){try{const parsed=JSON.parse(many);if(Array.isArray(parsed))return parsed.filter((x):x is string=>typeof x==='string'&&Boolean(x.trim())).map(x=>x.trim());}catch{/* support comma/newline-separated secret values too */}return many.split(/[\n,]/).map(x=>x.trim()).filter(Boolean);}return process.env.GEMINI_API_KEY?[process.env.GEMINI_API_KEY]:[]})();
  const eligibleKeys=[...new Set([...requestKeys,...configuredKeys])].slice(0,10);
  if(!eligibleKeys.length)return res.status(503).json({error:'No Gemini API key is available. Add or select a key in Gemini API settings, or configure a server-side key.'});
  const controller = new AbortController(); const timer=setTimeout(()=>controller.abort(),60_000);
  try {
    const model=(requestedModel||process.env.GEMINI_MODEL||'gemini-2.5-flash').replace(/^models\//,'');
    if (!/^[A-Za-z0-9._-]+$/.test(model)) return res.status(500).json({error:'Configured model name is invalid.'});
    const context=composition?`\n\nComposition context (authoritative): ${JSON.stringify(composition)}. Treat render(time) input as seconds from zero. Generate an animation whose duration exactly matches durationSeconds and whose frame-sampled output is deterministic for the same time. Respect totalFrames and zero-based frame convention. If looping is true, first and last sampled frames should match; otherwise use purposeful non-looping start/end states. Use time-based easing, not accumulated frame increments.`:'\nComposition settings were not supplied; use a reasonable duration.';
    const parts: unknown[]=[{text:`${SYSTEM}${context}\n\nUser request:\n${prompt}`}];
    if(image) parts.push({inline_data:{mime_type:image.mimeType,data:image.data}});
    let data:{candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>}; let response:Response|undefined; let quotaKeysTried=0;
    for(const key of eligibleKeys){
      response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{temperature:0.7,maxOutputTokens:8192}}),signal:controller.signal});
      data=await response.json() as typeof data;
      if(response.ok)break;
      const detail=JSON.stringify(data).toLowerCase();const quota=response.status===429||((response.status===403||response.status===400)&&/quota|rate.?limit|resource_exhausted/.test(detail));
      if(!quota){const message=response.status===401?'Gemini rejected the selected API key. Re-test it in Gemini API settings.':response.status===403?`This key has no permission to use ${model}. Check its Gemini project/model access.`:response.status===404?`The model ${model} is not available to this API key.`:response.status===413?'The reference image/request is too large. Use a smaller image.':response.status===400?`Gemini rejected the request for ${model} (HTTP 400). Check model access and try a shorter prompt or smaller reference.`:`Gemini provider request failed (HTTP ${response.status}) for ${model}.`;return res.status(response.status===429?503:502).json({error:message,retryable:response.status>=500});}
      quotaKeysTried++;
      const retryAfter=Number(response.headers.get('retry-after'));if(Number.isFinite(retryAfter)&&retryAfter>0&&retryAfter<=10)await new Promise(resolve=>setTimeout(resolve,retryAfter*1000));
    }
    if(!response?.ok)return res.status(503).json({error:quotaKeysTried?'All configured Gemini keys are currently rate-limited or quota-exhausted. Try again later.':'No eligible Gemini API key is available.',retryable:true});
    const code=data!.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim().replace(/^```(?:javascript|js)?\s*/i,'').replace(/\s*```$/,'');
    if(!code) return res.status(502).json({error:'AI provider returned no animation code.',retryable:true});
    if(code.length>80_000) return res.status(502).json({error:'Generated code exceeded the 80 KB limit.'});
    return res.status(200).json({code,model,runtimeVersion:1});
  } catch(e) { const timeout=controller.signal.aborted; return res.status(timeout?504:502).json({error:timeout?'AI generation timed out.':'AI provider is unavailable.',retryable:true}); }
  finally { clearTimeout(timer); }
}
