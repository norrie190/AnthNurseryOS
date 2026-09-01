# Equipment photo data model

## Checkpoint and scope

The Equipment photo schema checkpoint adds a separate EquipmentPhoto table and the reverse `Equipment.photos` relation. PlantPhoto remains unchanged. Both domains keep proper foreign keys and use the neutral processing, crop and private R2 mechanics in [Shared photo infrastructure](shared-photo-infrastructure.md) underneath their own ownership rules.

The schema checkpoint added no application behaviour. The later [Equipment photo data layer](equipment-photo-data-layer.md) now implements Equipment-owned services, metadata queries and the restricted future delivery boundary. Browser routes, gallery composition and list thumbnails are still not implemented.

## Relationship

```text
Equipment
└── 0 to many EquipmentPhoto records
```

Every EquipmentPhoto belongs to exactly one Equipment through `equipmentId`. The foreign key restricts Equipment deletion and ID updates. Archiving or restoring Equipment does not change its photos.

## Fields

| Field              | Prisma / PostgreSQL        | Required and default        | Meaning                                       |
| ------------------ | -------------------------- | --------------------------- | --------------------------------------------- |
| id                 | String / uuid              | Required, Prisma uuid()     | Internal photo identity                       |
| equipmentId        | String / uuid              | Required                    | Owning Equipment                              |
| storageKey         | String / text              | Required, unique            | Immutable private original object key         |
| originalFilename   | String? / text             | Optional, null              | Original basename as metadata only            |
| caption            | String? / text             | Optional, null              | Optional description                          |
| takenAt            | DateTime? / timestamptz(3) | Optional, null              | When the photograph was taken                 |
| isPrimary          | Boolean / boolean          | Required, false             | Selected Equipment image                      |
| sortOrder          | Int / integer              | Required, 0                 | Future deterministic gallery ordering         |
| cropX              | Float? / double precision  | Optional, null              | Normalised square crop left edge              |
| cropY              | Float? / double precision  | Optional, null              | Normalised square crop top edge               |
| cropSize           | Float? / double precision  | Optional, null              | Square side relative to the shorter dimension |
| derivativeRevision | String? / uuid             | Optional, null              | Active immutable thumbnail revision           |
| createdAt          | DateTime / timestamptz(3)  | Required, now()             | Metadata creation instant                     |
| updatedAt          | DateTime / timestamptz(3)  | Required, Prisma @updatedAt | Metadata update instant                       |

All four crop fields are either null together or populated together. Independent database ranges require `0 <= cropX < 1`, `0 <= cropY < 1` and `0 < cropSize <= 1`. A later application service will validate the complete square against the decoded, orientation corrected image dimensions.

The partial unique index permits any number of nonprimary photos but at most one primary photo per Equipment. Zero primary photos are valid. The ordinary ordering index is `(equipmentId, sortOrder)`; later reads will use sortOrder, createdAt and id as deterministic ordering without another speculative index.

## Storage contract for later work

PostgreSQL stores metadata only. It does not store image bytes, bucket names, public URLs, signed URLs or derived URLs. The future Equipment wrapper will generate and validate the closed `equipment` namespace:

```text
equipment/<equipment UUID>/<asset UUID>/original.<detected extension>
equipment/<equipment UUID>/<asset UUID>/display.webp
equipment/<equipment UUID>/<asset UUID>/thumbnail.webp
equipment/<equipment UUID>/<asset UUID>/thumbnails/<revision UUID>.webp
```

The original stays private and unchanged. Display keeps the orientation corrected photograph's natural aspect ratio. The active thumbnail uses the saved square crop. The Equipment photo data layer now invokes these mechanics through an Equipment-only wrapper; browser delivery and UI remain later work.
