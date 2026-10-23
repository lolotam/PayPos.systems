'use client';
import { useRef, useState } from 'react';

type OpenEditor = { key: string; token: number };

function usePanelToggle() {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (visitId: string, lineId: string) => {
    const key = `${visitId}:${lineId}`;
    setOpen((current) => (current === key ? null : key));
  };
  return [open, toggle] as const;
}

function useEditorSlot() {
  const [open, setOpen] = useState<OpenEditor | null>(null);
  const release = (key: string, token: number) => {
    setOpen((current) => (current?.key === key && current.token === token ? null : current));
  };
  return { open, setOpen, release };
}

// محرر واحد بس مفتوح في المرة (سعر أو إلغاء أو منفّذين)، عشان طلبين على نفس السطر ما يتسابقوش على نفس المراجعة.
export function useDayLineActions() {
  const token = useRef(0);
  const edit = useEditorSlot();
  const cancel = useEditorSlot();
  const performers = useEditorSlot();
  const [history, toggleHistory] = usePanelToggle();
  const [details, toggleDetails] = usePanelToggle();
  const [performerHistory, togglePerformerHistory] = usePanelToggle();
  const [notice, setNotice] = useState<string | null>(null);
  const opener = (slot: ReturnType<typeof useEditorSlot>) => (visitId: string, lineId: string) => {
    const key = `${visitId}:${lineId}`;
    setNotice(null);
    for (const other of [edit, cancel, performers]) if (other !== slot) other.setOpen(null);
    if (slot.open?.key === key) return;
    token.current += 1;
    slot.setOpen({ key, token: token.current });
  };
  return {
    editing: edit.open,
    cancelling: cancel.open,
    changingPerformers: performers.open,
    history,
    details,
    performerHistory,
    notice,
    setNotice,
    openEdit: opener(edit),
    openCancel: opener(cancel),
    openPerformers: opener(performers),
    toggleHistory,
    toggleDetails,
    togglePerformerHistory,
    releaseEdit: edit.release,
    releaseCancel: cancel.release,
    releasePerformers: performers.release,
  };
}
