import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from crawl4ai import AsyncWebCrawler
from crawl4ai.async_configs import CrawlerRunConfig
# Note for Marco: crawl4ai needs to be installed, and playwright browsers installed (playwright install)

app = FastAPI(title="OMEGA Python Oracle", description="Crawl4AI Undetected Sidecar", version="1.0.0")

class CrawlRequest(BaseModel):
    url: str
    bypass_cache: bool = True
    js_code: str | list[str] | None = None
    wait_for: str | None = None

class CrawlResponse(BaseModel):
    url: str
    html: str
    markdown: str
    success: bool
    error: str | None = None

crawler = None

async def on_after_goto(page, context, **kwargs):
    try:
        reject_btn = page.locator('#W0wltc')
        if await reject_btn.count() > 0:
            print("🕵️‍♂️ Oracle Auto-Heal: Clicking Google Consent 'Rifiuta tutto'")
            async with page.expect_navigation(timeout=10000):
                await reject_btn.first.click()
    except Exception:
        pass
    return page

@app.on_event("startup")
async def startup_event():
    global crawler
    print("🚀 Starting OMEGA Python Oracle [Crawl4AI Module]...")
    crawler = AsyncWebCrawler()
    await crawler.__aenter__()
    crawler.crawler_strategy.set_hook("after_goto", on_after_goto)
    print("✅ WebCrawler started.")

@app.on_event("shutdown")
async def shutdown_event():
    global crawler
    if crawler:
        print("🛑 Shutting down WebCrawler...")
        await crawler.__aexit__(None, None, None)

@app.get("/api/v1/health")
async def healthcheck():
    return {
        "ok": crawler is not None,
        "crawler_initialized": crawler is not None,
    }

@app.post("/api/v1/extract", response_model=CrawlResponse)
async def extract_content(req: CrawlRequest):
    global crawler
    if not crawler:
        raise HTTPException(status_code=500, detail="Crawler not initialized.")
    
    try:
        print(f"🕵️‍♂️ Scanning URL: {req.url}")
        
        # In Crawl4AI 0.8.0+, we use CrawlerRunConfig for run-level settings
        js_code_list = [req.js_code] if req.js_code else []
        config = CrawlerRunConfig(
            magic=True, # The most important parameter: bypasses Cloudflare/Datadome
            js_code=js_code_list,
            wait_for=f"css:{req.wait_for}" if req.wait_for and not req.wait_for.startswith('js:') else req.wait_for
        )
        
        result = await crawler.arun(
            url=req.url, 
            config=config,
            bypass_cache=req.bypass_cache
        )
        
        return CrawlResponse(
            url=req.url,
            html=result.html or "", # Used by MasterPipeline
            markdown=result.markdown or "", # Used by Perplexity Oracle if needed
            success=result.success,
            error=result.error_message
        )
        
    except Exception as e:
        print(f"❌ Error scanning {req.url}: {str(e)}")
        return CrawlResponse(
            url=req.url,
            html="",
            markdown="",
            success=False,
            error=str(e)
        )

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("ORACLE_HOST", "127.0.0.1")
    port = int(os.getenv("ORACLE_PORT", "8765"))
    uvicorn.run(app, host=host, port=port)
