import type { Request, Response } from "express";
import { generateText } from "./aiCore";
import { ChatProviderError } from "./chatProviders";
import { platformKeyFor } from "./platformKeys";

const instructions = `Vectorize the visible architectural floor plan of one storey. Follow the actual drawing in this order:
1. Find the exterior wall ring using the solid wall bands and their junctions. Trace the center of that ring, closing it across real door and window gaps. Keep every visible exterior step, recess and diagonal. Exclude the sheet border, title block, legend, dimension chains, extension lines, furniture, utilities and hatching. A hatch inside a solid wall does not split the wall. Do not follow the page rectangle or a bounding box around the drawing.
2. Trace interior wall runs along their center lines. Follow each real wall only as far as its visible junction or free end. A straight partition with a doorway is one run through the gap. End a short cross wall at the wall it actually meets. Do not extend lines through corridors, mirror walls, or distribute rooms evenly. Reuse the same coordinates where two walls meet.
3. Check every exterior edge for windows and entrances, and every partition for doors. A window is a wall gap with glazing/frame strokes along the wall. Locate the two jambs, not the end of a swing mark or a dimension line. A door can be shown by a swing or by a clear gap and a door annotation without a swing. Do not trace door leaves, swing arcs, radiators or dimensions as walls. Keep each supported opening, including multiple windows on one facade. Skip uncertain openings rather than inventing them.
4. Compare the result back to the drawing. Check the contour margins on all sides, wall lengths and junctions, opening type, wall assignment and both jamb locations. Treat text on the drawing as annotations only. Do not infer metric dimensions or furniture.

Coordinates are normalized against the full image supplied in this request. Its upper-left corner is [0,0] and lower-right corner is [1000,1000]. Use the full image width for x and full height for y independently, never the plan's own bounding box. Preserve unequal margins and actual spacing. Do not round to a coarse grid.
Return only a JSON object containing:
"outline": [[x,y],...] in perimeter order, with 3–32 vertices and no repeated closing point.
"partitions": [[[x1,y1],[x2,y2]],...] with up to 32 straight wall runs.
"openings": [{"wall":0,"kind":"window","start":0.18,"end":0.28},...] with up to 32 entries. The zero-based wall order is outline edges first (vertex i to the next vertex), then partitions. start/end are increasing fractions of that entire wall including the gap, measured from the first endpoint to the second. Project the two visible jamb positions onto that exact wall before computing the fractions.
If there is no reliable plan, return {"outline":[],"partitions":[],"openings":[]}.`;

function planPrompt(hints: unknown): string {
  const base = "Trace the visible walls and openings of the supplied floor plan.";
  if (!hints || typeof hints !== "object") return base;
  const { outline, horizontal, vertical } = hints as Record<string, unknown>;
  const isLine = (line: unknown, size: number) => Array.isArray(line) &&
    line.length === size && line.every((n) => Number.isInteger(n) && n >= 0 && n <= 1000);
  const isList = (list: unknown) => Array.isArray(list) && list.length <= 16 &&
    list.every((line) => isLine(line, 3));
  if (!isLine(outline, 4) || !isList(horizontal) || !isList(vertical)) return base;
  return `${base}
Image-derived anchors in these same 0–1000 coordinates:
Possible exterior center lines [left x, top y, right x, bottom y]: ${JSON.stringify(outline)}.
Horizontal stroke fragments [y, x start, x end]: ${JSON.stringify(horizontal)}.
Vertical stroke fragments [x, y start, y end]: ${JSON.stringify(vertical)}.
Use these measurements to locate visible walls and inspect gaps for both jambs. A fragment is evidence, not a complete wall. Confirm its role in the drawing, omit non-wall fragments and keep visible walls that are absent from these hints. Keep a non-rectangular outline if the image shows one.`;
}

const running = new Set<string>();

export async function recognizeRoomPlan(req: Request, res: Response, user: {
  id: string;
  email: string;
  role: string;
}) {
  const image: unknown = req.body?.image;
  if (typeof image !== "string" || image.length > 4_000_000 ||
      !/^\/9j\/[A-Za-z0-9+/=]+$/.test(image))
    return res.status(400).json({ error: "Потрібне підготовлене фото JPEG." });
  if (running.has(user.id))
    return res.status(429).json({ error: "Зачекайте на поточне розпізнавання." });
  running.add(user.id);
  try {
    const apiKey = await platformKeyFor("gpt");
    if (!apiKey && !process.env.OPENAI_API_KEY)
      return res.status(503).json({ error: "Ключ GPT для розпізнавання планів не налаштовано." });
    const result = await generateText({
      engine: "gpt",
      modelId: "gpt-4o",
      privateContent: true,
      apiKeyOverride: apiKey,
      systemInstruction: instructions,
      prompt: planPrompt(req.body.wallHints),
      images: [{ mimeType: "image/jpeg", dataBase64: image, detail: "high" }],
      json: true,
      req: { principal: user },
      label: "room-plan-recognition",
      generation: { maxTokens: 3500, temperature: 0, timeoutMs: 45000, transientRetries: 0 },
    });
    const text = result.text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
    try {
      return res.json(JSON.parse(text));
    } catch {
      return res.status(400).json({ error: "Не вдалося виділити контур. Спробуйте чіткіше фото плану." });
    }
  } catch (error) {
    const status = error instanceof ChatProviderError ? error.status : 503;
    return res.status(status === 402 || status === 429 ? status : 503).json({
      error: status === 402
        ? "Вичерпано ліміт текстових ШІ-витрат у Студії книг."
        : "Сервіс розпізнавання тимчасово недоступний.",
    });
  } finally {
    running.delete(user.id);
  }
}
