-- ==========================================================================
-- 0065_intake_run_source_part.sql -- a read can be of PART of a file.
--
-- Open intake (2026-11-20). One PDF arrives holding a bill, its shop drawings
-- and a preamble; one workbook holds bill sheets and a finishes sheet. Until
-- this file an intake run was a whole file and one reader, so such a file was
-- either refused at the upload or read whole by one reader, and the other
-- documents in it were staged as if they were that kind -- a preamble's pages
-- read as drawings, a finishes sheet read as bill lines.
--
-- `source_part` is WHICH part of the stored file this run reads: null for the
-- whole file (every run before this day, and every file with one kind in it),
-- otherwise {"kind":"pages","ranges":[{"from":1,"to":11},...]} for a PDF or
-- {"kind":"sheets","sheets":["Finishes",...]} for a workbook
-- (`src/lib/source-part.ts`).
--
-- TWO THINGS THIS COLUMN IS NOT, and the reason for each:
--
--   * NOT a copy of the pages. Page numbers stay the FILE's: every staged
--     page, every record_attributes.source_page, every swatch crop and every
--     #page=N link is a page of the stored file, served whole. Cutting a part
--     into its own PDF would renumber all of them, silently and plausibly. So
--     the read is sent the whole file and told its pages.
--   * NOT a promise the model kept to them. After the read, code drops what
--     was reported from outside the part and says so in the document's notes
--     (`src/lib/part-filter.ts`). The model is told; the code decides.
--
-- The CHECK holds only the kind. The shape inside it is the app's to validate
-- (zod, at registration), because a CHECK spelling out jsonb ranges is a
-- second definition of the part that would drift from the first.
-- ==========================================================================
begin;

alter table intake_runs add column source_part jsonb;

alter table intake_runs add constraint intake_runs_source_part_kind_check check (
  source_part is null
  or (jsonb_typeof(source_part) = 'object' and source_part->>'kind' in ('pages', 'sheets'))
);

comment on column intake_runs.source_part is
  'The part of the stored file this run reads: null for the whole file, {"kind":"pages","ranges":[{"from","to"}]} (the FILE''s 1-based pages) or {"kind":"sheets","sheets":[names]}. Written at registration and copied by a read of the same run''s file; see src/lib/source-part.ts.';

commit;
