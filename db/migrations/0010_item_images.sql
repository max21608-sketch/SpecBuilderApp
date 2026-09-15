-- ==========================================================================
-- 0010_item_images.sql — room for a picture of the thing being quoted.
-- Target: PostgreSQL 13+. Forward-only.
--
-- WHY. A spec record is currently a description, a quantity and a list of
-- things documents said about it. Nobody can look at one and recognise the
-- item. The drawings carry a view of it -- the Panther specification sheets
-- carry a photograph or render top-right, and the shop drawing set carries a
-- 3D and a front elevation -- and that picture is the fastest way a human
-- confirms they are looking at the right record.
--
-- NO NEW TABLE. `attachments` is polymorphic and 0001's own header already
-- names "extracted images" as one of the things it exists to serve. An item
-- image is entity_type = 'spec_records', entity_id = the record, kind =
-- 'item_image', storage_path = a blob PATHNAME under projects/<projectId>/.
-- Adding a table would duplicate the audit trigger, the blob discipline and
-- the serving route for no new capability.
--
-- WHAT THIS MIGRATION IS ACTUALLY FOR, then, is the two columns a picture
-- needs that a document does not. A thumbnail rendered into a fixed box
-- reflows the page when its real aspect ratio arrives late; knowing the
-- dimensions at query time lets the box be reserved correctly on first paint.
-- Nullable, because every attachment written before now is a PDF or a
-- workbook and has no dimensions -- and because null must keep meaning "not an
-- image, or an image nobody measured", never "0 x 0".
--
-- SIZE IS NOT STORED SEPARATELY. `attachments.size` already exists and already
-- means bytes.
--
-- A NOTE ON WHERE THESE BYTES COME FROM, because it is a change of kind and
-- not just of content. Every blob this app has held so far was a source
-- document a client sent, uploaded whole and preserved so a value can be
-- traced back to it. An item image is DERIVED -- cropped out of one of those
-- documents, encoded by the reviewer's own browser, and uploaded as a new
-- object. The pathname scoping in src/lib/blob-source.ts applies to it
-- unchanged (checked at token issue, at registration and on every read), and
-- the source PDF is still preserved, so the crop can always be re-made. But
-- "the store holds only what a client sent us" stopped being true here, and
-- the instruction files say so rather than leaving it to be discovered.
-- ==========================================================================

begin;

alter table attachments add column image_width  integer;
alter table attachments add column image_height integer;

-- A stored dimension of zero or less is not a smaller image, it is a bug that
-- reached the database. Refuse it here rather than rendering a collapsed box.
alter table attachments add constraint attachments_image_dims_positive
  check ((image_width is null or image_width > 0)
     and (image_height is null or image_height > 0));

-- Both or neither. One dimension on its own cannot reserve a box, and is
-- always a half-written row rather than a deliberate state.
alter table attachments add constraint attachments_image_dims_together
  check ((image_width is null) = (image_height is null));

-- "Does this record have an image yet" is asked once per record on the record
-- screen and once per row on any list that shows a thumbnail.
create index attachments_kind_entity_idx
  on attachments (entity_type, entity_id, kind);

commit;
