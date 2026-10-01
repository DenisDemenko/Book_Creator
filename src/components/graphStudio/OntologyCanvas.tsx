/**
 * «Ontology (Онтологія)» у Graph Studio — канва онтології (Т5.2 В4).
 * Поки — версії онтології на вкладці «Версії» і правка через API Т5.1.
 */
import React from 'react';
import type { GsAbilities } from './gsApi';

export const OntologyCanvas: React.FC<{ abilities: GsAbilities }> = () => (
  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-300" data-gs-ontology>
    Канва онтології — наступний етап (Т5.2 В4). Версії онтології твору й співпраці — на вкладці «Versions (Версії)».
  </div>
);
