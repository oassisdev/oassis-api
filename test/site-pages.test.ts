import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mountSitePages } from "../src/site-pages";
import { agentRoutes } from "../src/agent/routes";
import { scrapeRequest, crawlRequest, mapRequest, sessionRequest, actRequest } from "../src/schema";
import type { Env } from "../src/types";
const paths=["/docs","/task-api","/web-scraping-api","/web-crawling-api","/browser-api","/mcp","/x402","/use-cases"];
function app(){const a=new Hono<{Bindings:Env}>();mountSitePages(a);a.route("/",agentRoutes);a.get('/openapi.json',c=>c.json({},200,{'cache-control':'public, max-age=3600'}));a.post('/mcp',c=>c.json({protocol:true}));return a;}
describe('public SEO guides',()=>{
 it('serves unique crawlable HTML, schema and valid example arguments',async()=>{
  const titles=new Set();
  for(const path of paths){const r=await app().request('https://oassis.dev'+path);expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('public');const html=await r.text();expect(html).toContain(`rel="canonical" href="https://oassis.dev${path}"`);expect((html.match(/<h1>/g)||[])).toHaveLength(1);expect(html).toContain('application/ld+json');titles.add(html.match(/<title>(.*?)<\/title>/)?.[1]);
   for(const m of html.matchAll(/curl -i https:\/\/api.oassis.dev\/web\/v1\/(\w+)[\s\S]*?-d &#39;([^<]+?)&#39;/g)){
    const schemas={scrape:scrapeRequest,crawl:crawlRequest,map:mapRequest,session:sessionRequest,act:actRequest};
    const body=JSON.parse(m[2]!.replace(/&#34;/g,'"').replace(/&#38;/g,'&'));expect(schemas[m[1]! as keyof typeof schemas]!.safeParse(body).success,`${path}: ${m[1]}`).toBe(true);
   }
  }expect(titles.size).toBe(paths.length);
 });
 it('redirects HTTP and www permanently, preserving the path and query',async()=>{
  for(const url of ['http://oassis.dev/docs?q=1','https://www.oassis.dev/docs?q=1']){const r=await app().request(url);expect(r.status).toBe(308);expect(r.headers.get('location')).toBe('https://oassis.dev/docs?q=1');}
 });
 it('does not intercept MCP POST or API-host discovery',async()=>{
  const a=app();const post=await a.request('https://oassis.dev/mcp',{method:'POST'});expect(await post.json()).toEqual({protocol:true});const api=await a.request('https://api.oassis.dev/mcp');expect(api.status).toBe(404);
 });
 it('keeps task responses private without overriding public document caching',async()=>{
  const a=app();const doc=await a.request('https://api.oassis.dev/openapi.json');expect(doc.headers.get('cache-control')).toContain('public');const task=await a.request('https://api.oassis.dev/agent/v1/tasks/id');expect(task.status).toBe(401);expect(task.headers.get('cache-control')).toBe('no-store');
 });
});
