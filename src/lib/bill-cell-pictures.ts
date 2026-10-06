// The pictures Excel PLACES IN A CELL, read off the workbook's own parts —
// the half of a bill's pictures `exceljs` cannot see. `bill-images.ts` applies
// the rules (one picture per row, dedupe by bytes, two different → none, png /
// jpeg / gif only); this file only says which bytes sit in which row.
//
// ============================================================================
// FOUND 2026-10-06, on Matthew's new bills. `getImages()` reads FLOATING
// pictures — anchors in `xl/drawings/drawingN.xml`. Excel's "Place in Cell" is
// not an anchor: the cell itself holds the picture and reads `#VALUE!` to every
// older reader, `exceljs` and `read-excel-file` included. Measured on the real
// copies: the Butler Arms bedrooms bill carries 14 in-cell pictures beside 3
// floating ones, so 2 of its rows had a picture and the rest showed none; the
// Annabel's NY bill carries one in-cell picture and no floating one.
//
// HOW ONE IS STORED, and every hop is a place to be wrong:
//
//   sheetN.xml     <c r="F8" t="e" vm="1">          vm is 1-BASED
//   metadata.xml   valueMetadata/bk[vm-1]/rc t v    t is a 1-BASED metadataType;
//                                                   only XLRICHVALUE is a rich value
//                  futureMetadata[name]/bk[v]//rvb i   → the rich value, 0-based
//   rdrichvalue    rv[i] s=…, its <v>s one per key  → which <v> is the picture
//   rdrichvaluestructure  s[s]/k n="_rvRel:LocalImageIdentifier"   is decided by
//                                                   the KEY, never by position
//   richValueRel   rel[n] r:id                      → its own .rels → the media
//
// Every part is found through a relationship (`_rels/.rels` → workbook →
// its rels, a sheet name → its part), never by assuming a path or an order.
//
// THE RULES, EACH A TRAP
//
// - A MALFORMED OR UNEXPECTED PART YIELDS NOTHING FOR THE SHEET, with a reason
//   the caller turns into a sentence. Never a throw and never a failed bill: a
//   picture is an aid to recognising an item; the bill is the data. A picture
//   half-read off a part we do not understand could be the wrong item's.
// - A rich value that is NOT a local picture (a data type, a picture by web
//   address) is not a picture here, and not an error.
// - Parsed without a dependency: the parts are small and regular, and the
//   parser below refuses what it does not understand (a DOCTYPE, a mismatched
//   tag) rather than guessing.
// ============================================================================
import JSZip from "jszip";

/** The bytes in one cell, before `bill-images.ts` applies its rules. */
export type CellPictureSource = { row: number; extension: string; bytes: Uint8Array };

/** One sheet's in-cell pictures, or why none could be read. */
export type SheetCellPictures = { pictures: CellPictureSource[] } | { error: string };

// ---- a small, strict XML reader --------------------------------------------

type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    const named = ENTITIES[body];
    if (named === undefined) throw new Error(`an unknown entity ${whole}`);
    return named;
  });
}

