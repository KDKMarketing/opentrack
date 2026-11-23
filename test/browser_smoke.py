"""Optional UI smoke test. Start the app locally, then run with Playwright for Python."""
import os
from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.getenv("CHROME_BIN") or None)
        for width in (390, 1280):
            page = browser.new_page(viewport={"width": width, "height": 850})
            page.goto(os.getenv("APP_URL", "http://localhost:3000"))
            page.get_by_role("heading", name="Sign in to OpenTrack").wait_for()
            assert page.get_by_label("Email", exact=True).is_visible()
            assert page.get_by_role("button", name="Create account").is_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            page.close()
        browser.close()

if __name__ == "__main__":
    run()
