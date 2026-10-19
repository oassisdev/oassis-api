import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {Hono} from 'hono';
import {WEB_CATALOG,WEB_FAMILIES} from '../src/product-catalog';
import {openapi,llmsTxt} from '../src/openapi';
import {landing} from '../src/landing';
import {mcp} from '../src/mcp';
import {mountSitePages} from '../src/site-pages';
const context={req:{url:'https://api.oassis.dev/openapi.json',path:'/openapi.json'},env:{BASE_URL:'https://api.oassis.dev'}} as any;
it('publishes exactly the same product operations and MCP mapping in OpenAPI, MCP and README',async()=>{
 const spec=openapi(context) as any;
 const meta=await (await mcp.request('https://api.oassis.dev/mcp',{},context.env)).json() as any;
 expect(meta.productCatalog).toEqual(WEB_CATALOG);expect(spec['x-product-catalog']).toEqual(WEB_CATALOG);
 expect(WEB_CATALOG.filter(op=>op.family==='web')).toHaveLength(7);expect(WEB_CATALOG.filter(op=>op.family==='tasks')).toHaveLength(9);
 for(const family of WEB_FAMILIES)expect(meta.families.find((f:any)=>f.name===family.name).operations).toEqual(WEB_CATALOG.filter(op=>op.family===family.id));
 const readme=readFileSync('README.md','utf8');
 for(const op of WEB_CATALOG){const entry=spec.paths[op.path][op.method.toLowerCase()];expect(entry.tags).toEqual([WEB_FAMILIES.find(f=>f.id===op.family)!.name]);expect(entry['x-mcp-tool']).toBe(op.mcp);if(op.mcpArguments)expect(entry['x-mcp-arguments']).toEqual(op.mcpArguments);expect(readme).toContain('`'+op.method+' '+op.path+'`');}
 expect(llmsTxt(context)).toContain('## Web Tasks');expect(llmsTxt(context)).not.toContain('## Extraction Tasks');
});
it('shows the same seven tools and nine task endpoints in the landing and both guides, with account separate',async()=>{
 const html=landing(context);const a=new Hono();mountSitePages(a as any);
 const docs=await (await a.request('https://oassis.dev/docs')).text();const tasks=await (await a.request('https://oassis.dev/task-api')).text();
 for(const family of WEB_FAMILIES){const id=family.id==='web'?'web-tools':'web-tasks';const start=html.indexOf('id="'+id+'"');const section=html.slice(start,html.indexOf('</section>',start));const ops=WEB_CATALOG.filter(op=>op.family===family.id);expect(section.match(/<tr>/g)).toHaveLength(ops.length+1);expect(section).not.toContain('/web/v1/account');for(const op of ops){const text=op.method+' '+op.path;expect(section).toContain(text);expect(docs).toContain(text);if(family.id==='tasks')expect(tasks).toContain(text);}}
 expect(docs).toContain('GET /web/v1/account');expect(tasks).toContain('Batch extraction and crawling');expect(tasks).toContain('Research tasks');
});
