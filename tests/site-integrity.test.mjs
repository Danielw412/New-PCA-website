import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetVersion = "20260830-past-events-v1";
const redirectPages = new Set([
  "teen-member-apply.html",
  "teen-member-dashboard.html",
  "teen-members.html",
]);
const htmlFiles = readdirSync(root).filter((name) => extname(name) === ".html");
const primaryHtmlFiles = htmlFiles.filter((name) => !redirectPages.has(name));

const read = (path) => readFileSync(join(root, path), "utf8");

test("every primary page keeps the shared accessible document shell", () => {
  for (const file of primaryHtmlFiles) {
    const html = read(file);
    assert.match(html, /<html\s+lang="en">/i, `${file}: missing language`);
    assert.match(html, /class="skip-link"[^>]+href="#main"/i, `${file}: missing skip link`);
    assert.match(html, /<main\s+id="main"/i, `${file}: missing main landmark`);
    assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i, `${file}: zoom is disabled`);
    assert.match(html, new RegExp(`styles\\.css\\?v=${assetVersion}`), `${file}: stale stylesheet version`);
    assert.match(html, new RegExp(`script\\.js\\?v=${assetVersion}`), `${file}: stale script version`);

    const ids = [...html.matchAll(/\sid="([^"]+)"/gi)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${file}: duplicate id`);
  }
});

test("local HTML links, scripts, stylesheets, and images resolve", () => {
  for (const file of htmlFiles) {
    const html = read(file);
    for (const match of html.matchAll(/\s(?:href|src)="([^"]+)"/gi)) {
      const rawTarget = match[1].trim();
      if (!rawTarget || /^(?:#|https?:|mailto:|tel:|data:|javascript:)/i.test(rawTarget)) continue;

      const relativeTarget = decodeURIComponent(rawTarget.split("#")[0].split("?")[0]);
      if (!relativeTarget) continue;
      assert.ok(existsSync(resolve(root, relativeTarget)), `${file}: missing local target ${relativeTarget}`);
    }
  }
});

test("external new-tab links prevent opener access", () => {
  for (const file of htmlFiles) {
    const html = read(file);
    for (const match of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)) {
      assert.match(match[0], /rel="[^"]*noopener[^"]*"/i, `${file}: unsafe target=_blank link`);
    }
  }
});

test("changed first-party assets share one cache version", () => {
  assert.match(read("script.js"), new RegExp(`ASSET_VERSION = "${assetVersion}"`));
  assert.doesNotMatch(read("assets/js/pca-platform.js"), /\?v=(?!20260830-past-events-v1)/);
  assert.match(read("assets/js/modules/blog.js"), new RegExp(`blog-seed\\.js\\?v=${assetVersion}`));

  for (const file of ["login.html", "profile.html", "reset-password.html"]) {
    assert.match(read(file), new RegExp(`pca-auth-captcha\\.js\\?v=${assetVersion}`), `${file}: stale captcha version`);
  }
});

test("obsolete template pages and time-sensitive calls to action stay removed", () => {
  for (const file of ["elements.html", "generic.html", "index2.html"]) {
    assert.equal(existsSync(join(root, file)), false, `${file} should not be published`);
  }

  const publicCopy = primaryHtmlFiles.map(read).join("\n");
  assert.doesNotMatch(publicCopy, /Lorem Ipsum|Massively by HTML5 UP|2024-2025 Student Council Application/i);
  assert.doesNotMatch(publicCopy, /Application Deadline:\s*(?:July|August)\s+\d{1,2},\s*2024/i);
  assert.doesNotMatch(publicCopy, /Ongoing Book Drive/i);
});
