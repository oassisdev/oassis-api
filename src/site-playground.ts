/** Two independent, keyless demos backed by the existing MCP trial. */
export function playground(): string {
  return `<section class="content-section playground" id="try-tools" aria-labelledby="try-title">
<h2 id="try-title">Try Scrape &amp; Map</h2>
<p class="section-lead">Try a URL. No API key or account needed. Includes 100 trial credits shared between Scrape and Map.</p>
<style>
.playground [hidden]{display:none!important}.playground form{margin-bottom:24px;border:1px solid var(--line);border-radius:8px;padding:24px;background:var(--hero)}.playground label{display:grid;gap:6px;font-weight:600}.playground input,.playground select,.playground button{font:inherit}.playground input:not([type=checkbox]),.playground select{width:100%;min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}.playground .try-grid{display:grid;grid-template-columns:1fr 2fr;gap:16px;margin-bottom:18px}.playground .try-options{display:grid;gap:16px;margin:18px 0}.playground .try-check{display:flex;align-items:center;gap:10px;font-weight:400}.playground .try-note{font-size:14px;color:var(--muted);margin:8px 0 16px}.playground .try-actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:20px}.playground button{cursor:pointer}.oassis-home .playground .button{background:#102d42;color:#fff;border-color:#102d42}.oassis-home .playground .button:hover:not(:disabled){background:#1c4865;border-color:#1c4865}.oassis-home .playground .button:active:not(:disabled){background:#0b2233;border-color:#0b2233}.playground button:disabled{opacity:.6;cursor:wait}.playground :focus-visible{outline:3px solid var(--link);outline-offset:3px}.playground pre{max-height:420px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.playground summary{cursor:pointer}.playground [role=status]{overflow-wrap:anywhere}.playground .try-error{color:var(--fg);border-left:3px solid #cf222e;padding-left:12px}@media(max-width:600px){.playground .try-grid{grid-template-columns:1fr}.playground form{margin-bottom:24px;padding:16px}}
</style>
${demoBox('scrape')}
${demoBox('map')}
<noscript><p>Enable JavaScript to try these tools here.</p></noscript>
<script>${playgroundScript()}</script>
</section>`;
}

function demoBox(tool: 'scrape' | 'map'): string {
  const title = tool === 'scrape' ? 'Web Scrape' : 'Web Map';
  return `<form id="try-${tool}-form" aria-labelledby="try-${tool}-title">
<h3 id="try-${tool}-title">${title}</h3>
<p>${tool === 'scrape' ? 'Read a page in the format you need.' : "Discover a site's URLs from its sitemap and page links."}</p>
<label for="try-${tool}-url">URL<input id="try-${tool}-url" type="url" value="https://oassis.dev" placeholder="https://oassis.dev" required></label>
<div class="try-options">${tool === 'scrape' ? `
<label for="try-scrape-format">Output format<select id="try-scrape-format"><option value="markdown">Markdown</option><option value="html">HTML</option><option value="links">Links</option><option value="accessibility">Accessibility tree</option><option value="controls">Page controls</option></select></label>
<label for="try-scrape-wait">Wait for a CSS selector (optional)<input id="try-scrape-wait" placeholder="e.g. h1" maxlength="300"></label>` : `
<div class="try-grid"><label for="try-map-limit">Maximum URLs<input id="try-map-limit" type="number" value="20" min="1" max="5000" step="1"></label><label for="try-map-search">URL contains (optional)<input id="try-map-search" placeholder="e.g. /docs" maxlength="200"></label></div>
<label class="try-check"><input id="try-map-page" type="checkbox"> Also look for links on the page</label>
<label class="try-check"><input id="try-map-subdomains" type="checkbox"> Include subdomains</label>`}</div>
<details><summary>Request preview</summary><pre id="try-${tool}-request"></pre></details>
<div class="try-actions"><button class="button" type="submit" id="try-${tool}-run">Run ${title}</button><span class="try-note" id="try-${tool}-cost"></span></div>
<p id="try-${tool}-status" role="status" aria-live="polite">Enter a URL and run a test.</p>
<details id="try-${tool}-result" hidden open><summary>Response</summary><pre id="try-${tool}-output" tabindex="0"></pre></details>
</form>`;
}

export function playgroundScript(): string {
  return String.raw`(()=>{
for(const tool of ['scrape','map']){
const el=name=>document.getElementById('try-'+tool+'-'+name);
const form=el('form'),run=el('run'),status=el('status');
function body(){const data={url:el('url').value.trim()};if(tool==='scrape'){data.formats=[el('format').value];const selector=el('wait').value.trim();if(selector)data.wait={selector};}else{data.limit=Number(el('limit').value);data.includePage=el('page').checked;data.includeSubdomains=el('subdomains').checked;const search=el('search').value.trim();if(search)data.search=search;}return data;}
function request(){return {jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'web_'+tool,arguments:body()}};}
function update(){el('request').textContent=JSON.stringify(request(),null,2);el('cost').textContent=(tool==='map'&&el('page').checked?'1.5 credits':'1 credit')+' from your free trial';}
form.addEventListener('input',update);form.addEventListener('change',update);update();
form.addEventListener('submit',async event=>{
event.preventDefault();if(run.disabled||!form.reportValidity())return;
let url;try{url=new URL(el('url').value.trim());}catch{status.textContent='Enter a valid URL, such as https://oassis.dev.';return;}
if(!['https:','http:'].includes(url.protocol)){status.textContent='Use an http:// or https:// URL.';return;}
run.disabled=true;form.setAttribute('aria-busy','true');status.classList.remove('try-error');status.textContent='Running Web '+(tool==='map'?'Map':'Scrape')+'… This can take up to a minute.';el('result').hidden=true;el('output').textContent='';
try{
const response=await fetch('/mcp',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(request())});
const text=await response.text();let rpc;try{rpc=JSON.parse(text);}catch{rpc=null;}
const content=rpc?.result?.content?.filter(item=>item.type==='text').map(item=>item.text).join(String.fromCharCode(10));
let output=content??text;try{output=JSON.stringify(JSON.parse(output),null,2);}catch{}
el('output').textContent=output;el('result').hidden=false;
if(!response.ok||rpc?.error||rpc?.result?.isError){status.classList.add('try-error');status.textContent=content?.includes('mcp_trial_exhausted')?'Your free trial credits have been used. Sign up to continue with an API key.':response.status===429?'Too many requests. Wait a moment and try again.':'The test could not be completed. See the response for details.';}
else{status.textContent='Done. Your '+(tool==='map'?'site URLs':'page output')+' are shown below.';}
}catch{status.classList.add('try-error');status.textContent='Unable to reach Oassis. Check your connection before trying again.';}
finally{run.disabled=false;form.removeAttribute('aria-busy');}
});
}
})();`;
}
