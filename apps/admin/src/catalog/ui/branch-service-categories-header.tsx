'use client';
import { Button, PageHeader } from '@pospay/ui';
import {
  useRegisterCreateAction,
  type CreateEmbed,
} from '../model/use-register-create-action';

/**
 * ترويسة قسم تصنيفات الفرع: المضمَّن في الشاشة يسجّل إجراء الإضافة عندها ويعرض سطر الشرح فقط،
 * والمستقل يرسم ترويسته وزرّه بنفسه.
 */
export function BranchServiceCategoriesHeader({
  section,
  embed,
}: {
  section: { title: string; lead: string; createLabel: string; openCreate: () => void };
  embed: CreateEmbed | undefined;
}) {
  useRegisterCreateAction(embed, section.openCreate);
  if (embed) return <p>{section.lead}</p>;
  return (
    <PageHeader
      title={section.title}
      description={section.lead}
      action={
        <Button variant="outline" size="sm" onClick={section.openCreate}>
          {section.createLabel}
        </Button>
      }
    />
  );
}
