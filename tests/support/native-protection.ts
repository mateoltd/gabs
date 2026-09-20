import type { ElectronApplication } from "@playwright/test";

/** Controlled OS adapter for storage/UI acceptance. Never evidence of actual OS protection. */
export async function controlledNativeProtection(
  app: ElectronApplication,
  key: string,
  previousKey?: string,
) {
  await app.evaluate(
    async ({ safeStorage, systemPreferences }, { key, previousKey }) => {
      const { createCipheriv, createDecipheriv, randomBytes } =
        process.getBuiltinModule("node:crypto");
      const secret = Buffer.from(key, "hex");
      safeStorage.isEncryptionAvailable = () => true;
      safeStorage.isAsyncEncryptionAvailable = async () => true;
      safeStorage.encryptStringAsync = async (text) => {
        const iv = randomBytes(12),
          cipher = createCipheriv("aes-256-gcm", secret, iv);
        const bytes = Buffer.concat([
          cipher.update(text, "utf8"),
          cipher.final(),
        ]);
        return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
      };
      safeStorage.decryptStringAsync = async (bytes) => {
        const decrypt = (secret: Buffer) => {
          const cipher = createDecipheriv(
            "aes-256-gcm",
            secret,
            bytes.subarray(0, 12),
          );
          cipher.setAuthTag(bytes.subarray(12, 28));
          return Buffer.concat([
            cipher.update(bytes.subarray(28)),
            cipher.final(),
          ]).toString();
        };
        try {
          return { result: decrypt(secret), shouldReEncrypt: false };
        } catch (error) {
          if (!previousKey) throw error;
          return {
            result: decrypt(Buffer.from(previousKey, "hex")),
            shouldReEncrypt: true,
          };
        }
      };
      if (process.platform === "darwin")
        systemPreferences.canPromptTouchID = () => false;
    },
    { key, previousKey },
  );
}