/** The name after any namespace prefix: `xlrd:rvb` is `rvb`, `r:id` is `id`. */
function local(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

const ATTRIBUTE = /\s+([^\s=/>]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;

/** Parse a whole part into its root element. Throws on anything not well formed. */
export function parseXml(xml: string): XmlNode {
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let at = 0;
  while (at < xml.length) {
    const open = xml.indexOf("<", at);
    const textEnd = open === -1 ? xml.length : open;
    if (textEnd > at) {
      const text = xml.slice(at, textEnd);
      const top = stack[stack.length - 1];
      if (top) top.text += decode(text);
      else if (text.trim() !== "") throw new Error("text outside the root element");
    }
    if (open === -1) break;
    if (xml.startsWith("<?", open)) {
      const end = xml.indexOf("?>", open);
      if (end === -1) throw new Error("an unterminated declaration");
      at = end + 2;
    } else if (xml.startsWith("<!--", open)) {
      const end = xml.indexOf("-->", open);
      if (end === -1) throw new Error("an unterminated comment");
      at = end + 3;
    } else if (xml.startsWith("<![CDATA[", open)) {
      const end = xml.indexOf("]]>", open);
      const top = stack[stack.length - 1];
      if (end === -1 || !top) throw new Error("a misplaced CDATA section");
      top.text += xml.slice(open + 9, end);
      at = end + 3;
    } else if (xml.startsWith("<!", open)) {
      throw new Error("a document type declaration");
    } else if (xml.startsWith("</", open)) {
      const end = xml.indexOf(">", open);
      if (end === -1) throw new Error("an unterminated closing tag");
      const name = xml.slice(open + 2, end).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`a closing </${name}> that matches nothing`);
      at = end + 1;
    } else {
      const nameMatch = /^<([^\s/>]+)/.exec(xml.slice(open, open + 256));
      if (!nameMatch?.[1]) throw new Error("a tag with no name");
      const node: XmlNode = { name: nameMatch[1], attrs: {}, children: [], text: "" };
      let cursor = open + nameMatch[0].length;
      for (;;) {
        ATTRIBUTE.lastIndex = cursor;
        const attribute = ATTRIBUTE.exec(xml);
        if (!attribute?.[1]) break;
        node.attrs[attribute[1]] = decode(attribute[2] ?? attribute[3] ?? "");
        cursor = ATTRIBUTE.lastIndex;
      }
      const close = /^\s*(\/?)>/.exec(xml.slice(cursor, cursor + 64));
      if (!close) throw new Error(`a malformed <${node.name}> tag`);
      at = cursor + close[0].length;
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
      else if (root) throw new Error("a second root element");
      else root = node;
      if (close[1] !== "/") stack.push(node);
    }
  }
  if (stack.length > 0) throw new Error(`an unclosed <${stack[stack.length - 1]?.name}>`);
  if (!root) throw new Error("no root element");
  return root;
}

function kids(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => local(child.name) === name);
}

function kid(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((child) => local(child.name) === name);
}

function attr(node: XmlNode, name: string): string | undefined {
  for (const [key, value] of Object.entries(node.attrs)) if (local(key) === name) return value;
  return undefined;
}

function descendant(node: XmlNode, name: string): XmlNode | undefined {
  for (const child of node.children) {
    if (local(child.name) === name) return child;
    const deeper = descendant(child, name);
    if (deeper) return deeper;
  }
  return undefined;
}

/** A whole non-negative integer, or a throw naming what it was. */
function index(value: string | undefined, what: string): number {
  if (value === undefined || !/^\s*\d+\s*$/.test(value)) throw new Error(`${what} is not a number`);
  return Number(value);
}

// ---- parts and relationships -------------------------------------------------

type Relationship = { type: string; target: string; external: boolean };

/** Resolve a relationship target against the part that declares it. */
function resolvePart(source: string, target: string): string {
  const parts = target.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const piece of target.replace(/^\/+/, "").split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== "." && piece !== "") parts.push(piece);
  }
  return parts.join("/");
}

function relsPathOf(part: string): string {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

async function partText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`the part ${path} is missing`);
  return file.async("string");
}

async function relationshipsOf(zip: JSZip, part: string): Promise<Map<string, Relationship>> {
  const rels = new Map<string, Relationship>();
  const path = relsPathOf(part);
  if (!zip.file(path)) return rels;
  for (const rel of kids(parseXml(await partText(zip, path)), "Relationship")) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    if (!id || target === undefined) throw new Error(`a relationship in ${path} has no id or target`);
    rels.set(id, { type: attr(rel, "Type") ?? "", target, external: attr(rel, "TargetMode") === "External" });
  }
  return rels;
}

/** The part a relationship of this kind points at — the last word of its Type, matched exactly. */
function partOfType(rels: Map<string, Relationship>, source: string, kind: string): string | null {
  for (const rel of rels.values()) {
    if (!rel.external && rel.type.split("/").pop() === kind) return resolvePart(source, rel.target);
  }
  return null;
}

// ---- the chain from a cell's vm to its bytes ---------------------------------

const LOCAL_IMAGE_KEY = "_rvRel:LocalImageIdentifier";

