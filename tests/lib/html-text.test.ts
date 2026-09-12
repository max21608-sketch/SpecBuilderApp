// Pure unit tests for the html -> plain text renderer (clipboard fallback).
import { describe, expect, it } from "vitest";
import { htmlToPlainText } from "@/lib/html-text";

describe("htmlToPlainText", () => {
  it("renders paragraphs and line breaks as newlines", () => {
    expect(htmlToPlainText("<p>Good afternoon,</p><p>I hope you are well.</p>")).toBe(
      "Good afternoon,\nI hope you are well.",
    );
    expect(htmlToPlainText("A<br>B<br/>C")).toBe("A\nB\nC");
  });

  it("renders a table as one line per row with ' | ' between cells", () => {
    const html =
      "<table><tr><th>Quantity</th><th>Product</th></tr><tr><td>13 m</td><td>Bullion Fringe</td></tr></table>";
    expect(htmlToPlainText(html)).toBe("Quantity | Product\n13 m | Bullion Fringe");
  });

  it("renders list items as bullets", () => {
    expect(htmlToPlainText("<ul><li>Item dimensions</li><li>Timber finish</li></ul>")).toBe(
      "• Item dimensions\n• Timber finish",
    );
  });

  it("decodes entities exactly once", () => {
    expect(htmlToPlainText("<p>Marks &amp; Spencer &lt;notes&gt;</p>")).toBe("Marks & Spencer <notes>");
    expect(htmlToPlainText("&amp;lt;")).toBe("&lt;");
  });

  it("drops script/style content entirely", () => {
    expect(htmlToPlainText("<p>keep</p><script>alert(1)</script>")).toBe("keep");
  });

  it("collapses runs of blank lines", () => {
    expect(htmlToPlainText("<p>a</p><div></div><div></div><p>b</p>")).toBe("a\n\nb");
  });
});
