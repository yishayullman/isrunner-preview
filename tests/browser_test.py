import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "test-results" / "screenshots"
DB_PATH = ROOT / "test-results" / "browser-test.db"


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for_health(url: str, timeout: float = 10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/api/health", timeout=1) as resp:
                if resp.status == 200:
                    return
        except Exception:
            time.sleep(0.15)
    raise RuntimeError("Isrunner server failed to become healthy in time")


def assert_no_horizontal_overflow(page, label: str):
    dims = page.evaluate(
        "() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })"
    )
    assert dims["sw"] <= dims["cw"] + 1, (
        f"Horizontal overflow detected on {label}: scrollWidth={dims['sw']} > clientWidth={dims['cw']}"
    )


def snap(page, filename: str, full_page: bool = False):
    page.evaluate("() => { const c = document.getElementById('toast-container'); if (c) c.innerHTML = ''; }")
    page.screenshot(path=str(OUT_DIR / filename), full_page=full_page)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()

    env = os.environ.copy()
    env["DB_PATH"] = str(DB_PATH)
    env["FORCE_RESEED"] = "1"

    # Seed isolated local demo DB (only self_reported_legacy runs!)
    subprocess.run(["node", str(ROOT / "scripts" / "seed-local-demo.mjs")], env=env, check=True)

    port = get_free_port()
    base_url = f"http://127.0.0.1:{port}"
    env["PORT"] = str(port)
    env["HOST"] = "127.0.0.1"

    server_proc = subprocess.Popen(
        ["node", str(ROOT / "src" / "server.mjs")],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    console_errors = []
    page_errors = []

    try:
        wait_for_health(base_url)

        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path="/usr/bin/google-chrome",
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )

            # 1. Mobile 390x844 viewport walkthrough
            context = browser.new_context(
                viewport={"width": 390, "height": 844},
                locale="he-IL",
            )
            page = context.new_page()
            page.on(
                "console",
                lambda msg: console_errors.append(msg.text) if msg.type == "error" else None,
            )
            page.on("pageerror", lambda err: page_errors.append(str(err)))

            # Auth screen
            page.goto(base_url, wait_until="networkidle")
            assert page.locator("html").get_attribute("dir") == "rtl"
            assert page.locator(".brand-name").inner_text().strip() == "Isrunner"
            assert_no_horizontal_overflow(page, "auth@390")
            snap(page, "01_auth_390px.png")

            # Login as noa_levi
            page.fill("#auth-username", "noa_levi")
            page.fill("#auth-password", "RunSafe123!")
            page.click("#auth-submit-btn")
            page.wait_for_selector("#closed-add-card")

            # Verify exact closed add-run message
            closed_text = page.locator("#closed-add-card").inner_text()
            assert "הוספת ריצות סגורה כרגע, ריצה נקלטת רק ממקור מדידה מחובר, כרגע אין מקור מחובר" in closed_text

            # Verify bottom nav tabs (בית, שיאים, חברים, קבוצות, אני) and red badge on Home
            nav_texts = [el.inner_text().strip() for el in page.locator(".bottom-nav-btn span:last-child").all()]
            assert nav_texts == ["בית", "שיאים", "חברים", "קבוצות", "אני"], f"Unexpected nav: {nav_texts}"
            badge = page.locator(".bottom-nav .nav-badge")
            assert badge.is_visible()
            assert badge.inner_text().strip() == "1"

            # Verify notification omits Omer's run note
            notif_card_text = page.locator("#notifications-card").inner_text()
            assert "עומר כהן" in notif_card_text
            assert "הערה שלא אמורה להופיע בהתראה" not in notif_card_text

            # Verify all 5 PR cards exist on Home (including "—" for marathon)
            assert page.locator(".pr-card").count() == 5
            assert "—" in page.locator(".pr-grid").inner_text()

            assert_no_horizontal_overflow(page, "home@390")
            snap(page, "02_home_390px.png")

            # Click notification -> opens Omer's shared run detail
            page.locator(".notif-item").first.click()
            page.wait_for_selector("#btn-report-run")
            detail_text = page.locator("#main-content").inner_text()
            assert "דיווח עצמי, לא מאומת" in detail_text
            assert "הערה שלא אמורה להופיע בהתראה" in detail_text
            assert_no_horizontal_overflow(page, "run-detail@390")
            snap(page, "03_run_detail_390px.png")

            # Leaderboard tab
            page.click('.bottom-nav-btn[data-nav="#/leaderboard"]')
            page.wait_for_selector("#ranking-rule-box")
            lb_text = page.locator("#main-content").inner_text()
            assert "5.00 עד 5.24" in lb_text
            assert "עומר כהן" in lb_text
            assert "נועה לוי" in lb_text
            # Maya (friends-only, not accepted yet) & Dan (none) MUST NOT appear!
            assert "מאיה שרון" not in lb_text
            assert "דן מזרחי" not in lb_text
            assert_no_horizontal_overflow(page, "leaderboard@390")
            snap(page, "04_leaderboard_390px.png")

            # Friends tab
            page.click('.bottom-nav-btn[data-nav="#/friends"]')
            page.wait_for_selector("#friend-search-form")
            friends_text = page.locator("#main-content").inner_text()
            assert "מאיה שרון" in friends_text  # incoming pending request
            assert "עומר כהן" in friends_text  # accepted friend
            assert_no_horizontal_overflow(page, "friends@390")
            snap(page, "05_friends_390px.png")

            # Open Omer's profile from Friends
            page.locator('button.user-name-link', has_text="עומר כהן").first.click()
            page.wait_for_selector(".pr-grid")
            assert page.locator(".pr-card").count() == 5
            assert_no_horizontal_overflow(page, "profile@390")
            snap(page, "06_profile_390px.png")

            # Groups tab -> preview SEA630 -> join -> group detail & leaderboard
            page.click('.bottom-nav-btn[data-nav="#/groups"]')
            page.wait_for_selector("#group-preview-form")
            page.fill("#group-code-input", "SEA630")
            page.click('#group-preview-form button[type="submit"]')
            page.wait_for_selector("#group-preview-box")
            assert "ריצת שבת על הטיילת" in page.locator("#group-preview-box").inner_text()
            assert_no_horizontal_overflow(page, "groups-preview@390")
            snap(page, "07_groups_preview_390px.png")

            page.click("#btn-confirm-join-group")
            page.wait_for_selector("#group-join-code")
            assert_no_horizontal_overflow(page, "group-detail@390")
            snap(page, "08_group_detail_390px.png")

            # Me & Privacy Settings tab
            page.click('.bottom-nav-btn[data-nav="#/me"]')
            page.wait_for_selector("#privacy-settings-card")
            me_text = page.locator("#privacy-settings-card").inner_text()
            assert "כולם" in me_text and "חברים בלבד" in me_text and "אף אחד" in me_text
            assert "להופיע בדירוג הכללי" in me_text
            assert_no_horizontal_overflow(page, "me@390")
            snap(page, "09_me_settings_390px.png")

            # Measurement Sources & Consent screen (must be honestly NOT connected!)
            page.click("#btn-go-sources")
            page.wait_for_selector("#garmin-source-card")
            page.wait_for_selector("#strava-source-card")
            src_text = page.locator("#garmin-source-card").inner_text()
            assert "לא מחובר" in src_text
            assert "Garmin Connect Developer Program" in src_text
            assert page.locator("#btn-connect-garmin").is_disabled()
            assert "Strava" in page.locator("#strava-source-card").inner_text()
            assert_no_horizontal_overflow(page, "sources@390")
            snap(page, "10_sources_consent_390px.png")

            # Live GPS Run Tracker screen
            page.click("#btn-start-live-gps")
            page.wait_for_selector("#gps-cockpit-card")
            assert "מדידת ריצה חיה" in page.locator("#main-content").inner_text()
            assert_no_horizontal_overflow(page, "track@390")
            snap(page, "13_gps_tracker_390px.png")

            # Resources page
            page.click('.bottom-nav-btn[data-nav="#/me"]')
            page.wait_for_selector("#btn-go-resources")
            page.click("#btn-go-resources")
            page.wait_for_selector("#product-ideas-section")
            res_text = page.locator("#main-content").inner_text()
            assert "חימום דינמי" in res_text
            assert "שחרור אחרי ריצה" in res_text
            assert "פודקאסטים לריצה" in res_text
            assert_no_horizontal_overflow(page, "resources@390")
            snap(page, "11_resources_390px.png")

            # 2. Check 320px narrow mobile width has ZERO horizontal overflow
            page.set_viewport_size({"width": 320, "height": 568})
            for route_hash in ["#/home", "#/track", "#/leaderboard", "#/friends", "#/groups", "#/me", "#/sources"]:
                page.evaluate(f"window.location.hash = '{route_hash}'")
                page.wait_for_timeout(300)
                assert_no_horizontal_overflow(page, f"{route_hash}@320")

            # 3. Check Desktop 1280x800 layout
            page.set_viewport_size({"width": 1280, "height": 800})
            page.evaluate("window.location.hash = '#/home'")
            page.wait_for_selector("#closed-add-card")
            assert page.locator("#desktop-nav").is_visible()
            assert not page.locator("#bottom-nav").is_visible()
            assert_no_horizontal_overflow(page, "home@1280")
            snap(page, "12_home_desktop.png")

            browser.close()

        assert len(console_errors) == 0, f"Browser console errors: {console_errors}"
        assert len(page_errors) == 0, f"Uncaught page errors: {page_errors}"
        print("SUCCESS: All Playwright browser tests (390px, 320px, 1280px) passed with 0 console/page errors.")
        print(f"Screenshots saved in {OUT_DIR}")

    finally:
        server_proc.terminate()
        try:
            server_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server_proc.kill()


if __name__ == "__main__":
    main()
