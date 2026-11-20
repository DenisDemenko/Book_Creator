import type { GoogleGenAI } from "@google/genai";

type AccessCheck = { expiresAt: number; available: Promise<boolean> };

/** Room Studio checks model metadata. This endpoint does not generate images. */
export function createRoomGeminiImageAccess(
  getClients: () => Promise<Array<GoogleGenAI | null>>,
) {
  const checks = new WeakMap<GoogleGenAI, Map<string, AccessCheck>>();

  const clientChecks = (client: GoogleGenAI) => {
    let existing = checks.get(client);
    if (!existing) {
      existing = new Map();
      checks.set(client, existing);
    }
    return existing;
  };

  const hasAccess = (client: GoogleGenAI, model: string) => {
    const byModel = clientChecks(client);
    const cached = byModel.get(model);
    if (cached && cached.expiresAt > Date.now()) return cached.available;

    // Cache the in-flight probe so simultaneous quotes share the same request.
    const check: AccessCheck = {
      expiresAt: Date.now() + 5_000,
      available: client.models
        .get({
          model,
          config: { httpOptions: { timeout: 2_000, retryOptions: { attempts: 1 } } },
        })
        .then(
          ({ supportedActions }) => {
            const canGenerate = !supportedActions?.length || supportedActions.includes("generateContent");
            check.expiresAt = Date.now() + (canGenerate ? 60_000 : 20_000);
            return canGenerate;
          },
          () => {
            check.expiresAt = Date.now() + 20_000;
            return false;
          },
        ),
    };
    byModel.set(model, check);
    return check.available;
  };

  return {
    async resolve(models: readonly string[]) {
      const available = new Map<string, GoogleGenAI>();
      if (!models.length) return available;
      const clients = [...new Set(await getClients())].filter(
        (client): client is GoogleGenAI => client !== null,
      );
      await Promise.all(models.map(async (model) => {
        for (const client of clients) {
          if (await hasAccess(client, model)) {
            available.set(model, client);
            break;
          }
        }
      }));
      return available;
    },
    reject(client: GoogleGenAI, model: string) {
      // A key may see model metadata and still be denied image generation.
      // Omit that key for this model on the next quote. Never replay this job.
      clientChecks(client).set(model, {
        expiresAt: Date.now() + 5 * 60_000,
        available: Promise.resolve(false),
      });
    },
  };
}
