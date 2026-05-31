-- Idempotent cleanup: drop orphaned pytest_* schemas (issue #117).
-- Safe for `public` and real data — only schemas matching pytest_* are dropped.
-- Run manually or as a CI pre-test guard.

DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'pytest\_%' LOOP
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', r.nspname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'dropped % pytest_* schemas', n;
END $$;
