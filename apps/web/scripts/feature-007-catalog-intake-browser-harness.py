#!/usr/bin/env python3
"""Feature 007 production React/CSS browser evidence harness."""

import asyncio
import json
import os
from pathlib import Path

from playwright.async_api import async_playwright


BASE_URL = os.environ.get("FEATURE007_BASE_URL", "http://127.0.0.1:4317/")
REPO_ROOT = Path(__file__).resolve().parents[3]
EVIDENCE_DIR = (
    REPO_ROOT
    / "features/007-place-enrichment-and-nearby-diagnostics/evidence/ui/t02-browser"
)
CONVERSATION_ID = "7" * 32
REPORT = {
    "base_url": BASE_URL,
    "renderer": "Playwright Chromium headless shell",
    "surface": "running Vinext production CatalogIntakePanel React/CSS",
    "scenarios": {},
}


async def main():
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            await capture_loading_and_empty(browser)
            await capture_clarification(browser)
            await capture_preview_conflict_success(browser)
            await capture_dependency_error(browser)
            await capture_mobile(browser)
        finally:
            await browser.close()

    (EVIDENCE_DIR / "feature-007-t02-browser-report.json").write_text(
        json.dumps(REPORT, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


async def capture_loading_and_empty(browser):
    release = asyncio.Event()
    context, page, panel = await open_fixture(
        browser,
        {"width": 1440, "height": 1000},
        {
            "discover": [
                {"body": discover_output([]), "gate": release},
            ]
        },
    )
    try:
        query = panel.get_by_label("Restaurant name or address")
        await query.fill("讃岐うどん大使 東京麺通団")
        await panel.get_by_role("button", name="Find matches").click()
        pending = panel.get_by_role("button", name="Finding matches…")
        await pending.wait_for()
        assert await pending.is_disabled()
        assert await panel.get_attribute("aria-busy") == "true"
        await screenshot(panel, "t02-desktop-loading.png")
        REPORT["scenarios"]["loading"] = await inspect(
            page, panel, expected_focus=None
        )

        release.set()
        await panel.get_by_text("No clear place match yet.").wait_for()
        assert await active_text(page) == "No match"
        refine = panel.get_by_role("button", name="Refine the place")
        assert (await refine.bounding_box())["height"] >= 44
        await screenshot(panel, "t02-desktop-empty-refine.png")
        REPORT["scenarios"]["empty-refine"] = await inspect(
            page, panel, expected_focus="No match"
        )
        await refine.click()
        assert await page.evaluate("document.activeElement?.id") == "catalog-intake-query"
    finally:
        await context.close()


async def capture_clarification(browser):
    context, page, panel = await open_fixture(
        browser,
        {"width": 1440, "height": 1100},
        {
            "discover": [{"body": discover_output([candidate()])}],
            "select": [{"body": clarification_output()}],
        },
    )
    try:
        await reach_candidates(panel)
        await panel.get_by_role("button", name="Review selected place").click()
        await panel.get_by_text("Clarify this place").wait_for()
        assert await active_text(page) == "Clarify this place"
        details = panel.locator(".catalog-intake-corrections")
        summary = details.locator("summary")
        assert await details.get_attribute("open") is not None
        assert await summary.get_attribute("aria-expanded") == "true"
        assert await summary.get_attribute("aria-controls") == "catalog-intake-correction-fields"
        assert await summary.get_attribute("aria-describedby") == "catalog-intake-clarification"
        for field_name in ("Confirmed name", "Area", "Address"):
            described_by = await panel.get_by_label(
                field_name, exact=True
            ).get_attribute(
                "aria-describedby"
            )
            assert "catalog-intake-clarification" in described_by
        await screenshot(panel, "t02-desktop-clarification.png")
        REPORT["scenarios"]["clarification"] = await inspect(
            page, panel, expected_focus="Clarify this place"
        )
    finally:
        await context.close()


async def capture_preview_conflict_success(browser):
    context, page, panel = await open_fixture(
        browser,
        {"width": 1440, "height": 1200},
        {
            "discover": [{"body": discover_output([candidate()])}],
            "select": [{"body": preview_output(3)}],
            "confirm": [
                {
                    "body": {
                        "status": "conflict",
                        "newPreview": preview(4),
                    }
                },
                {"body": committed_output()},
            ],
        },
    )
    try:
        await reach_candidates(panel)
        corrections = panel.locator(".catalog-intake-corrections")
        summary = corrections.locator("summary")
        assert await corrections.get_attribute("open") is None
        assert await summary.get_attribute("aria-expanded") == "false"
        attribution = panel.get_by_role("link", name="Google Maps")
        assert await attribution.evaluate(
            "element => Boolean(element.parentElement?.querySelector('input[type=radio]'))"
        )
        await screenshot(panel, "t02-desktop-candidate-selection.png")
        REPORT["scenarios"]["candidate-selection"] = await inspect(
            page, panel, expected_focus="Select a match"
        )

        await panel.get_by_role("button", name="Review selected place").click()
        await assert_preview(page, panel)
        await screenshot(panel, "t02-desktop-preview.png")
        REPORT["scenarios"]["preview"] = await inspect(
            page, panel, expected_focus="Review the proposal"
        )

        await panel.get_by_role("button", name="Confirm and save").click()
        await panel.get_by_text("Evidence changed during confirmation.").wait_for()
        assert await active_text(page) == "Preview changed"
        await screenshot(panel, "t02-desktop-conflict.png")
        REPORT["scenarios"]["conflict"] = await inspect(
            page, panel, expected_focus="Preview changed"
        )

        await panel.get_by_role(
            "button", name="Review changed preview and confirm again"
        ).click()
        await panel.get_by_text("Place saved to Owner review.").first.wait_for()
        assert await active_text(page) == "Place saved"
        await screenshot(panel, "t02-desktop-success.png")
        REPORT["scenarios"]["success"] = await inspect(
            page, panel, expected_focus="Place saved"
        )
    finally:
        await context.close()


async def capture_dependency_error(browser):
    context, page, panel = await open_fixture(
        browser,
        {"width": 1440, "height": 1100},
        {
            "discover": [{"body": discover_output([candidate()])}],
            "select": [{"body": preview_output(3)}],
            "confirm": [
                {
                    "status": 503,
                    "body": {
                        "code": "dependency_failure",
                        "message": "Place facts provider is unavailable. Nothing was saved.",
                        "retryable": True,
                    },
                }
            ],
        },
    )
    try:
        await reach_candidates(panel)
        await panel.get_by_role("button", name="Review selected place").click()
        await panel.get_by_role("button", name="Confirm and save").click()
        retry = panel.get_by_role("button", name="Retry")
        await retry.wait_for()
        assert await active_text(page) == "Retry"
        assert (await retry.bounding_box())["height"] >= 44
        await screenshot(panel, "t02-desktop-dependency-error.png")
        REPORT["scenarios"]["dependency-error"] = await inspect(
            page, panel, expected_focus="Retry"
        )
    finally:
        await context.close()


async def capture_mobile(browser):
    context, page, panel = await open_fixture(
        browser,
        {"width": 390, "height": 844},
        {
            "discover": [{"body": discover_output([candidate()])}],
            "select": [{"body": preview_output(3)}],
        },
        is_mobile=True,
    )
    try:
        await reach_candidates(panel)
        await viewport_screenshot(
            page, "t02-mobile-390-candidate-selection.png"
        )
        candidate_report = await inspect(
            page, panel, expected_focus="Select a match"
        )
        assert candidate_report["no_horizontal_overflow"]
        REPORT["scenarios"]["mobile-390-candidate-selection"] = candidate_report

        await panel.get_by_role("button", name="Review selected place").click()
        await assert_preview(page, panel)
        await viewport_screenshot(page, "t02-mobile-390-preview.png")
        preview_report = await inspect(
            page, panel, expected_focus="Review the proposal"
        )
        assert preview_report["no_horizontal_overflow"]
        REPORT["scenarios"]["mobile-390-preview"] = preview_report

        confirm = panel.get_by_role("button", name="Confirm and save")
        await confirm.scroll_into_view_if_needed()
        confirm_box = await confirm.bounding_box()
        assert confirm_box is not None
        assert confirm_box["y"] >= 0
        assert confirm_box["y"] + confirm_box["height"] <= 844
        await viewport_screenshot(
            page, "t02-mobile-390-preview-confirm.png"
        )
        confirm_report = await inspect(
            page, panel, expected_focus="Review the proposal"
        )
        confirm_report["confirm_action"] = {
            "x": confirm_box["x"],
            "y": confirm_box["y"],
            "width": confirm_box["width"],
            "height": confirm_box["height"],
            "in_viewport": True,
        }
        REPORT["scenarios"]["mobile-390-preview-confirm-visible"] = (
            confirm_report
        )
    finally:
        await context.close()


async def open_fixture(browser, viewport, plans, is_mobile=False):
    context = await browser.new_context(viewport=viewport, is_mobile=is_mobile)
    page = await context.new_page()
    counters = {}

    async def route_api(route):
        path = route.request.url.split("?", 1)[0]
        if path.endswith("/api/auth/owner"):
            await fulfill(route, {"authenticated": True})
            return
        if "/api/catalog-intake/" not in path:
            await route.continue_()
            return
        endpoint = path.rsplit("/", 1)[-1]
        index = counters.get(endpoint, 0)
        counters[endpoint] = index + 1
        endpoint_plans = plans.get(endpoint, [])
        assert endpoint_plans, f"Unexpected catalog intake endpoint: {endpoint}"
        plan = endpoint_plans[min(index, len(endpoint_plans) - 1)]
        if plan.get("gate"):
            await plan["gate"].wait()
        await fulfill(route, plan["body"], plan.get("status", 200))

    await page.route("**/api/**", route_api)
    await page.goto(BASE_URL)
    panel = page.locator(".catalog-intake")
    await panel.wait_for()
    return context, page, panel


async def reach_candidates(panel):
    await panel.get_by_label("Restaurant name or address").fill(
        "讃岐うどん大使 東京麺通団"
    )
    await panel.get_by_role("button", name="Find matches").click()
    await panel.get_by_text("Select a match").wait_for()


async def assert_preview(page, panel):
    await panel.get_by_text("Review the proposal").wait_for()
    assert await active_text(page) == "Review the proposal"
    for heading in ("Place", "Location", "Restaurant facts", "Warnings"):
        await panel.get_by_role("heading", name=heading, exact=True).wait_for()
    facts = panel.get_by_role("region", name="Restaurant facts")
    assert await facts.get_by_text("Unknown", exact=True).count() == 2
    assert await facts.get_by_text("Tabelog", exact=True).count() == 1
    assert await facts.get_by_text("Reservation", exact=True).count() == 1


async def inspect(page, panel, expected_focus):
    geometry = await panel.evaluate(
        """element => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          no_horizontal_overflow: element.scrollWidth <= element.clientWidth
        })"""
    )
    if expected_focus is not None:
        assert await active_text(page) == expected_focus

    audit = await panel.evaluate(
        r"""element => {
          const visible = (node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden';
          };
          const duplicate_ids = [...element.querySelectorAll('[id]')]
            .map((node) => node.id)
            .filter((id, index, ids) => ids.indexOf(id) !== index);
          const describedby_missing = [...element.querySelectorAll('[aria-describedby]')]
            .flatMap((node) => (node.getAttribute('aria-describedby') || '').split(/\s+/u))
            .filter((id) => id && !document.getElementById(id));
          const correction = element.querySelector('.catalog-intake-corrections');
          const correctionSummary = correction?.querySelector('summary');
          const disclosure_matches = !correctionSummary ||
            correctionSummary.getAttribute('aria-expanded') === String(correction.open);
          const targets = [...element.querySelectorAll(
            'button, a, summary, input:not([type=radio]), .catalog-intake-candidates label'
          )].filter(visible);
          const sizes = targets.map((node) => {
            const rect = node.getBoundingClientRect();
            return { name: node.textContent?.trim() || node.getAttribute('aria-label') || node.id,
              width: rect.width, height: rect.height };
          });
          const undersized_targets = sizes.filter(
            (target) => target.width < 44 || target.height < 44
          );
          const labels_missing = [...element.querySelectorAll('input:not([type=radio])')]
            .filter((input) => !element.querySelector(`label[for="${input.id}"]`))
            .map((input) => input.id);
          const google = [...element.querySelectorAll('a')]
            .find((link) => link.textContent?.trim() === 'Google Maps');
          const google_attribution_same_container = !google || Boolean(
            google.parentElement?.querySelector('input[type=radio]')
          );
          return {
            duplicate_ids,
            describedby_missing,
            disclosure_matches,
            labels_missing,
            undersized_targets,
            min_target_px: sizes.length
              ? Math.min(...sizes.map((target) => Math.min(target.width, target.height)))
              : null,
            google_attribution_same_container,
            live_region: element.querySelector('[aria-live=polite]')?.textContent?.trim(),
          };
        }"""
    )
    assert geometry["no_horizontal_overflow"]
    assert not audit["duplicate_ids"]
    assert not audit["describedby_missing"]
    assert audit["disclosure_matches"]
    assert not audit["labels_missing"]
    assert not audit["undersized_targets"], audit["undersized_targets"]
    assert audit["google_attribution_same_container"]
    return {
        **geometry,
        "viewport": page.viewport_size,
        "focus": await active_text(page) if expected_focus is not None else None,
        "a11y": audit,
    }


async def screenshot(panel, filename):
    await panel.screenshot(path=str(EVIDENCE_DIR / filename))


async def viewport_screenshot(page, filename):
    await page.screenshot(path=str(EVIDENCE_DIR / filename))


async def active_text(page):
    return await page.evaluate(
        "document.activeElement?.textContent?.trim() || document.activeElement?.getAttribute('aria-label') || ''"
    )


async def fulfill(route, body, status=200):
    await route.fulfill(
        status=status,
        headers={
            "content-type": "application/json",
            "x-atlas-web-conversation-id": CONVERSATION_ID,
        },
        body=json.dumps(body, ensure_ascii=False),
    )


def candidate():
    return {
        "ordinal": 1,
        "transientName": "讃岐うどん大使 東京麺通団",
        "transientAddress": "東京都新宿区西新宿7丁目9-15 長い住所でも折り返す候補",
        "attribution": {
            "label": "Google Maps",
            "url": "https://maps.google.com/",
        },
    }


def discover_output(candidates):
    return {
        "status": "candidates_ready" if candidates else "clarification_required",
        "sessionId": "session-feature-007-browser",
        "sessionVersion": 1,
        "candidates": candidates,
        "hasMore": False,
        "expiresAt": "2026-09-24T12:30:00.000Z",
    }


def clarification_output():
    return {
        "status": "clarification_required",
        "sessionId": "session-feature-007-browser",
        "sessionVersion": 2,
        "clarification": {
            "code": "ambiguous_location",
            "prompt": "Choose a branch or correct its location.",
            "fields": ["area", "address"],
        },
        "expiresAt": "2026-09-24T12:30:00.000Z",
    }


def preview_output(version):
    return {
        "status": "preview_ready",
        "sessionId": "session-feature-007-browser",
        "sessionVersion": version,
        "preview": preview(version),
        "expiresAt": "2026-09-24T12:30:00.000Z",
    }


def preview(version):
    return {
        "sessionId": "session-feature-007-browser",
        "previewVersion": version,
        "state": "preview_ready",
        "candidateIdentity": {
            "providerNamespace": "google_places",
            "placeId": "place-feature-007-browser",
        },
        "ownerFields": {},
        "titleProposal": {
            "provenance": "owner_query",
            "value": "讃岐うどん大使 東京麺通団",
        },
        "locationEvidence": {"status": "unknown"},
        "tabelog": {"status": "unknown"},
        "reservation": {"status": "unknown"},
        "suspectedDuplicates": [],
        "unknownFields": ["address", "coordinates", "tabelog", "reservation"],
        "warnings": [
            {
                "code": "durable_location_needs_review",
                "message": "Location remains unknown and needs Owner review.",
            }
        ],
        "evidenceDigest": "a" * 64,
        "catalogRevision": "catalog-feature-007-browser",
        "expiresAt": "2026-09-24T12:30:00.000Z",
    }


def committed_output():
    return {
        "status": "committed_needs_review",
        "itemId": "item-feature-007-browser",
        "receiptRef": "receipt-feature-007-browser",
        "replayed": False,
    }


if __name__ == "__main__":
    asyncio.run(main())
