-- Fair Split: functions the schema's column defaults need (runs before the generated schema).
--
-- fs_uuidv7(): RFC 9562 UUIDv7 for SQL-side inserts, Postgres 17 compatible (18 has a native uuidv7()).
-- Take a v4 UUID (variant 10 already set), overlay its first 6 bytes with the 48-bit Unix millisecond
-- timestamp, then flip bits 52 and 53 so the version nibble reads 0111. The application uses the monotonic
-- generator in src/ids/uuidv7.ts; both produce the same layout.
CREATE OR REPLACE FUNCTION fs_uuidv7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                FROM 1 FOR 6),
        52, 1),
      53, 1),
    'hex')::uuid
$$;
