// What kind of document is this? — asked of the model, answered to a screen.
//
// ============================================================================
// NOTHING IS WRITTEN AND NOTHING IS STAGED HERE.
//
// This route creates no `intake_runs` row, opens no attempt and stages no
// proposals. It answers one question for the upload screen, which fills the
// dropdown in and flags it. The kind still arrives at `/api/imports` DECLARED,
// by a person's press — the `level_suggested` rule again: the app guesses and
// shows its evidence, a human's action is what files it.
//
// IT DOES SPEND MONEY, one small call per document, on the fast model rather
// than the extraction one. The upload screen says so before anything uploads.
//
// THE LOOK IS THE SURVEY, AND IT ANSWERS IN PARTS (open intake, 2026-11-20).
// A file is no longer one kind: `surveyFile` says what is where, and a file
// with two or more parts to read is answered per part (`parts[]`). A file
// with ONE part — every pack before that day — is answered in exactly the
// shape and by exactly the rules the file check's answer was, which is the
// line not to cross: a change that made a single-kind file answer differently
// would change every pack. A scan and an `.eml` keep the old look.
//
// THE BLOB IS ADDRESSED BY PATHNAME, NEVER BY URL, and the pathname is checked
// against the project's own prefix before a byte is read — `blob-source.ts`,
// unchanged. A classification is a hint on a screen, but the READ that produces
// it is a store credential fetching a file, and that is the thing M1 got wrong.
// ============================================================================
import { z } from "zod";
import { json } from "@/lib/db";
import { sql } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { intakeSourceKind, legacySpreadsheetAdvice } from "@/lib/intake-source-types";
import { readTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";
import { countPdfPages, prepareDocumentSource, pdfHasTextLayer } from "@/lib/intake-source";
import {
  classifyDocument,
  KIND_FROM_GENRE,
  SCANNED_PDF,
  scannedPdfRefusal,
  type ClassifyResult,
} from "@/lib/document-classify";
import { partReader, surveyFile, SURVEY_MODEL } from "@/lib/pack-survey";
import type { PartPlace, SurveyPart } from "@/lib/pack-survey-types";
import { parseBoqSheets } from "@/lib/boq-import";
import { billProbeEvidence, billProbeHeld, isProbedForBill, probeOfPdfBill, probeOfSheets, settleBillTabs, type BillProbe } from "@/lib/bill-probe";
import { partOfPlace, type ClassifiedPart, type PdfBillNote } from "@/lib/upload-reads";
import { partPageCount } from "@/lib/source-part";
import type { ClassifyFailureCode } from "@/lib/classify-failure";
import { guessKindFromName, nameModelDisagreement } from "@/lib/document-name-guess";
import { MAX_MODEL_PDF_BYTES, MAX_MODEL_PDF_PAGES } from "@/lib/upload-limits";
import { pdfBillRefusal, readPdfBill } from "@/lib/pdf-bill";
import { isTranscribable, transcriptionReason, type TranscribableReason } from "@/lib/pdf-bill-checks";

/** What the upload row says of a PDF bill the model will transcribe. */
function transcribeNote(code: TranscribableReason, pages: number | null): PdfBillNote & { transcribe: true; reason: string } {
  return { lines: 0, pages: pages ?? 0, transcribe: true, reason: transcriptionReason(code) };
}
import { loadBoqReadingRegisters } from "@/lib/boq-stage";
import { requireWriter } from "@/lib/route-guards";
import { explainFailure, reportFailure } from "@/lib/error-detail";

// 300, not 60: a long PDF has to be taken in whole, up to 600 pages, before
// the one answer comes back (`classifyDeadlineFor`, `LONG_PDF_PAGES`).
// `LARGE_CLASSIFY_DEADLINE_MS` (270 s) sits under this, so
// the route answers a slow look in words rather than Vercel answering it with
// an HTML 504 the screen can only call "took too long".
export const maxDuration = 300;

/**
 * The bill reader works without the saved headings, so a failure to load them
 * degrades the look rather than failing it — and is logged, because a bill
 * whose columns went unread for that reason is otherwise a mystery.
 */
function registersUnread(cause: unknown): null {
  reportFailure("loading the bill-reading registers for a look", cause);
  return null;
}

type Registers = Awaited<ReturnType<typeof loadBoqReadingRegisters>>;

/**
 * The HTTP status a failed look answers with. The body is what the screen
 * reads — `ok: false`, the code, the sentence and `charged` — and the status is
 * there so a log line says the same thing the row does.
 */
const FAILURE_STATUS: Record<ClassifyFailureCode, number> = {
  not_configured: 503,
  too_large: 413,
  rate_limited: 429,
  overloaded: 503,
  timeout: 504,
  auth: 502,
  failed: 502,
};

/**
 * Genres whose PDF is never a bill printed from a spreadsheet, so their text is
 * not read as one: a drawing, a spec sheet, prose, a message. Everything else
 * — a schedule of any kind, `unclear`, `other` — is, where the model did not
 * already call it a bill.
 */
const NOT_A_BILL: ReadonlySet<string> = new Set(["shop_drawings", "specification_sheets", "preamble", "email"]);

/** What the model called it, in the held sentence. `unclear` names nothing. */
const GENRE_WORDS: Readonly<Record<string, string>> = {
  ffe_schedule: "an FF&E schedule",
  finishes_schedule: "a finishes schedule",
  fabric_schedule: "a fabric schedule",
  specification_bible: "a specification bible",
};

// The extraction ceiling (upload-limits.ts): a document larger than that
// cannot be read at all, so there is nothing to classify it FOR — and one
// copy of the number is what keeps this route and the upload screen agreeing.
const MAX_BYTES = MAX_MODEL_PDF_BYTES;

const Body = z
  .object({
    projectId: z.string().uuid(),
    pathname: z.string().trim().min(1).max(1024),
    filename: z.string().trim().min(1).max(400),
    contentType: z.string().trim().max(200).optional().default(""),
    /**
     * The page count the BROWSER read with pdfjs, where it could. Used only
     * when the server's own count (`countPdfPages`) cannot read the page tree,
     * which is most compressed PDFs, and it decides one thing: which model
     * looks. It is not a trust decision — the worst a wrong hint does is send a
     * short document to the dearer model, or a long one to the fast model,
     * which then refuses it in words.
     */
    pages: z.number().int().positive().max(100_000).nullable().optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const denied = requireWriter(user);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: issue?.message ?? "That request is not valid." }, 400);
  }
  const input = parsed.data;

  const project = await sql`select id from projects where id = ${input.projectId}`;
  if (!project[0]) return json({ ok: false, error: "No such project." }, 404);

  const kind = intakeSourceKind(input.filename, input.contentType);
  if (kind === "unsupported") {
    // An `.xls` reaches this route before it reaches registration, so the way
    // out has to be here too — otherwise a pack containing one is refused
    // twice and told how to fix it neither time.
    return json(
      { ok: false, error: legacySpreadsheetAdvice(input.filename) ?? `“${input.filename}” is not a supported document.` },
      400,
    );
  }
  // AN .eml NEEDS NO MODEL CALL. A saved email is unambiguously an email, and
  // paying to be told so would be the filename hint with a bill attached.
  if (kind === "eml") {
    return json(
      {
        ok: true,
        genre: "email",
        decision: KIND_FROM_GENRE.email,
        unsupported: null,
        titleText: null,
        evidence: "a saved email file",
        certain: true,
        charged: false,
      },
      200,
    );
  }

  let blob;
  try {
    blob = await readTrustedBlob(input.pathname, input.projectId, { maxBytes: MAX_BYTES });
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 400);
    throw cause;
  }

  let source;
  try {
    source = await prepareDocumentSource(blob.bytes, input.filename, blob.contentType || input.contentType);
  } catch (cause) {
    return json({ ok: false, error: explainFailure("This file could not be opened to look at.", cause, "classify-source") }, 400);
  }

  // A SCANNED PDF COSTS NOTHING TO REFUSE AND FOUR MINUTES TO READ (§6.10.b).
  //
  // Before the call, not after it: the model would look at pictures of pages
  // for the whole deadline and come back with nothing to review, and the charge
  // would be for being told what one pass over the bytes already says. Only a
  // CERTAIN reading refuses — `pdfHasTextLayer` returns null for a stream it
  // cannot decode and null proceeds, because the naive test calls every
  // compressed PDF scanned and would refuse the whole pilot pack. Nothing is
  // registered either way: this route has never created a run.
  // SINCE C2 (2026-10-15) A SCAN IS LOOKED AT, NOT REFUSED UNSEEN: a scanned
  // BILL is transcribed by the model, the one exception Max approved in
  // writing. So the small look happens, and only what it calls a bill,
  // certain, goes on; anything else is still refused with the same sentence,
  // now after one small charged look rather than none.
  const scanned = scannedPdfRefusal(source.type, source.type === "pdf" ? pdfHasTextLayer(blob.bytes) : null);

  const pages =
    source.type === "pdf" ? (countPdfPages(blob.bytes) ?? input.pages ?? null) : null;
  const lookPages = pages !== null && pages <= MAX_MODEL_PDF_PAGES ? pages : null;

  // THE SAVED HEADINGS AND LAYOUTS, loaded at most once a request and only
  // where a bill is actually tried. Per request, never per module: a layout a
  // person saves a minute ago must read the next file.
  let registersLoad: Promise<Registers | null> | null = null;
  const registers = () => (registersLoad ??= loadBoqReadingRegisters(sql).catch(registersUnread));
  /** The saved headings the PDF-bill reader uses, or none where they could not be loaded. */
  const billReadingOptions = async (): Promise<NonNullable<Parameters<typeof readPdfBill>[1]>> => {
    const loaded = await registers();
    return loaded ? { aliases: loaded.aliases } : {};
  };

  /**
   * What the bill reader makes of one part, for nothing: a PDF part through
   * `readPdfBill` on its own pages, a sheet through `parseBoqSheets` with the
   * saved headings and layouts — the readers registration would use.
   */
  const probeBill = async (part: SurveyPart): Promise<{ probe: BillProbe | null; pdfBill: PdfBillNote | null }> => {
    const loaded = await registers();
    const sourcePart = partOfPlace(part.place);
    if (source.type === "pdf") {
      const read = await readPdfBill(blob.bytes, { ...(await billReadingOptions()), part: sourcePart });
      const probe = probeOfPdfBill(read, loaded?.aliases);
      return { probe, pdfBill: read.ok ? { lines: read.rows.length, pages: (sourcePart && partPageCount(sourcePart)) ?? read.pageCount } : null };
    }
    if (source.type === "spreadsheet" && source.sheets) {
      return { probe: probeOfSheets(parseBoqSheets(source.sheets, loaded ?? {}, { part: sourcePart })), pdfBill: null };
    }
    return { probe: null, pdfBill: null };
  };

  /**
   * A mixed file, answered per part. The same rules a single file gets where
   * they are about a PART — a bill PDF's text read on its own pages, a bill or
   * schedule tried by the bill reader — and none about the FILE: no name rule.
   */
  const classifyParts = async (parts: SurveyPart[]): Promise<ClassifiedPart[]> => {
    const answered: ClassifiedPart[] = [];
    const namedSheets = new Map<string, number>();
    for (const part of parts) {
      if (part.place.kind === "sheet") namedSheets.set(part.place.sheet, (namedSheets.get(part.place.sheet) ?? 0) + 1);
    }
    // One at a time: each read is in-process work on bytes already in hand,
    // and a mixed PDF of several bills would otherwise parse it N times at once.
    for (const part of parts) {
      const nothingToRead = Boolean(part.nothingToRead);
      const answer: ClassifiedPart = {
        place: part.place,
        genre: part.genre,
        decision: partReader(part),
        certain: part.certain,
        evidence: part.evidence,
        held: null,
        suggestion: null,
        unsupported: null,
        unsupportedDetail: null,
        itemCodes: part.itemCodes,
        finishCodes: part.finishCodes,
        pdfBill: null,
        nothingToRead,
      };
      answered.push(answer);
      if (nothingToRead) continue;
      if (part.place.kind === "sheet" && (namedSheets.get(part.place.sheet) ?? 0) > 1) {
        // A SHEET IS THE SMALLEST PART OF A WORKBOOK A READ TAKES. Two kinds
        // on one sheet are said, not split: a person chooses one for the
        // sheet, or leaves this part out. Decided by two parts naming the
        // sheet, never by a part carrying rows — the survey keeps a range
        // only there (`pack-survey.ts`), and a range on a sheet nobody else
        // names said nothing but "the whole sheet" (the walk, 2026-11-21).
        answer.decision = null;
        answer.held = SHEET_HOLDS_TWO_KINDS;
        continue;
      }
      if (isProbedForBill(part)) {
        const tried = await probeBill(part);
        const found = billProbeEvidence(tried.probe);
        if (found) {
          answer.held = billProbeHeld(part);
          answer.suggestion = KIND_FROM_GENRE.bill_of_quantities;
          answer.pdfBill = tried.pdfBill;
          answer.evidence = [found, part.evidence].filter(Boolean).join(" ");
        }
        continue;
      }
      if (source.type === "pdf" && answer.decision?.importType !== "boq" && !NOT_A_BILL.has(part.genre)) {
        // C1, PER PART: one rule for files and parts. A part the survey
        // called some schedule (or could not place) whose text is a bill's
        // table is HELD with the single file's own sentence — and, a part
        // having a box of its own, the bill suggested in it, one click away.
        const read = await readPdfBill(blob.bytes, { ...(await billReadingOptions()), part: partOfPlace(part.place) });
        if (read.ok) {
          answer.decision = null;
          answer.held = tableHeld(part.genre, read.rows.length);
          answer.suggestion = KIND_FROM_GENRE.bill_of_quantities;
          const own = partOfPlace(part.place);
          answer.pdfBill = { lines: read.rows.length, pages: (own && partPageCount(own)) ?? read.pageCount };
        }
        continue;
      }
      if (answer.decision?.importType === "boq" && source.type === "pdf") {
        const sourcePart = partOfPlace(part.place);
        const read = await readPdfBill(blob.bytes, { ...(await billReadingOptions()), part: sourcePart });
        const partPages = (sourcePart && partPageCount(sourcePart)) ?? countPdfPages(blob.bytes);
        if (read.ok) answer.pdfBill = { lines: read.rows.length, pages: partPages ?? read.pageCount };
        else if (isTranscribable(read.code)) answer.pdfBill = transcribeNote(read.code, partPages);
        else {
          answer.decision = null;
          answer.unsupported = pdfBillRefusal(read.code);
          answer.unsupportedDetail = read.detail;
        }
      }
    }
    return answered;
  };

  // ============================================================================
  // A SCAN IS LOOKED AT BY THE FILE CHECK, AS IT ALWAYS WAS.
  //
  // The survey answers in parts and a part is read from text; a scan has none,
  // and the one thing a scan may be filed as — a bill, to be transcribed — is
  // a whole-file decision C2 already makes. So a scan keeps today's look and
  // today's answers, unchanged, and only a file with text is surveyed.
  // ============================================================================
  if (scanned) return scannedAnswer(await classifyDocument(source, { pages: lookPages }), countPdfPages(blob.bytes));

  const surveyed = await surveyFile(source, { filename: input.filename, pageCount: lookPages });

  // ============================================================================
  // THE MODEL ANSWERING "UNCLEAR" AND THE CALL FAILING ARE DIFFERENT ANSWERS.
  //
  // This used to answer `200 ok:true, genre: "unclear"` for both, with the
  // failure's reason in a field the upload screen never read. On pilot
  // (2026-09-23) that turned a deployment with no API key into thirty rows
  // reading "Say which", two empty packs, and a footer saying nothing had been
  // charged — the one failure mode that reads as "the app looked and could not
  // tell", which sends a person hunting the wrong cause.
  //
  // So a failed look is `ok: false` with a stable code, the sentence, and
  // whether it was charged. The row prints it red with "Try identifying
  // again"; the file is stored either way, and a person can still choose the
  // kind by hand, which is where this app was before any of this existed.
  // ============================================================================
  if (!surveyed.ok) return failureAnswer(surveyed);

  // ============================================================================
  // ONE PART TO READ, OR SEVERAL.
  //
  // A part with nothing to read (a cover, an index) is set aside first. ONE
  // part left is a single-kind file, which is every pack before this build:
  // the part is put in the shape the file check gave, and every rule below
  // runs on it exactly as it ran on that — the name disagreement, the PDF
  // bill, a schedule whose text is a bill's table — so its answer cannot
  // drift. TWO OR MORE is a mixed file, answered per part, and the name rule
  // does not apply: a filename cannot describe a mix.
  // ============================================================================
  // ONE TAB OF A BILL IS NOT HELD FOR ITS DOUBT beside a certain bill tab
  // (`settleBillTabs`): the Panther bill's VE tab, "uncertain only because it
  // is a variant", held the whole workbook on every upload. Settled before
  // anything below reads the parts, so a workbook whose every sheet is then
  // the bill is the single whole-file bill it always was.
  const surveyParts = source.type === "spreadsheet" ? settleBillTabs(surveyed.survey.parts) : surveyed.survey.parts;
  // THE MODEL'S OWN NOTE, AND ONLY THAT, goes to the row. Code's bookkeeping
  // — "merged from 11 parts", "Pages 25–30 are in no part" — is in
  // `survey.note` for the eval; on a screen it is developer voice, and an
  // uncovered page already has its own held row saying so.
  const note = surveyed.survey.modelNote?.trim() || null;
  const gaps = surveyed.survey.gaps ?? { dropped: 0, uncovered: [], doubled: false };
  const readable = surveyParts.filter((part) => !part.nothingToRead);
  // NEVER ONE WHOLE READ WHEN PART OF THE ANSWER WAS SET ASIDE. A part the
  // survey gave and code dropped, pages or a sheet no part covers, pages two
  // parts claim: each means the parts left are not the whole file, and
  // collapsing them into one read would read the rest — a bill, say — as
  // whatever the parts left happen to be, with no press. Answered per part,
  // with what no part covers as parts of its own, held, so a person sees it.
  const incomplete = gaps.dropped > 0 || gaps.uncovered.length > 0 || gaps.doubled;
  const fallback = surveyParts.length === 1 && surveyParts[0]!.place.kind === "whole";
  const whole = incomplete ? null : wholeFileRead(readable);
  if (!fallback && !whole && (readable.length >= 2 || incomplete)) {
    const answered = [...(await classifyParts(surveyParts)), ...gaps.uncovered.map(uncoveredPart)];
    const sheetOrder = (sheet: string) => {
      const at = source.type === "spreadsheet" ? (source.sheets?.findIndex((candidate) => candidate.sheet === sheet) ?? -1) : -1;
      return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    answered.sort((a, b) => {
      if (a.place.kind === "pages" && b.place.kind === "pages") return a.place.from - b.place.from;
      if (a.place.kind === "sheet" && b.place.kind === "sheet") return sheetOrder(a.place.sheet) - sheetOrder(b.place.sheet);
      return 0;
    });
    return json({ ok: true, parts: answered, note, charged: true }, 200);
  }
  const sole = whole ?? readable[0] ?? null;
  const result = soleResult(sole, surveyParts);

  // BILL OR SCHEDULE GOES TO CODE (`bill-probe.ts`). Held either way; where
  // the cells read as a bill's, the box says Bill and the evidence says why.
  if (sole && isProbedForBill(sole)) {
    const tried = await probeBill(sole);
    const found = billProbeEvidence(tried.probe);
    if (found) {
      return json(
        {
          ok: true,
          // The survey's own note on the file, shown on its row.
          note,
          genre: result.genre,
          decision: null,
          unsupported: null,
          held: billProbeHeld(sole),
          suggestion: KIND_FROM_GENRE.bill_of_quantities,
          pdfBill: tried.pdfBill,
          titleText: null,
          evidence: [found, result.evidence].filter(Boolean).join(" "),
          certain: false,
          charged: true,
        },
        200,
      );
    }
  }

  // ============================================================================
  // THE NAME AND THE MODEL DISAGREE, SO A PERSON DECIDES (prod-ready K1).
  //
  // A clean bill named "… Bill of Quantities.xlsx" was read by the model as an
  // FF&E schedule and filed and read as one: a charged read, no records, no
  // question. The name still settles nothing (`document-name-guess.ts`); a
  // model answer the name contradicts settles nothing either. Held with both
  // readings, the model's beside the name's, and nothing registered or read.
  //
  // WHAT CODE MAKES OF A PDF THE MODEL CALLS A BILL IS READ FIRST (prod-ready
  // review F4, 2026-11-20). The hold returned before it, so a PDF named as a
  // schedule that the model read, certain, as a bill code cannot put back was
  // offered "Bill of quantities" one click away with no word that choosing it
  // means the model transcribes it — one charged read. The held answer now
  // carries the same `pdfBill` the unheld one does; a bill code refuses
  // outright carries none, and its registration says why if it is chosen.
  // ============================================================================
  const modelBillRead =
    result.decision?.importType === "boq" && source.type === "pdf"
      ? await readPdfBill(blob.bytes, await billReadingOptions())
      : null;
  const disagreement = nameModelDisagreement(guessKindFromName(input.filename), result);
  if (disagreement && result.decision) {
    return json(
      {
        ok: true,
        note,
        genre: result.genre,
        decision: null,
        unsupported: null,
        held: disagreement,
        modelDecision: result.decision,
        pdfBill: !modelBillRead
          ? null
          : modelBillRead.ok
            ? { lines: modelBillRead.rows.length, pages: modelBillRead.pageCount }
            : isTranscribable(modelBillRead.code)
              ? transcribeNote(modelBillRead.code, countPdfPages(blob.bytes))
              : null,
        titleText: result.titleText,
        evidence: result.evidence,
        certain: result.certain,
        charged: true,
      },
      200,
    );
  }

  // ============================================================================
  // A BILL IN A PDF IS READ BY ITS TEXT, BY CODE, BEFORE IT IS FILED (C1).
  //
  // The model said what the document IS; whether its cells can be put back is
  // code's to answer, from the bytes already in hand, and it costs nothing.
  // A table holds and the row is filed as a bill — registration reads it
  // again and builds the workbook (`/api/imports`). Anything else is HELD with
  // one short sentence and the detail beside it, before a byte is registered:
  // filing it as a bill would only fail one press later. Still nothing is
  // written here.
  // ============================================================================
  let pdfBill: PdfBillNote | null = null;
  if (modelBillRead) {
    const read = modelBillRead;
    // CODE COULD NOT PUT ITS TEXT BACK INTO A TABLE: the model transcribes it
    // (C2), every line marked. Filed as a bill; the row says so and that the
    // transcription is one charged read.
    if (!read.ok && isTranscribable(read.code)) {
      pdfBill = transcribeNote(read.code, countPdfPages(blob.bytes));
    } else if (!read.ok) {
      return json(
        {
          ok: true,
          note,
          genre: result.genre,
          decision: null,
          unsupported: pdfBillRefusal(read.code),
          unsupportedDetail: read.detail,
          titleText: result.titleText,
          evidence: result.evidence,
          certain: result.certain,
          charged: true,
        },
        200,
      );
    } else {
      pdfBill = { lines: read.rows.length, pages: read.pageCount };
    }
  } else if (source.type === "pdf" && !NOT_A_BILL.has(result.genre)) {
    // ==========================================================================
    // THE MODEL AND THE TEXT DISAGREE, SO A PERSON DECIDES.
    //
    // The real Ronnie Scott's "Procurement Schedule" PDFs (2026-10-15) carry an
    // ORDER QTY on every line and say "FF&E SPECIFICATION" at the top, and the
    // fast model filed all three as FF&E schedules, certain — three charged
    // reads and no records. Stating "a procurement schedule is a bill" in the
    // prompt did not move it (measured the same evening), and the word
    // "procurement" is only in the filenames. Code can see something the model
    // reading did not weigh: the text is a table with a quantity on every line.
    //
    // Neither reading wins (house §5, §6): filing it as a bill on code's say
    // would make an FF&E schedule with a Qty column a project's worth of
    // records, and filing it as a schedule spends a read that answers the
    // wrong question. So it is HELD with one sentence naming the next step,
    // the model's reading beside it, and nothing is registered or charged.
    // ==========================================================================
    const read = await readPdfBill(blob.bytes, await billReadingOptions());
    if (read.ok) {
      return json(
        {
          ok: true,
          note,
          genre: result.genre,
          decision: null,
          unsupported: null,
          held: tableHeld(result.genre, read.rows.length),
          pdfBill: { lines: read.rows.length, pages: read.pageCount },
          titleText: result.titleText,
          evidence: result.evidence,
          certain: result.certain,
          charged: true,
        },
        200,
      );
    }
  }

  return json(
    {
      ok: true,
      note,
      genre: result.genre,
      decision: result.decision,
      // A bill in a PDF whose text reads as a table: how much of it, for the row.
      pdfBill,
      // A REFUSAL, not a gap. `decision: null` with nothing here means "you
      // decide"; with a sentence here it means the app knows what this is and
      // does not read it — a scan, today, or a PDF bill whose text is not a
      // table (set above).
      unsupported: result.unsupported,
      titleText: result.titleText,
      evidence: result.evidence,
      certain: result.certain,
      charged: true,
      // Said on the row: a long document is identified by the reading model,
      // and somebody reading the cost of a pack is owed that.
    },
    200,
  );
}

