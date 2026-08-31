BEGIN;

ALTER TABLE "PlantPhoto"
    ADD COLUMN "cropX" DOUBLE PRECISION,
    ADD COLUMN "cropY" DOUBLE PRECISION,
    ADD COLUMN "cropSize" DOUBLE PRECISION,
    ADD COLUMN "derivativeRevision" UUID;

-- Legacy photos remain unchanged. Saved crops require all four values.
ALTER TABLE "PlantPhoto"
    ADD CONSTRAINT "PlantPhoto_crop_consistency_check"
    CHECK (
        (
            "cropX" IS NULL
            AND "cropY" IS NULL
            AND "cropSize" IS NULL
            AND "derivativeRevision" IS NULL
        )
        OR
        (
            "cropX" IS NOT NULL
            AND "cropY" IS NOT NULL
            AND "cropSize" IS NOT NULL
            AND "derivativeRevision" IS NOT NULL
        )
    );

-- Oriented image dimensions and rectangle bounds are checked by the service.
ALTER TABLE "PlantPhoto"
    ADD CONSTRAINT "PlantPhoto_crop_ranges_check"
    CHECK (
        "cropX" IS NULL
        OR (
            "cropX" >= 0 AND "cropX" < 1
            AND "cropY" >= 0 AND "cropY" < 1
            AND "cropSize" > 0 AND "cropSize" <= 1
        )
    );

COMMIT;
