-- Reference allocation is independent of Plant rows. Gaps are intentional.
-- Future imports of existing ANT references must coordinate with this sequence.
BEGIN;

CREATE SEQUENCE public.plant_reference_sequence
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    NO MAXVALUE
    CACHE 1
    NO CYCLE
    OWNED BY NONE;

COMMIT;
