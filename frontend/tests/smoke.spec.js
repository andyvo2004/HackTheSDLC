import { expect, test } from "@playwright/test";

test("admin sign in shell renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Admin Sign In" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("theme toggle persists selection for admin shell", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("qpp_token", "test-token");
    window.localStorage.setItem("qpp_theme", "light");
  });

  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Toggle dark mode" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toContainText("Dark mode");

  await toggle.click();
  await expect(toggle).toContainText("Light mode");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("unknown public payment page shows unavailable state", async ({ page }) => {
  await page.goto("/pay/does-not-exist");
  await expect(page.getByText("Payment page unavailable")).toBeVisible();
});
