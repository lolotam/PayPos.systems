import { defaultDocumentTypes } from '../../domain/default-document-types.ts';
import type { DocumentTypeSeeds, SeedIds } from '../../ports/document-type-seeds.port.ts';

// يجهز أنواع الوثائق الموصى بها لشركة جديدة حتى يجد المدير القائمة جاهزة.
export class SeedDocumentTypes {
  constructor(
    private readonly seeds: DocumentTypeSeeds,
    private readonly ids: SeedIds,
  ) {}
  execute(): Promise<number> {
    return this.seeds.insertMissing(
      defaultDocumentTypes().map((type) => ({ ...type, id: this.ids.newId() })),
    );
  }
}
