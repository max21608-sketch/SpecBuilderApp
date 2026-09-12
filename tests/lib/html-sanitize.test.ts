// Pure unit tests for the draft-body sanitizer -- no DB/network cost.
import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "@/lib/html-sanitize";

describe("sanitizeEmailHtml", () => {
  it("removes script elements including their content", () => {
    expect(sanitizeEmailHtml(`<p>hi</p><script>alert(1)</script><p>bye</p>`)).toBe("<p>hi</p><p>bye</p>");
  });

  it("removes iframes, style blocks, and stray unpaired dangerous tags", () => {
    expect(sanitizeEmailHtml(`<iframe src="https://x"></iframe><style>p{}</style>ok`)).toBe("ok");
    expect(sanitizeEmailHtml(`before<script src="x">after`)).toBe("beforeafter");
  });

  it("strips inline event handlers but keeps the element", () => {
    expect(sanitizeEmailHtml(`<p onclick="alert(1)" style="margin:0">x</p>`)).toBe(`<p style="margin:0">x</p>`);
  });

  it("strips javascript: and data: URLs but keeps normal ones", () => {
    expect(sanitizeEmailHtml(`<a href="javascript:alert(1)">x</a>`)).toBe("<a>x</a>");
    expect(sanitizeEmailHtml(`<a href=" JavaScript:alert(1)">x</a>`)).toBe("<a>x</a>");
    expect(sanitizeEmailHtml(`<img src="data:text/html,x">`)).toBe("<img>");
    expect(sanitizeEmailHtml(`<a href="https://example.com">x</a>`)).toBe(`<a href="https://example.com">x</a>`);
  });

  it("removes html comments", () => {
    expect(sanitizeEmailHtml(`a<!-- <script>alert(1)</script> -->b`)).toBe("ab");
  });

  it("preserves the address marker and a generated table verbatim", () => {
    const table = `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse"><tr><td style="border:1px solid #999999">13 m</td></tr></table>`;
    const address = `<div data-address-block="1" style="margin:0 0 1em">Ben Whistler Workshop<br>SE26 4PR</div>`;
    expect(sanitizeEmailHtml(table + address)).toBe(table + address);
  });
});
