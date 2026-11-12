'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

export function leaveScopeKey(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
): string[] {
  return ['leave', companyId, businessId, userId, employeeId];
}

export function useLeaveScopeEviction(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
  openDenied: boolean,
) {
  const client = useQueryClient();
  useEffect(() => {
    const key = leaveScopeKey(companyId, businessId, userId, employeeId);
    return () => client.removeQueries({ queryKey: key });
  }, [client, companyId, businessId, userId, employeeId]);
  useEffect(() => {
    if (openDenied) {
      client.removeQueries({
        queryKey: leaveScopeKey(companyId, businessId, userId, employeeId),
      });
    }
  }, [client, companyId, businessId, userId, employeeId, openDenied]);
}
