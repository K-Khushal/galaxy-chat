-- Keep existing ownership, immutable revisions, origin and byte constraints.
ALTER TABLE artifact DROP CONSTRAINT artifact_kind_check;
ALTER TABLE artifact ADD CONSTRAINT artifact_kind_check
 CHECK(kind IN ('markdown','html','chart'));