/** Said above each part of a sheet two parts name. */
const SHEET_HOLDS_TWO_KINDS =
  "This sheet seems to hold two kinds of document. A sheet is read whole: choose one kind for it, or don't read it.";

/** Said above pages or a sheet no part of the survey's answer covers. */
const UNCOVERED_HELD = "No part of the file covers these pages — say what they are, or don't read them.";
const UNCOVERED_SHEET_HELD = "No part of the file covers this sheet — say what it is, or don't read it.";

/**
 * C1's sentence: a PDF (or a part of one) the model did not call a bill whose
 * text is a table with a quantity on every line. One sentence for a file and a
 * part, so the rule cannot read differently in the two places.
 */
function tableHeld(genre: string, lines: number): string {
  return `${GENRE_WORDS[genre] ? `Read as ${GENRE_WORDS[genre]}, but its` : "Its"} text is a table of ${lines} line${lines === 1 ? "" : "s"} with a quantity on each: if it is the bill, choose Bill of quantities.`;
}

/** A place no part covers, as a part a person must answer. */
function uncoveredPart(place: PartPlace): ClassifiedPart {
  return {
    place,
    genre: "unclear",
    decision: null,
    certain: false,
    evidence: "",
    held: place.kind === "sheet" ? UNCOVERED_SHEET_HELD : UNCOVERED_HELD,
    suggestion: null,
    unsupported: null,
    unsupportedDetail: null,
    itemCodes: [],
    finishCodes: [],
    pdfBill: null,
    nothingToRead: false,
  };
}

