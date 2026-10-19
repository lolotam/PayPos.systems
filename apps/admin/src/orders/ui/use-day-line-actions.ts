'use client';
import { useRef, useState } from 'react';

type OpenEditor = { key: string; token: number };

export function useDayLineActions() {
  const editorToken = useRef(0);
  const cancelToken = useRef(0);
  const [editing, setEditing] = useState<OpenEditor | null>(null);
  const [cancelling, setCancelling] = useState<OpenEditor | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const openEdit = (visitId: string, lineId: string) => {
    const key = `${visitId}:${lineId}`;
    setNotice(null);
    setCancelling(null);
    if (editing?.key === key) return;
    editorToken.current += 1;
    setEditing({ key, token: editorToken.current });
  };
  const openCancel = (visitId: string, lineId: string) => {
    const key = `${visitId}:${lineId}`;
    setNotice(null);
    setEditing(null);
    if (cancelling?.key === key) return;
    cancelToken.current += 1;
    setCancelling({ key, token: cancelToken.current });
  };
  const toggleHistory = (visitId: string, lineId: string) => {
    const key = `${visitId}:${lineId}`;
    setHistory((current) => (current === key ? null : key));
  };
  const toggleDetails = (visitId: string, lineId: string) => {
    const key = `${visitId}:${lineId}`;
    setDetails((current) => (current === key ? null : key));
  };
  const releaseEdit = (key: string, token: number) => {
    setEditing((current) => (current?.key === key && current.token === token ? null : current));
  };
  const releaseCancel = (key: string, token: number) => {
    setCancelling((current) => (current?.key === key && current.token === token ? null : current));
  };
  return {
    editing,
    cancelling,
    history,
    details,
    notice,
    setNotice,
    openEdit,
    openCancel,
    toggleHistory,
    toggleDetails,
    releaseEdit,
    releaseCancel,
  };
}
