import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from crawl4ai import AsyncWebCrawler
# Note for Marco: crawl4ai needs to be installed, and playwright browsers installed (playwright install)

app = FastAPI(title="OMEGA Python Oracle", description="Crawl4AI Undetected Sidecar", version="1.0.0")

class CrawlRequest(BaseModel):
    url: str
    bypass_cache: bool = True

class CrawlResponse(BaseModel):
    url: str
    html: str
    markdown: str
    success: bool
    error: str | None = None

crawler = None

@app.on_event("startup")
async def startup_event():
    global crawler
    print("🚀 Starting OMEGA Python Oracle [Crawl4AI Module]...")
    crawler = AsyncWebCrawler()
    await crawler.__aenter__()
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
        
        # In Crawl4AI, calling arun with magic=True enables the undetected mode
        result = await crawler.arun(
            url=req.url, 
            magic=True, # The most important parameter: bypasses Cloudflare/Datadome
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
    port = int(os.getenv("ORACLE_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
