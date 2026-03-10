const isProduction = process.env.NODE_ENV === 'production';
const s3Bucket = process.env.S3_UPLOADS_BUCKET;

export function usesS3Storage(): boolean {
  return isProduction && Boolean(s3Bucket);
}
