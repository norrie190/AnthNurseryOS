-- Independent allocation infrastructure for the later Equipment creation service.
-- No records or references are allocated here. Imports must coordinate the sequence.
BEGIN;

CREATE SEQUENCE public.equipment_reference_sequence
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    NO MAXVALUE
    CACHE 1
    NO CYCLE
    OWNED BY NONE;

COMMIT;
