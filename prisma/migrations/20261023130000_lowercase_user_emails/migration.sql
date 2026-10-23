-- B-13: normalise User.email to lower case (the app now lower-cases on write and lookup).
-- Rows whose lower-cased address would collide with another account are left untouched
-- so nothing is merged silently; resolve those by hand.
UPDATE "User" u
SET "email" = lower(u."email")
WHERE u."email" <> lower(u."email")
  AND NOT EXISTS (
    SELECT 1 FROM "User" o WHERE o."id" <> u."id" AND o."email" = lower(u."email")
  )
  AND (SELECT count(*) FROM "User" x WHERE lower(x."email") = lower(u."email")) = 1;
