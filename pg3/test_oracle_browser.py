import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        try:
            browser = await p.chromium.launch(headless=True)
            print("BROWSER_OK")
            await browser.close()
        except Exception as e:
            print(f"BROWSER_FAIL: {e}")

if __name__ == "__main__":
    asyncio.run(run())
