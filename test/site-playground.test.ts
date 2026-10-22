import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { playground, playgroundScript } from '../src/site-playground';
import { mapRequest, scrapeRequest } from '../src/schema';

function setup() {
  const fields = new Map<string, any>();
  for(const tool of ['scrape','map'])for (const name of ['form','run','status','url','format','wait','limit','search','page','subdomains','cost','request','result','output']) {
    fields.set(`try-${tool}-${name}`, {value:'',checked:false,disabled:false,hidden:false,textContent:'',listeners:{} as Record<string, Function>,addEventListener(event:string, fn:Function){this.listeners[event]=fn;},classList:{add:vi.fn(),remove:vi.fn()},setAttribute:vi.fn(),removeAttribute:vi.fn(),reportValidity:()=>true});
  }
  const get=(tool:string,name:string)=>fields.get(`try-${tool}-${name}`);
  for(const tool of ['scrape','map']){get(tool,'url').value='https://oassis.dev';get(tool,'format').value='markdown';get(tool,'limit').value='20';}
  const fetch=vi.fn().mockResolvedValue({ok:true,status:200,text:async()=>JSON.stringify({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify({urls:['https://oassis.dev']})}]}})});
  runInNewContext(playgroundScript(),{document:{getElementById:(id:string)=>fields.get(id)},fetch,URL});
  const submit=(tool:string)=>get(tool,'form').listeners.submit({preventDefault(){}});
  return {get,fetch,submit};
}
describe('homepage playground',()=>{
  it('shows two stacked forms with Oassis URLs and no key input',()=>{const html=playground();expect(html.indexOf('id="try-map-form"')).toBeGreaterThan(html.indexOf('id="try-scrape-form"'));expect(html.match(/value="https:\/\/oassis.dev"/g)).toHaveLength(2);expect(html).not.toContain('type="password"');expect(html).not.toContain('try-key');});
  it('sends valid scrape parameters through the existing keyless MCP trial',async()=>{
    const {get,fetch,submit}=setup();get('scrape','wait').value='h1';await submit('scrape');
    const [path,request]=fetch.mock.calls[0]!;expect(path).toBe('/mcp');const rpc=JSON.parse(request.body);
    expect(rpc).toMatchObject({method:'tools/call',params:{name:'web_scrape'}});
    expect(scrapeRequest.parse(rpc.params.arguments)).toMatchObject({url:'https://oassis.dev',formats:['markdown'],wait:{selector:'h1'}});
    expect(request.headers).not.toHaveProperty('Authorization');expect(request.credentials).toBe('omit');expect(get('scrape','result').hidden).toBe(false);expect(get('scrape','run').disabled).toBe(false);
  });
  it('sends valid map parameters independently and displays tool output',async()=>{
    const {get,fetch,submit}=setup();get('map','search').value='/docs';get('map','page').checked=true;get('map','form').listeners.change();await submit('map');
    const rpc=JSON.parse(fetch.mock.calls[0]![1].body);expect(rpc.params.name).toBe('web_map');expect(mapRequest.parse(rpc.params.arguments)).toEqual({url:'https://oassis.dev',limit:20,includePage:true,includeSubdomains:false,search:'/docs'});
    expect(get('map','cost').textContent).toContain('1.5');expect(JSON.parse(get('map','output').textContent)).toEqual({urls:['https://oassis.dev']});expect(get('scrape','status').textContent).toBe('');
  });
  it('blocks non-HTTP URLs before making a request',async()=>{const {get,fetch,submit}=setup();get('scrape','url').value='file:///etc/hosts';await submit('scrape');expect(fetch).not.toHaveBeenCalled();expect(get('scrape','status').textContent).toContain('https://');});
  it('explains trial exhaustion even when MCP returns HTTP 200',async()=>{const {get,fetch,submit}=setup();fetch.mockResolvedValueOnce({ok:true,status:200,text:async()=>JSON.stringify({result:{isError:true,content:[{type:'text',text:'mcp_trial_exhausted'}]}})});await submit('map');expect(get('map','status').textContent).toContain('free trial credits');expect(get('map','run').disabled).toBe(false);});
  it('handles connection failures and blocks duplicate submissions',async()=>{const {get,fetch,submit}=setup();get('scrape','run').disabled=true;await submit('scrape');expect(fetch).not.toHaveBeenCalled();get('scrape','run').disabled=false;fetch.mockRejectedValueOnce(new Error('offline'));await submit('scrape');expect(get('scrape','status').textContent).toContain('connection');expect(get('scrape','run').disabled).toBe(false);});
});
