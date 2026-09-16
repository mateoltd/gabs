import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
export async function readExport(key: string) {
  if (process.env.EXPORT_BUCKET) {
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const result = await new S3Client({}).send(
      new GetObjectCommand({ Bucket: process.env.EXPORT_BUCKET, Key: key }),
    );
    return await result.Body!.transformToString();
  }
  if (process.env.NODE_ENV === "production")
    throw Error("Private EXPORT_BUCKET is required in production");
  const root = resolve(process.env.EXPORT_DIRECTORY ?? ".local/exports"),
    path = resolve(root, key);
  if (!path.startsWith(root + sep)) throw Error("Invalid object key");
  return readFile(path, "utf8");
}
