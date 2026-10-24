const GREEN_SCREEN_MARKER = '/*__MOTION_STUDIO_GREEN_SCREEN__*/';
const NO_OPTIONS_MARKER = '/*__MOTION_STUDIO_GREEN_SCREEN_NO_OPTIONS__*/';

interface ParsedCall {
  args: string[];
  closeIndex: number;
}

function parseCallArguments(source: string, openIndex: number): ParsedCall | null {
  const args: string[] = [];
  const stack: string[] = [];
  let start = openIndex + 1;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if ((char === '/' && next === '/') || (char === '/' && next === '*')) {
      if (next === '/') { lineComment = true; index += 1; }
      else { blockComment = true; index += 1; }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '(' || char === '{' || char === '[') {
      stack.push(char === '(' ? ')' : char === '{' ? '}' : ']');
      continue;
    }
    if (char === ')' && stack.length === 0) {
      args.push(source.slice(start, index).trim());
      return { args: args.length === 1 && args[0] === '' ? [] : args, closeIndex: index };
    }
    if (char === ')' || char === '}' || char === ']') {
      if (stack.pop() !== char) return null;
      continue;
    }
    if (char === ',' && stack.length === 0) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  return null;
}

function unwrapOverride(options: string): { options: string; omit: boolean } {
  const markerIndex = options.indexOf(GREEN_SCREEN_MARKER);
  const noOptions = options.includes(NO_OPTIONS_MARKER);
  if (markerIndex < 0 && !noOptions) return { options, omit: false };
  const spreadStart = options.indexOf('...(');
  if (spreadStart < 0) return { options, omit: false };
  const openIndex = spreadStart + 3;
  const parsed = parseCallArguments(options, openIndex);
  if (!parsed || parsed.closeIndex > (markerIndex < 0 ? options.indexOf(NO_OPTIONS_MARKER) : markerIndex)) return { options, omit: false };
  return { options: parsed.args[0] ?? '{}', omit: noOptions };
}

function rewriteSvgCalls(source: string, enabled: boolean): string {
  const token = 'api.svg';
  let cursor = 0;
  let output = '';
  while (cursor < source.length) {
    const callStart = source.indexOf(token, cursor);
    if (callStart < 0) break;
    const openIndex = callStart + token.length;
    if (source[openIndex] !== '(') { cursor = openIndex; continue; }
    const parsed = parseCallArguments(source, openIndex);
    if (!parsed || parsed.args.length < 2) { cursor = openIndex + 1; continue; }
    output += source.slice(cursor, callStart);
    const args = [...parsed.args];
    const original = unwrapOverride(args[2] ?? '{}');
    const omitOptions = args.length < 3 || original.omit;
    const options = args[2] === undefined ? '{}' : original.options;
    const marker = omitOptions ? NO_OPTIONS_MARKER : GREEN_SCREEN_MARKER;
    const rewrittenOptions = enabled
      ? `{ ...(${options}), ${marker} background: "#00ff00", transparent: false }`
      : options;
    const outputArgs = enabled || !omitOptions ? [args[0], args[1], rewrittenOptions] : [args[0], args[1]];
    output += `api.svg(${outputArgs.join(', ')})`;
    cursor = parsed.closeIndex + 1;
  }
  return output + source.slice(cursor);
}

function rewriteCanvasBackground(code: string, enabled: boolean): string {
  const marker = '/*__MOTION_STUDIO_CANVAS_BG_INSERT__*/';
  const injectedBackground = `${marker}ctx.save();ctx.fillStyle="#00ff00";ctx.fillRect(0,0,width,height);ctx.restore();`;
  let restored = code.replace(/(ctx\.fillStyle\s*=\s*)\/\*__MOTION_STUDIO_CANVAS_BG:([^*]*)__\*\/\s*"#00ff00"/g, (_match, prefix: string, encoded: string) => `${prefix}${decodeURIComponent(encoded)}`);
  restored = restored.replace(injectedBackground, '');
  if (!enabled || !/function\s+renderFrame\s*\(/.test(restored)) return restored;
  if (restored.includes('__MOTION_STUDIO_CANVAS_BG:') || restored.includes(marker)) return restored;
  const backgroundFill = /(ctx\.fillStyle\s*=\s*)([^;\n]+)(\s*;\s*ctx\.fillRect\(\s*0\s*,\s*0\s*,\s*width\s*,\s*height\s*\)\s*;?)/m;
  if (backgroundFill.test(restored)) return restored.replace(backgroundFill, (_match, prefix: string, original: string, fill: string) => `${prefix}/*__MOTION_STUDIO_CANVAS_BG:${encodeURIComponent(original.trim()).replace(/\*/g, '%2A')}__*/"#00ff00"${fill}`);
  return restored.replace(/(function\s+renderFrame\s*\([^)]*\)\s*\{)/, `$1${injectedBackground}`);
}

/** Add or remove the preview/export green-screen override on SVG API or Canvas code. */
export function applyGreenScreenBackground(code: string, enabled: boolean): string {
  return rewriteCanvasBackground(rewriteSvgCalls(code, enabled), enabled);
}
