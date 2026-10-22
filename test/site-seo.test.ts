import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { landing, sitemapFor } from '../src/landing';
import { SITE_PATHS } from '../src/site-catalog';
import { AGENT_NAMES } from '../src/agents/catalog';
import { mountSitePages } from '../src/site-pages';
import { mountAgentPages } from '../src/agents/pages';
const html=landing({req:{url:'https://oassis.dev/',path:'/'},env:{BASE_URL:'https://api.oassis.dev'}} as any);
describe('public SEO consistency',()=>{
 it('lists every published guide and agent page in the sitemap',async()=>{
  const app=new Hono();mountSitePages(app as any);mountAgentPages(app as any);
  const xml=sitemapFor('https://oassis.dev','/web/v1');
  expect(new Set(SITE_PATHS).size).toBe(SITE_PATHS.length);
  for(const name of AGENT_NAMES)expect(SITE_PATHS).toContain(`/agents/${name}`);
  for(const path of SITE_PATHS){
   expect(xml).toContain(`<loc>https://oassis.dev${path}</loc>`);
   if(!['/','/privacy','/terms'].includes(path))expect((await app.request('https://oassis.dev'+path)).status,path).toBe(200);
  }
  expect(xml).not.toContain('/login');expect(xml).not.toContain('/dashboard');
 });
 it('links trial, guides and monitoring pages from the homepage',()=>{
  for(const path of ['/try','/docs','/web-scraping-api','/web-crawling-api','/browser-api','/task-api','/agents',...AGENT_NAMES.map(n=>`/agents/${n}`)])expect(html).toContain(`href="${path}"`);
 });
 it('describes the same site and organization in social metadata and JSON-LD',()=>{
  const schemas=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1]!));
  const graph=schemas.find(s=>s['@graph'])['@graph'];
  const organization=graph.find((s:any)=>s['@type']==='Organization');
  const site=graph.find((s:any)=>s['@type']==='WebSite');
  expect(site.publisher['@id']).toBe(organization['@id']);expect(organization.sameAs).toEqual(['https://github.com/oassisdev']);
  expect(html).toContain('<meta property="og:url" content="https://oassis.dev/">');
  expect(html).toContain('<meta property="og:image" content="https://oassis.dev/og-image.png">');
  expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  expect(html).toContain('web scraping, crawling, browser automation and research through one API');
 });
 it('does not advertise obsolete free MCP access or old multi-format prices',()=>{
  const readme=readFileSync('README.md','utf8');
  expect(readme).not.toContain('every tool works without a key');expect(readme).not.toContain('Free, no key, no account');expect(readme).not.toContain('HTTP-library defaults are refused');
  expect(readme).toContain('100-credit trial');expect(readme).toContain('`markdown` + `controls` on a fresh web page = $0.004');
 });
});