/**
 * ONE READ FOR THE WHOLE FILE, or null where the parts are not that.
 *
 * Every readable part settled on the SAME reader, none held, and nothing the
 * survey said set aside or missing: a drawing set with a cover and a blank
 * divider is one drawing set, whatever count of parts the survey gave round
 * the blank page. Answered as the single file it is — today's shape, the
 * whole file, `source_part` null — so its read keeps the filename's drawing
 * number and gets no part instruction and no filter. The part standing for
 * the file takes the genre covering the most of it, as `mergeByReader` does,
 * and is certain because every member was settled.
 */
function wholeFileRead(readable: SurveyPart[]): SurveyPart | null {
  if (readable.length < 2) return null;
  const readers = readable.map((part) => partReader(part));
  const first = readers[0];
  if (!first || readers.some((reader) => !reader || reader.importType !== first.importType || reader.documentKind !== first.documentKind)) {
    return null;
  }
  const size = (part: SurveyPart) => (part.place.kind === "pages" ? part.place.to - part.place.from + 1 : 1);
  const byGenre = new Map<SurveyPart["genre"], number>();
  for (const part of readable) byGenre.set(part.genre, (byGenre.get(part.genre) ?? 0) + size(part));
  let genre = readable[0]!.genre;
  for (const [candidate, weight] of byGenre) if (weight > (byGenre.get(genre) ?? 0)) genre = candidate;
  return {
    place: { kind: "whole" },
    genre,
    certain: true,
    weighedAgainst: null,
    evidence: readable.map((part) => part.evidence).filter(Boolean).join(" / "),
    itemCodes: [...new Set(readable.flatMap((part) => part.itemCodes))],
    finishCodes: [...new Set(readable.flatMap((part) => part.finishCodes))],
    nothingToRead: false,
  };
}

