import { RATING_TOKEN_HEADER, type SubmitRatingInput } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ratingClient } from '../../shared/api/client';

export class RatingRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function useRating(token: string) {
  const queryClient = useQueryClient();
  const params = { header: { [RATING_TOKEN_HEADER]: token } };
  const { view, linkUnavailable } = useRatingView(token);
  const submit = useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: async (body: SubmitRatingInput) => {
      const requestBody =
        body.comment === undefined
          ? { stars: body.stars }
          : { stars: body.stars, comment: body.comment };
      const response = await ratingClient().POST('/v1/ratings/submit', {
        params,
        body: requestBody,
      });
      if (response.error) throw new RatingRequestError(response.error.code);
    },
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ['rating-view'] });
      queryClient.setQueryData(['rating-view'], (previous: typeof view.data) =>
        previous ? { business_name: previous.business_name, state: 'submitted' } : previous,
      );
    },
    // الرد المفقود ممكن يكون اتسجّل؛ قراءة الحالة تمنع إعادة عرض نموذج لرابط مستهلك.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['rating-view'] });
    },
  });
  const optOut = useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: async () => {
      const response = await ratingClient().POST('/v1/ratings/opt-out', { params });
      if (response.error) throw new RatingRequestError(response.error.code);
    },
  });
  return { view, submit, optOut, linkUnavailable };
}

function useRatingView(token: string) {
  const [linkUnavailable, setLinkUnavailable] = useState(false);
  const view = useQuery({
    queryKey: ['rating-view'],
    enabled: token.length > 0,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const response = await ratingClient().GET('/v1/ratings/view', {
        params: { header: { [RATING_TOKEN_HEADER]: token } },
        signal,
      });
      // عدم الإتاحة المؤكد بالقراءة نهائي لهذه الجلسة؛ خطأ إرسال متعارض يظل قابلًا للمصالحة.
      if (response.error?.code === 'RATING_LINK_UNAVAILABLE') setLinkUnavailable(true);
      if (response.error) throw new RatingRequestError(response.error.code);
      return { business_name: response.data.business_name, state: response.data.state };
    },
  });
  return { view, linkUnavailable };
}
