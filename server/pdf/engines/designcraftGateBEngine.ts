import { designcraftEngine as rawDesigncraftEngine } from './designcraftEngine';
import type { PdfEngine } from './types';

/**
 * Compatibility shim used while Gate B validates the rest of the pipeline.
 * Studio calls book justification `justify`; DesignCraft calls the same
 * family of modes `leftJustified`. The raw adapter currently accepts only
 * Studio's union and maps `justify` too literally, so for the live probe we
 * choose a valid ragged-left fallback instead of letting the whole build die.
 *
 * This shim deliberately reports honoredSpec=false when it has to do that;
 * it is not allowed to pretend the requested typography was honoured.
 */
export const designcraftGateBEngine: PdfEngine = {
  ...rawDesigncraftEngine,
  async render(request) {
    const wanted = request.spec?.bodyAlign;
    const result = await rawDesigncraftEngine.render({
      ...request,
      spec: { ...(request.spec || {}), bodyAlign: wanted === 'justify' ? 'left' : wanted },
    });
    if (wanted !== 'justify') return result;
    return {
      ...result,
      honoredSpec: false,
      notesUk: [
        ...result.notesUk,
        'Gate B: вирівнювання justify тимчасово виконано як left; перед merge цей compatibility fallback має бути прибраний.',
      ],
    };
  },
};