/** A failed look, in the code, sentence and status the upload row reads. */
function failureAnswer(result: Extract<ClassifyResult, { ok: false }>): Response {
  return json(
    { ok: false, code: result.code, error: result.error, charged: result.charged, model: result.model },
    FAILURE_STATUS[result.code],
  );
}

/**
 * The one part of a single-kind file in the shape the file check answered
 * in, so every rule after the look reads it unchanged. No part left at all —
 * every part a cover or an index — is the whole file for a person to say:
 * unclear, not certain, the survey's own words beside it.
 */
function soleResult(sole: SurveyPart | null, parts: SurveyPart[]): Extract<ClassifyResult, { ok: true }> {
  if (!sole) {
    return {
      ok: true,
      genre: "unclear",
      decision: null,
      unsupported: null,
      titleText: null,
      evidence: parts.map((part) => part.evidence).filter(Boolean).join(" / "),
      certain: false,
      model: SURVEY_MODEL,
    };
  }
  return {
    ok: true,
    genre: sole.genre,
    // `partReader` is `fileDocument`'s decision: the weighed-against rule
    // settles a doubt between two genres read the same way, as it did.
    decision: partReader(sole),
    unsupported: null,
    // The survey quotes its evidence and gives no separate title.
    titleText: null,
    evidence: sole.evidence,
    certain: sole.certain,
    model: SURVEY_MODEL,
  };
}

