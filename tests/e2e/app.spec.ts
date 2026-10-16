import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const email = () => process.env.E2E_EMAIL!, password = () => process.env.E2E_PASSWORD!, tag = () => process.env.E2E_TAG!;

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email());
  await page.getByLabel("Password").fill(password());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}
const audit = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations
    .map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`);

test("sign-in rejects a wrong password, then accepts the right one", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(email());
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#main").getByRole("alert")).toContainText(/invalid/i);
  await page.getByLabel("Password").fill(password());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Quick Capture" })).toBeVisible();
});

test("library: search, provenance, detail, filter", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Library" }).click();
  await page.getByLabel("Search prompts and ideas").fill(`${tag()} dinners`);
  await page.getByRole("button", { name: "Search" }).click();
  const results = page.getByRole("region", { name: "Results" });
  await expect(results.getByRole("button", { name: "Weekly meal planner" })).toBeVisible();
  await expect(results.getByText("notes/meals.md".split("/").pop()!, { exact: false })).toBeVisible(); // provenance chip

  await results.getByRole("button", { name: "Weekly meal planner" }).click();
  const detail = page.getByRole("region", { name: "Record detail" });
  await expect(detail.getByRole("heading", { name: "Weekly meal planner" })).toBeVisible();
  await expect(detail.getByLabel("Original text")).toContainText("healthy dinners");
  await expect(detail.getByText("notes/meals.md")).toBeVisible();

  await page.getByLabel("Search prompts and ideas").fill(tag());
  await page.getByLabel("Category").selectOption("Home & Lifestyle");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(results.getByRole("listitem")).toHaveCount(1);
});

test("review: decide items and see the queue shrink", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Review" }).click();
  await expect(page.getByText(/never merged/)).toBeVisible();
  await expect(page.getByRole("listitem").first()).toBeVisible();
  const all = page.getByRole("button", { name: /^All \(/ });
  const before = Number((await all.textContent())!.match(/\((\d+)\)/)![1]);
  expect(before).toBeGreaterThanOrEqual(3);

  // Approve the model's suggestion for the low-confidence naming prompt.
  const naming = page.getByRole("listitem").filter({ hasText: "twenty names" });
  await naming.getByRole("button", { name: "File under Marketing & Sales" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Filed under Marketing & Sales" })).toBeVisible();

  // Choose a category by hand for the item the classifier failed on.
  const failed = page.getByRole("listitem").filter({ hasText: "meeting transcript" });
  await failed.getByRole("button", { name: "Choose a category" }).click();
  await failed.getByLabel("Category").selectOption("Productivity & Systems");
  await failed.getByRole("button", { name: "File under this category" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Filed under Productivity & Systems" })).toBeVisible();

  // Keep the near-duplicate pair separate; nothing is merged.
  const dup = page.getByRole("listitem").filter({ hasText: "literature review" }).filter({ has: page.getByRole("button", { name: "Keep separate" }) });
  await dup.getByRole("button", { name: "Keep separate" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Kept separate" })).toBeVisible();

  await expect(all).toContainText(`(${before - 3})`);

  await page.getByRole("link", { name: "Library" }).click();
  await page.getByLabel("Search prompts and ideas").fill(`${tag()} meeting transcript`);
  await page.getByRole("button", { name: "Search" }).click();
  const hit = page.getByRole("region", { name: "Results" }).getByRole("listitem").first();
  await expect(hit).toContainText("filed");
  await expect(hit).toContainText("Productivity & Systems");
});

for (const scheme of ["light", "dark"] as const) {
  test(`accessibility (${scheme}): sign-in, library with detail, review with editor`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(await audit(page), "sign-in").toEqual([]);

    await signIn(page);
    await page.getByRole("link", { name: "Library" }).click();
    await page.getByLabel("Search prompts and ideas").fill(tag());
    await page.getByRole("button", { name: "Search" }).click();
    const first = page.getByRole("region", { name: "Results" }).getByRole("listitem").first().getByRole("button");
    await first.click();
    await expect(page.getByRole("region", { name: "Record detail" }).getByRole("heading").first()).toBeVisible();
    expect(await audit(page), "library").toEqual([]);

    await page.getByRole("link", { name: "Review" }).click();
    await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
    const choose = page.getByRole("button", { name: /Choose a (different )?category/ }).first();
    if (await choose.count()) await choose.click();
    expect(await audit(page), "review").toEqual([]);
  });
}

test("the axe check is live: it flags a deliberately inaccessible page", async ({ page }) => {
  await page.setContent('<html lang="en"><head><title>x</title></head><body><main><img src="data:,"><button></button></main></body></html>');
  const found = await audit(page);
  expect(found.some((v) => v.startsWith("image-alt"))).toBe(true);
  expect(found.some((v) => v.startsWith("button-name"))).toBe(true);
});