type CellResolver = (vm: number) => Promise<{ extension: string; bytes: Uint8Array } | null>;

async function cellResolver(zip: JSZip, workbookPart: string, workbookRels: Map<string, Relationship>): Promise<CellResolver> {
  const metadataPart = partOfType(workbookRels, workbookPart, "sheetMetadata");
  if (!metadataPart) throw new Error("the workbook has no cell metadata part");
  const metadata = parseXml(await partText(zip, metadataPart));
  const typeNames = kids(kid(metadata, "metadataTypes") ?? metadata, "metadataType").map((type) => attr(type, "name") ?? "");
  const future = new Map<string, XmlNode[]>();
  for (const block of kids(metadata, "futureMetadata")) future.set(attr(block, "name") ?? "", kids(block, "bk"));
  const valueMetadata = kid(metadata, "valueMetadata");
  const valueBlocks = valueMetadata ? kids(valueMetadata, "bk") : [];

  // The rich-value parts are read only when a cell needs one: a workbook whose
  // cells hold only data types carries no picture relationships at all.
  let richValues: Promise<{
    values: XmlNode[];
    structures: XmlNode[];
    relIds: string[];
    relsPart: string;
    rels: Map<string, Relationship>;
  }> | null = null;
  const loadRichValues = () =>
    (richValues ??= (async () => {
      const valuePart = partOfType(workbookRels, workbookPart, "rdRichValue");
      const structurePart = partOfType(workbookRels, workbookPart, "rdRichValueStructure");
      const relPart = partOfType(workbookRels, workbookPart, "richValueRel");
      if (!valuePart || !structurePart) throw new Error("the workbook's rich values are missing");
      if (!relPart) throw new Error("the workbook's picture relationships are missing");
      const relList = parseXml(await partText(zip, relPart));
      return {
        values: kids(parseXml(await partText(zip, valuePart)), "rv"),
        structures: kids(parseXml(await partText(zip, structurePart)), "s"),
        relIds: kids(relList, "rel").map((rel) => attr(rel, "id") ?? ""),
        relsPart: relPart,
        rels: await relationshipsOf(zip, relPart),
      };
    })());

  return async (vm) => {
    if (!Number.isInteger(vm) || vm < 1) throw new Error(`a cell's metadata index ${vm} is not 1-based`);
    const block = valueBlocks[vm - 1];
    if (!block) throw new Error(`a cell names metadata ${vm}, which the workbook does not hold`);
    const record = kid(block, "rc");
    if (!record) throw new Error(`metadata ${vm} names no record`);
    const typeName = typeNames[index(attr(record, "t"), "a metadata type") - 1];
    if (typeName === undefined) throw new Error(`metadata ${vm} names a type the workbook does not declare`);
    if (typeName !== "XLRICHVALUE") return null;
    const futureBlock = future.get("XLRICHVALUE")?.[index(attr(record, "v"), "a metadata value")];
    if (!futureBlock) throw new Error(`metadata ${vm} points past the rich value list`);
    const pointer = descendant(futureBlock, "rvb");
    if (!pointer) throw new Error(`metadata ${vm} names no rich value`);

    const rich = await loadRichValues();
    const value = rich.values[index(attr(pointer, "i"), "a rich value index")];
    if (!value) throw new Error(`metadata ${vm} names a rich value the workbook does not hold`);
    const structure = rich.structures[index(attr(value, "s"), "a rich value structure")];
    if (!structure) throw new Error("a rich value names a structure the workbook does not hold");
    const key = kids(structure, "k").findIndex((k) => attr(k, "n") === LOCAL_IMAGE_KEY);
    if (key === -1) return null; // a data type or a picture by web address: not a picture in the file
    const relIndex = index(kids(value, "v")[key]?.text, "a picture's relationship index");
    const relId = rich.relIds[relIndex];
    if (!relId) throw new Error(`a picture names relationship ${relIndex}, which the workbook does not hold`);
    const rel = rich.rels.get(relId);
    if (!rel) throw new Error(`the picture relationship ${relId} has no target`);
    if (rel.external) return null;
    const mediaPath = resolvePart(rich.relsPart, rel.target);
    const media = zip.file(mediaPath);
    if (!media) throw new Error(`the picture ${mediaPath} is missing`);
    const extension = (mediaPath.split(".").pop() ?? "").toLowerCase();
    return { extension, bytes: await media.async("uint8array") };
  };
}

