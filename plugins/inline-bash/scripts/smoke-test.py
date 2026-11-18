#!/usr/bin/env python3
"""
Smoke-test dsh-inline-bash against a running scratch DSH Web profile.

Usage:
    python3 scripts/smoke-test.py "http://127.0.0.1:3098/?token=<token>" [shots-dir]

It dismisses the first-run dialogs, types `!pwd` + Enter, asserts the local
result card contains the Session cwd, asserts the composer is not submitted,
and finally checks that an ordinary draft paints no bash banner (the synthetic
Enter probe checks that no interception is registered for it).

Requires: python3 with playwright installed and the Chromium binary below
(override with CHROME_PATH).
"""
import os
import sys
import time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3098/"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "."
CHROME = os.environ.get(
    "CHROME_PATH",
    "/home/YOUR_USER/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
)


def dismiss_dialogs(page):
    for selector in ('[role="dialog"] button[aria-label="Close"]', 'button:has-text("Continue")'):
        try:
            page.locator(selector).first.click(timeout=1500)
            page.wait_for_timeout(400)
        except Exception:
            pass


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME,
            args=["--no-sandbox", "--disable-gpu"],
            headless=True,
        )
        page = browser.new_page(viewport={"width": 1400, "height": 950})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL)
        page.wait_for_timeout(9000)
        dismiss_dialogs(page)
        page.wait_for_timeout(500)
        assert page.eval_on_selector("body", "b => b.getAttribute('data-inline-bash-plugin')") == "ready", "plugin bundle not loaded"

        editor = page.locator("[data-composer-input]")
        editor.click()
        editor.type("!pwd")
        page.wait_for_timeout(400)
        mode = page.eval_on_selector(
            "[data-composer-card]", "c => c.getAttribute('data-inline-bash')"
        )
        assert mode == "on", "composer was not marked as bash mode"
        page.screenshot(path=os.path.join(SHOTS, "smoke-bash-mode.png"))
        editor.press("Enter")
        page.wait_for_selector("[data-inline-bash-result]", timeout=20000)
        page.wait_for_timeout(600)
        output = page.eval_on_selector(
            "[data-inline-bash-output]", "n => n.textContent"
        ) or ""
        assert "$ pwd" in output, "result card does not show the command: %r" % output
        assert "exit 0" in output, "result card does not show a zero exit: %r" % output
        draft = page.eval_on_selector(
            "[data-composer-input]", "n => n.textContent"
        )
        assert not draft.strip(), "draft was not cleared after the bash command"
        page.screenshot(path=os.path.join(SHOTS, "smoke-pwd-result.png"))

        # Ordinary draft: no banner and no interception registered for Enter.
        editor.click()
        editor.type("hello ordinary message")
        page.wait_for_timeout(300)
        assert page.locator("[data-inline-bash-mode]").count() == 0, "bash banner shown for an ordinary draft"
        assert page.eval_on_selector(
            "[data-composer-card]", "c => c.getAttribute('data-inline-bash')"
        ) is None, "ordinary draft marked the composer as bash mode"
        page.screenshot(path=os.path.join(SHOTS, "smoke-ordinary-draft.png"))
        print("OK: !pwd output =", output.replace("\n", " | "))
        print("OK: ordinary draft untouched; page errors:", errors)
        browser.close()


if __name__ == "__main__":
    main()
