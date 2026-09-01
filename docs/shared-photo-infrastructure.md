# Shared photo infrastructure

## Purpose

Plant photographs remain owned by the Plant domain and stored as PlantPhoto records. The reusable mechanics underneath them live in small neutral photo modules so the separate EquipmentPhoto model can use the same proven processing and R2 safeguards later. This is not a generic media or attachment framework. EquipmentPhoto now exists as schema only; its application layer is not implemented yet.

## Shared mechanics

`src/lib/photos` owns the mechanics that do not depend on a nursery record type:

- supported format detection and complete JPEG, PNG and static WebP validation
- the 10 MiB encoded file limit and 50 MP decoded image limit
- EXIF orientation, metadata free previews and derivatives, natural aspect display images and square thumbnails
- normalised crop validation, centred defaults and deterministic conversion to oriented pixel coordinates
- the closed `plants` and `equipment` storage namespace vocabulary
- exact owner, asset, original, display, legacy thumbnail and revision thumbnail key validation
- lazy private R2 transport, conditional uploads, object checks, original reads and five minute signed reads
- bounded, paginated cleanup of one exact validated asset prefix
- a small neutral validation error used only by the shared processing and crop boundary

The shared R2 layer accepts only the two approved namespace values. A domain wrapper fixes one of those values before any service uses it. The Plant wrapper therefore accepts `plants/...` keys and rejects `equipment/...` keys. Unknown namespaces, malformed UUID paths and prefixes broader than one asset are rejected.

`src/components/photos` contains only the square crop selector and the ordinary image fallback. The selector has neutral text and styling; the Plant wrapper supplies the existing Plant wording. Gallery composition and actions are not shared.

## Plant specific responsibilities

The Plant module still owns PlantPhoto persistence and ownership, Plant locking and `expectedUpdatedAt`, primary selection, ordering, upload and cleanup coordination, uncertain commit handling, queries, browser input and error mapping. Plant routes, allowed variants, captions, gallery composition and list integration also remain Plant specific.

Shared image validation errors are translated back to the existing PlantError shape at the Plant boundary. This preserves the current safe browser feedback without making another domain depend on PlantError.

No Plant URL, database field, transaction rule or R2 object key changes in this refactor. Existing objects continue to use:

```text
plants/<plant UUID>/<asset UUID>/original.<detected extension>
plants/<plant UUID>/<asset UUID>/display.webp
plants/<plant UUID>/<asset UUID>/thumbnail.webp
plants/<plant UUID>/<asset UUID>/thumbnails/<revision UUID>.webp
```

## Cleanup boundary

Deletion cleanup starts from a known original key, derives its exact asset prefix and requires the trailing slash. Listing is bounded and paginated. Every returned key is checked against the same namespace, owner and asset before deletion, and the prefix is checked again afterwards. The primitive cannot list or delete an entire owner folder and does not perform broad bucket cleanup.

## Next consumer

The separate EquipmentPhoto table and `Equipment.photos` relation are now the next schema consumer. Later Equipment specific services may compose these shared mechanics through an Equipment wrapper fixed to the `equipment` namespace. They will not make PlantPhoto polymorphic or move Equipment concurrency and ownership rules into the shared layer.

The shared infrastructure refactor itself changed no persisted photo metadata or stored R2 object. The later Equipment schema checkpoint creates only database structure and does not call these storage mechanics.
