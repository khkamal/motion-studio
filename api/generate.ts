type VercelRequest = { method?: string; body?: unknown };
type VercelResponse = { status(code:number):VercelResponse; json(value:unknown):void };

const SYSTEM = `You are a motion-graphics creative coder. Return executable JavaScript only, no markdown. Contract v1: export default function createAnimation(api) { ... return {duration: seconds, render(time){ return SVG string; }, destroy(){}} }. API: api.svg(width,height,{background,transparent}) returns a root; api.rect(root,x,y,w,h,{rx,fill,opacity}) and api.text(root,value,x,y,{fill,size,anchor}) create SVG nodes; api.animate(node,property,from,to,start,duration,easing) supports opacity, rotation, x, y, scale; easing is linear or easeOut. root.render(time) evaluates deterministic time. Use only supplied API; no network, DOM globals, imports, timers, or external resources. Build an original multi-element SVG animation from the user's prompt/reference. Duration <=120 seconds, viewport <=1920. The code executes in a restricted iframe.`;
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'Code generation is not configured. Set GEMINI_API_KEY on the server.' });
  let prompt: string; let image: { mimeType: string; data: string } | undefined;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body.prompt !== 'string' || body.prompt.trim().length > 4000) return res.status(400).json({ error: 'Prompt must be text of at most 4000 characters.' });
    prompt = body.prompt.trim() || 'Create an elegant, original animated graphic based on the reference image.';
    if (body.image !== undefined) {
      const i=body.image;
      if (!i || !['image/png','image/jpeg','image/webp'].includes(i.mimeType) || typeof i.data !== 'string' || i.data.length > 5_000_000) return res.status(400).json({error:'Reference must be PNG, JPEG, or WebP and at most 3.5 MB.'});
      image=i;
    }
  } catch { return res.status(400).json({error:'Invalid JSON request.'}); }
  const controller = new AbortController(); const timer=setTimeout(()=>controller.abort(),60_000);
  try {
    const model=(process.env.GEMINI_MODEL||'gemini-2.5-flash').replace(/^models\//,'');
    if (!/^[A-Za-z0-9._-]+$/.test(model)) return res.status(500).json({error:'Configured model name is invalid.'});
    const parts: unknown[]=[{text:`${SYSTEM}\n\nUser request:\n${prompt}`}];
    if(image) parts.push({inline_data:{mime_type:image.mimeType,data:image.data}});
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{temperature:0.7,maxOutputTokens:8192}}),signal:controller.signal});
    const data=await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>};
    if(!response.ok) return res.status(response.status===429?503:502).json({error:`AI provider request failed (HTTP ${response.status}).`,retryable:response.status===429||response.status>=500});
    const code=data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim().replace(/^```(?:javascript|js)?\s*/i,'').replace(/\s*```$/,'');
    if(!code) return res.status(502).json({error:'AI provider returned no animation code.',retryable:true});
    if(code.length>80_000) return res.status(502).json({error:'Generated code exceeded the 80 KB limit.'});
    return res.status(200).json({code,model,runtimeVersion:1});
  } catch(e) { const timeout=controller.signal.aborted; return res.status(timeout?504:502).json({error:timeout?'AI generation timed out.':'AI provider is unavailable.',retryable:true}); }
  finally { clearTimeout(timer); }
}
