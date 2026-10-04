import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { personalCalls } from './personal-calls';

export function useEnrolPasskey(employeeId: string) {
  const cache = useQueryClient();
  const binding = useQuery({
    queryKey: ['personal-binding', employeeId],
    queryFn: personalCalls.binding,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  return {
    binding: binding.data,
    loading: binding.isPending,
    error: error || binding.isError,
    pending,
    enrol: async () => {
      if (pending) return;
      setPending(true);
      setError(false);
      try {
        await personalCalls.enrol();
        await cache.invalidateQueries({ queryKey: ['personal-binding', employeeId] });
      } catch {
        setError(true);
      } finally {
        setPending(false);
      }
    },
  };
}
