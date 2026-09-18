import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // The four sizes the mock-ups use that Tailwind's scale has no name for.
      // They exist so a PRIMITIVE can name its size once and every screen
      // inherits it — `text-[11px] uppercase tracking-wider` was written out by
      // hand at more than thirty sites, and three of them had drifted to 11.5,
      // 12 and `tracking-wide`.
      //
      // `sm` and `xs` are deliberately NOT redefined. Hundreds of existing
      // class names read them, and moving a stock scale step under them would
      // re-size the whole app in a commit whose diff mentions two files.
      fontSize: {
        /** State pills: uppercase, tracked, small enough to sit inside a row. */
        "2xs": ["10.5px", { lineHeight: "1rem", letterSpacing: "0.04em" }],
        /** Table headers, card headings, tile labels — the uppercase register. */
        th: ["11px", { lineHeight: "1rem", letterSpacing: "0.05em" }],
        /** Table body. A shade under the body size, because a dense table of
         *  14px reads as a wall and the same table at 13px reads as data. */
        cell: ["13px", "1.25rem"],
        /** The one h1 on a page, in the header band. */
        h1: ["20px", "1.3"],
      },
    },
  },
  plugins: [],
};

export default config;
