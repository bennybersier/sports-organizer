-- -----------------------------------------------------------------------------
-- 0027 — accept a referto uploaded as a PDF
--
-- The bucket took three image types, so a club holding the PDF everyone
-- actually circulates had to photograph or export it to a JPEG first — which
-- is asking them to degrade the document before handing it over, and the
-- reading is only ever as good as what it is given.
--
-- Nothing else changes: `match_sheets.mime_type` is already free text, the
-- path still carries the tenant id in its first segment, and every storage
-- policy added in 0026 reads that same segment and so covers this unchanged.
-- -----------------------------------------------------------------------------
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
 where id = 'match-sheets';
