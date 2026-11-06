// فشل جمع الحمل ما ينفعش يطغى على رفض البيانات الأصلي.
export async function finishLoadArm(work, finish, recordErrors) {
  let originalError, collectionError, recordingError, value, load;
  let workFailed = false,
    collectionFailed = false;
  try {
    value = await work();
  } catch (error) {
    workFailed = true;
    originalError = error;
  }
  if (workFailed) {
    try {
      await recordErrors({ workFailed, originalError, collectionFailed, collectionError });
    } catch (error) {
      recordingError = error;
    }
  }
  try {
    load = await finish();
  } catch (error) {
    collectionFailed = true;
    collectionError = error;
  }
  try {
    await recordErrors({ workFailed, originalError, collectionFailed, collectionError });
  } catch (error) {
    recordingError = error;
  }
  if (workFailed) throw originalError;
  if (collectionFailed) throw collectionError;
  if (recordingError) throw recordingError;
  return { value, load };
}
