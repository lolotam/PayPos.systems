'use client';
import type { ServiceCategory, ServiceCategoryClosingAction } from '@pospay/contracts';
import type { RefObject } from 'react';
import type { ServiceCategoryClosingRequest } from '../api/use-service-category-closing';
import type { TrackedServiceCategoryClosing } from '../model/service-category-closing';
import type { NoticeInput } from './service-category-closing-notice';
import { ServiceCategoryForm } from './service-category-form';
import { ServiceCategoryPanel } from './service-category-panel';

type ServiceCategoryEditorProps = {
  companyId: string;
  businessId: string;
  userId: string;
  selectedId: string;
  creating: boolean;
  tracked: TrackedServiceCategoryClosing | null;
  finished: RefObject<Set<string>>;
  noticeInput: NoticeInput | null;
  noticeError?: unknown;
  closingError?: unknown;
  closingPending: boolean;
  requestClosing: (input: ServiceCategoryClosingRequest, onAccepted?: () => void) => void;
  onTrack: (categoryId: string, closingId: string, action: ServiceCategoryClosingAction) => void;
  onRetry: (categoryId: string) => void;
  onSaved: (category: ServiceCategory) => void;
  onClose: () => void;
};

export function ServiceCategoryEditor(props: ServiceCategoryEditorProps) {
  if (props.creating) {
    return (
      <ServiceCategoryForm
        companyId={props.companyId}
        businessId={props.businessId}
        userId={props.userId}
        mode="create"
        onReload={() => undefined}
        onSaved={props.onSaved}
      />
    );
  }
  if (!props.selectedId) return null;
  return (
    <ServiceCategoryPanel
      key={props.selectedId}
      companyId={props.companyId}
      businessId={props.businessId}
      userId={props.userId}
      categoryId={props.selectedId}
      tracked={props.tracked}
      finished={props.finished}
      noticeInput={props.noticeInput}
      noticeError={props.noticeError}
      closingError={props.closingError}
      closingPending={props.closingPending}
      requestClosing={props.requestClosing}
      onTrack={props.onTrack}
      onRetry={props.onRetry}
      onClose={props.onClose}
    />
  );
}
