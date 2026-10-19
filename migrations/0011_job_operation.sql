ALTER TABLE jobs ADD COLUMN operation TEXT CHECK(operation IN ('batch','crawl'));
UPDATE jobs SET operation=(
 SELECT CASE WHEN t.path IN ('/tasks/v1/scrape/batch','/web/v1/scrape/batch','/v1/scrape/batch') OR (t.path='/mcp' AND t.tool='web_scrape_batch') THEN 'batch' ELSE 'crawl' END
 FROM traces t WHERE t.method='POST' AND t.status >= 200 AND t.status < 300 AND (
 t.path IN ('/tasks/v1/scrape/batch','/web/v1/scrape/batch','/v1/scrape/batch','/tasks/v1/crawl','/web/v1/crawl','/v1/crawl') OR (t.path='/mcp' AND t.tool IN ('web_scrape_batch','web_crawl')))
 AND instr(COALESCE(t.resp_body,''),jobs.id)>0 ORDER BY t.at DESC LIMIT 1
) WHERE operation IS NULL;
