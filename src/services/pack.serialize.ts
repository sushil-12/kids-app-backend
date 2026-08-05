// ContentPack row → the JSON the Flutter app parses, and the compact summary
// the catalog endpoints return.
//
// Keep this in lockstep with CinematicStoryV3.fromJson in
// brightmind_kids/lib/src/features/learn/data/cinematic_story_v3.dart.
//
// Packs are served BILINGUAL — text fields keep their `{ en, hi }` maps and the
// app collapses them to one language at parse time. That is what lets the
// in-player EN ⇄ हिन्दी pill switch instantly from a single cached document
// instead of re-fetching a second pack.

import { ContentPack } from '@prisma/client';
import { letterClipSlots, parseLetterSpec, pickLang } from './pack.schema';

interface ManifestAsset {
  id?: unknown;
  type?: unknown;
  url?: unknown;
  assetPath?: unknown;
}

function manifestOf(pack: ContentPack): ManifestAsset[] {
  return Array.isArray(pack.assetManifest) ? (pack.assetManifest as ManifestAsset[]) : [];
}

/** Resolves a manifest id to its URL — used for catalog thumbnails. */
export function assetUrl(pack: ContentPack, assetId: unknown): string | null {
  if (typeof assetId !== 'string' || !assetId) return null;
  const hit = manifestOf(pack).find((a) => a.id === assetId);
  return typeof hit?.url === 'string' ? hit.url : null;
}

/** The full playable document. */
export function serializePack(pack: ContentPack): Record<string, unknown> {
  return {
    schemaVersion: pack.schemaVersion,
    id: pack.id,
    slug: pack.slug,
    kind: pack.kind,
    title: pack.title,
    availableLangs: pack.availableLangs,
    ageBand: pack.ageBand,
    category: pack.category,
    concepts: pack.concepts,
    moral: pack.moral,
    estimatedDuration: pack.estimatedDuration,
    cover: pack.cover,
    audio: pack.audio,
    reward: pack.reward,
    assetManifest: pack.assetManifest,
    moments: pack.moments,
    ...(pack.topic ? { topic: pack.topic } : {}),
    ...(pack.letter ? { letter: pack.letter } : {}),
    // Bilingual maps intact, exactly like `title` and `moral` — the app collapses
    // them so the language pill costs no refetch.
    ...(pack.letterSpec ? { letterSpec: pack.letterSpec } : {}),
    date: pack.date,
    source: pack.source,
    // The app caches by `pack_<slug>_<version>`, so an admin edit invalidates
    // the on-device copy without any cache-busting header.
    version: pack.version,
  };
}

/** Catalog row: enough to render a shelf/grid tile without fetching the pack.
 *  Replaces the app's hardcoded StoryCatalog, poem topic list and A–Z list. */
export function serializePackSummary(pack: ContentPack): Record<string, unknown> {
  const cover = (pack.cover ?? {}) as Record<string, unknown>;
  const spec = parseLetterSpec(pack.letterSpec);
  return {
    slug: pack.slug,
    kind: pack.kind,
    title: pack.title,
    emoji: typeof cover.emoji === 'string' ? cover.emoji : '📖',
    coverUrl: assetUrl(pack, cover.image),
    minutes: Math.max(1, Math.round(pack.estimatedDuration / 60)),
    langs: pack.availableLangs,
    ageBand: pack.ageBand,
    moments: Array.isArray(pack.moments) ? pack.moments.length : 0,
    ...(pack.topic ? { topic: pack.topic } : {}),
    ...(pack.letter ? { letter: pack.letter } : {}),
    // The ABC hub draws a 26-tile grid. Everything it needs — both glyphs, the
    // teaching order and one picture — rides on the catalog, so the grid renders
    // from a single request instead of 26 pack fetches.
    ...(spec
      ? {
          script: spec.script,
          order: spec.order,
          glyph: spec.glyph,
          previewImageUrl:
            assetUrl(pack, spec.mnemonicImage) ??
            assetUrl(pack, spec.words.find((w) => w.image)?.image) ??
            null,
        }
      : {}),
    version: pack.version,
  };
}

/** Admin list row: the summary plus the authoring state an editor needs to
 *  triage a library at a glance (unpublished, missing art, missing voice-over). */
export function serializePackAdminRow(
  pack: ContentPack,
  clipCount: number,
): Record<string, unknown> {
  const moments = Array.isArray(pack.moments) ? (pack.moments as Record<string, unknown>[]) : [];
  const manifest = manifestOf(pack);
  const ids = new Set(manifest.map((a) => String(a.id)));

  const spec = parseLetterSpec(pack.letterSpec);

  let missingArt = moments.filter((m) => {
    const visual = (m.visual ?? {}) as Record<string, unknown>;
    if (visual.primary !== 'image' && visual.primary !== 'video') return false;
    return typeof visual.asset !== 'string' || !ids.has(visual.asset);
  }).length;

  // A letter's pictures are the point of the screen, so an unillustrated word
  // counts as missing art the same way an image moment with no asset does —
  // that's what drives the "needs art" triage badge in the library.
  if (spec) {
    if (!spec.mnemonicImage || !ids.has(spec.mnemonicImage)) missingArt += 1;
    missingArt += spec.words.filter((w) => !w.image || !ids.has(w.image)).length;
  }

  const langs = Array.isArray(pack.availableLangs) ? (pack.availableLangs as string[]) : ['en'];

  return {
    ...serializePackSummary(pack),
    id: pack.id,
    titleEn: pickLang(pack.title, 'en'),
    published: pack.published,
    date: pack.date,
    source: pack.source,
    usedCount: pack.usedCount,
    updatedAt: pack.updatedAt,
    assets: manifest.length,
    missingArt,
    clips: clipCount,
    // How many clips a full narration run would produce, so the UI can show
    // "12 / 16" without loading every moment. A letter records its card (name,
    // sound, each word and sentence) on top of its cinematic moments.
    expectedClips: (moments.length + (spec ? letterClipSlots(spec).length : 0)) * langs.length,
  };
}
