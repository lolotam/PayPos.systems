'use client';

import type { ContextPanelLabels } from './navigation-presentation.js';

export type ContextPanelEmptyProps = {
  labels: ContextPanelLabels;
};

export function ContextPanelEmpty({ labels }: ContextPanelEmptyProps) {
  return <p className="px-2 text-sm text-muted-foreground">{labels.empty}</p>;
}
