import { ApiError } from '../../../shared/errors.ts';
import { DocumentError } from '../use-cases/create-document-type/create-document-type.usecase.ts';

export async function documentHttpResult<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof DocumentError) throw new ApiError(error.code);
    throw error;
  }
}
