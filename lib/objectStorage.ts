import "server-only";
import { S3Client } from "@aws-sdk/client-s3";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const FILES_BUCKET = "assets";

export const objectStorage = new S3Client({
  endpoint: requiredEnv("AWS_ENDPOINT_URL_S3"),
  region: requiredEnv("AWS_REGION"),
  credentials: {
    accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY"),
  },
  forcePathStyle: true,
});