/**
 * A scanned PDF, looked at by the file check (C2): a bill the model is sure
 * of is filed to be transcribed, a schedule or an unplaced scan is held with
 * the way to have it transcribed, and anything else is refused in words.
 */
function scannedAnswer(result: ClassifyResult, scannedPages: number | null): Response {
  if (!result.ok) return failureAnswer(result);
  if (result.decision?.importType === "boq") {
    return json(
      {
        ok: true,
        genre: result.genre,
        decision: result.decision,
        pdfBill: transcribeNote("scanned", scannedPages),
        unsupported: null,
        titleText: result.titleText,
        evidence: result.evidence,
        certain: result.certain,
        charged: true,
      },
      200,
    );
  }
  // A SCAN THE MODEL FILED AS SOME SCHEDULE, OR COULD NOT PLACE, may be the
  // bill — the fast model files a procurement schedule as an FF&E schedule
  // (C1, measured). Held, C1's way, with the next step in the sentence:
  // choosing Bill has it transcribed. A scanned drawing, spec sheet, preamble
  // or message is still refused: nothing here reads pictures of those.
  if (!NOT_A_BILL.has(result.genre)) {
    return json(
      {
        ok: true,
        genre: result.genre,
        decision: null,
        unsupported: null,
        held: `${GENRE_WORDS[result.genre] ? `Read as ${GENRE_WORDS[result.genre]}; its` : "Its"} pages are pictures, with no text a program can read. If it is the bill, choose Bill of quantities: the model will transcribe it (one charged read) and mark every line for you to check against its page.`,
        titleText: result.titleText,
        evidence: result.evidence,
        certain: result.certain,
        charged: true,
      },
      200,
    );
  }
  return json(
    {
      ok: true,
      genre: result.genre,
      decision: null,
      unsupported: SCANNED_PDF,
      titleText: result.titleText,
      evidence: result.evidence || "the pages carry no text, only images",
      certain: result.certain,
      charged: true,
    },
    200,
  );
}
