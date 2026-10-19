/** Public product classification shared by HTML, OpenAPI, MCP and the console. */
export const WEB_FAMILIES = [
  { id: 'web', name: 'Web Tools', prefix: '/web/v1' },
  { id: 'tasks', name: 'Web Tasks', prefix: '/tasks/v1' },
] as const;
const operation = (family: 'web' | 'tasks', id: string, method: 'GET' | 'POST', path: string, mcp: string, description: string, cancel = false) =>
  ({ family, id, method, path, mcp, description, ...(cancel ? { mcpArguments: { cancel: true } } : {}) });
export const WEB_CATALOG = [
  operation('web','web.scrape','POST','/web/v1/scrape','web_scrape','Read a page or document in the requested formats.'),
  operation('web','web.map','POST','/web/v1/map','web_map',"List a site's URLs from its sitemap and optionally the page."),
  operation('web','web.search/exa','POST','/web/v1/search','web_search_exa','Search the web.'),
  operation('web','web.session','POST','/web/v1/session','web_session_open','Open a browser session and inspect its controls.'),
  operation('web','web.act','POST','/web/v1/act','web_act','Interact with an open browser session.'),
  operation('web','web.session.close','POST','/web/v1/session/{id}/close','web_session_close','Close the browser session and settle any outstanding time.'),
  operation('web','web.feedback','POST','/web/v1/feedback','web_feedback','Report whether a result was correct. Free.'),
  operation('tasks','web.scrape/batch','POST','/tasks/v1/scrape/batch','web_scrape_batch','Start a batch extraction job from a supplied list of URLs.'),
  operation('tasks','tasks.batch.status','GET','/tasks/v1/scrape/batch/{id}','web_batch_status','Read batch status and collect its results.'),
  operation('tasks','tasks.batch.cancel','POST','/tasks/v1/scrape/batch/{id}/cancel','web_batch_status','Cancel pending batch work. With MCP, send cancel: true.',true),
  operation('tasks','web.crawl','POST','/tasks/v1/crawl','web_crawl','Start a crawl job that discovers and reads linked pages.'),
  operation('tasks','tasks.crawl.status','GET','/tasks/v1/crawl/{id}','web_crawl_status','Read crawl status and collect its results.'),
  operation('tasks','tasks.crawl.cancel','POST','/tasks/v1/crawl/{id}/cancel','web_crawl_status','Cancel pending crawl work. With MCP, send cancel: true.',true),
  operation('tasks','task.start','POST','/tasks/v1/research','web_task_start','Start research from public pages and return an answer with sources.'),
  operation('tasks','task.status','GET','/tasks/v1/research/{id}','web_task_status','Read research progress, sources, result and billing.'),
  operation('tasks','task.cancel','POST','/tasks/v1/research/{id}/cancel','web_task_cancel','Cancel pending research work.'),
];