const CELL = /<(?:[A-Za-z_][\w.-]*:)?(row|c)\b([^>]*)>/g;

/** The cells of one sheet that carry a value-metadata index, with their 1-based rows. */
function cellsWithMetadata(sheetXml: string): { row: number; vm: number }[] {
  const out: { row: number; vm: number }[] = [];
  let row: number | null = null;
  for (const match of sheetXml.matchAll(CELL)) {
    const attrs = match[2] ?? "";
    const reference = /\sr="([^"]*)"/.exec(attrs)?.[1];
    if (match[1] === "row") {
      row = reference && /^\d+$/.test(reference) ? Number(reference) : null;
      continue;
    }
    const vm = /\svm="([^"]*)"/.exec(attrs)?.[1];
    if (vm === undefined) continue;
    const cellRow = reference ? /^[A-Za-z]+(\d+)$/.exec(reference)?.[1] : undefined;
    const at = cellRow ? Number(cellRow) : row;
    if (!at) throw new Error("a cell holding a picture has no row");
    out.push({ row: at, vm: index(vm, "a cell's metadata index") });
  }
  return out;
}

/**
 * Every in-cell picture, by sheet name. A sheet with none is absent; a sheet
 * whose pictures could not be resolved carries the reason instead.
 * `workbookError` is set where the sheets themselves could not be named and a
 * sheet part does hold an in-cell picture. Never throws.
 */
export async function readCellPictures(
  workbookBytes: Buffer,
): Promise<{ bySheet: Map<string, SheetCellPictures>; workbookError: string | null }> {
  const bySheet = new Map<string, SheetCellPictures>();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(workbookBytes);
  } catch {
    // `bill-images.ts` has already said the workbook could not be read.
    return { bySheet, workbookError: null };
  }

  let workbookPart: string;
  let workbookRels: Map<string, Relationship>;
  let sheets: { name: string; part: string }[];
  try {
    workbookPart = partOfType(await relationshipsOf(zip, ""), "", "officeDocument") ?? "";
    if (!workbookPart) throw new Error("the package names no workbook");
    workbookRels = await relationshipsOf(zip, workbookPart);
    const workbook = parseXml(await partText(zip, workbookPart));
    sheets = [];
    for (const sheet of kids(kid(workbook, "sheets") ?? workbook, "sheet")) {
      const rel = workbookRels.get(attr(sheet, "id") ?? "");
      // A sheet with no part of its own (a chart sheet's is not a worksheet) holds no cells.
      if (rel && !rel.external) sheets.push({ name: attr(sheet, "name") ?? "", part: resolvePart(workbookPart, rel.target) });
    }
  } catch (cause) {
    // The sheets cannot be named. Say so only where a sheet part holds an
    // in-cell picture, or every bill with a quirk here would carry a sentence.
    for (const path of Object.keys(zip.files).filter((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name))) {
      if (/\svm="/.test(await partText(zip, path))) {
        return { bySheet, workbookError: cause instanceof Error ? cause.message : String(cause) };
      }
    }
    return { bySheet, workbookError: null };
  }

  let resolver: Promise<CellResolver> | null = null;
  for (const sheet of sheets) {
    try {
      const cells = cellsWithMetadata(await partText(zip, sheet.part));
      if (cells.length === 0) continue;
      resolver ??= cellResolver(zip, workbookPart, workbookRels);
      const resolve = await resolver;
      const pictures: CellPictureSource[] = [];
      for (const cell of cells) {
        const picture = await resolve(cell.vm);
        if (picture) pictures.push({ row: cell.row, ...picture });
      }
      if (pictures.length > 0) bySheet.set(sheet.name, { pictures });
    } catch (cause) {
      bySheet.set(sheet.name, { error: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { bySheet, workbookError: null };
}
