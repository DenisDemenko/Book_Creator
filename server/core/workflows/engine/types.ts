/**
 * Рушій процесів ШІ — спільні типи (Т5.4 В1, `PLAN_WORKFLOW_ENGINE.md`).
 */

import type { CoreActor, CoreRepository, WorkflowRunRow } from '../../types';
import type { WorkflowDefinition, WorkflowNode } from '../../../../src/utils/workflowGraph';
import type { AiGenerateInput, AiGenerateOutput } from '../../ai/roles';
import type { CoreAiModule } from '../../ai/rolePrompts';
import type { JevAdapter } from '../../../ai/adapters/jev';

/** Стан процесу: один об'єкт, який вузли доповнюють. Серіалізовний (контрольні точки). */
export interface WfState {
  input: Record<string, unknown>;
  /** Дані прив'язки й вузлів (контекст, знайдене тощо). */
  vars: Record<string, unknown>;
  prompt?: { system: string; user: string; module?: string; promptVersion?: string };
  llm?: { text: string; model: string; engine?: string; tokensIn: number; tokensOut: number; costUsd: number };
  output?: unknown;
  confidence?: number | null;
  validation?: { ok: boolean; errors: string[] };
  result?: Record<string, unknown>;
  /** Гілка, яку обрав останній вузол (для умовних ребер). */
  branch?: string;
  /** Скільки вузлів уже виконано (для відгалуження від кроку). */
  steps: number;
  /** Сумарна вартість запуску, $ (ліміт витрат вузлів LLM). */
  cost: number;
}

/** Що вузол повертає рушію: зміни стану, гілку, рядок трасування. */
export interface NodeOutcome {
  patch?: Partial<WfState>;
  branch?: string;
  trace?: StepTrace;
}

export interface StepTrace {
  model?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  decision?: string | null;
  confidence?: number | null;
  validationResult?: string | null;
  humanResult?: string | null;
  retryCount?: number;
  warnings?: string[];
  details?: Record<string, unknown>;
}

export type NodeExecutor = (node: WorkflowNode, state: WfState, env: ExecEnv) => Promise<NodeOutcome>;

/** Інструмент вузла TOOL: платформи чи прив'язки. */
export type ToolFn = (node: WorkflowNode, state: WfState, env: ExecEnv) => Promise<NodeOutcome>;

/** Виконавці прив'язки процесу (AI-1, AI-2, голос героя): свої кроки поверх загальних. */
export interface BindingRuntime {
  executors: Partial<Record<string, NodeExecutor>>;
  tools?: Record<string, ToolFn>;
  /** Запуск упав: прибрати за собою (закрити `analysis_runs` тощо). */
  onFailure?: (state: WfState, error: Error, env: ExecEnv) => Promise<void>;
  /** Модуль «Ядра AI» для обліку витрат вузла LLM, якщо PROMPT його не задав. */
  module?: CoreAiModule;
}

/** Прив'язка: з входу запуску (серіалізовного) відновлює середовище кроків. */
export interface BindingDef {
  workflowId: string;
  prepare(ctx: { repo: CoreRepository; run: WorkflowRunRow; input: Record<string, unknown>; services: EngineServices; extras?: Record<string, unknown> }): Promise<BindingRuntime>;
}

/** Залежності рушія від Студії (у тестах — підставні). */
export interface EngineServices {
  canWriteCanon?: (actor:CoreActor,projectId:string,reviewer?:string)=>Promise<boolean>;
  generate: (input: AiGenerateInput) => Promise<AiGenerateOutput>;
  resolveModel: (module: CoreAiModule) => Promise<string | undefined>;
  loadTemplate?: (module: CoreAiModule) => Promise<{ system: string; user: string } | undefined>;
  /** Пауза між повторами (тести — миттєво). */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Т5.5: справжній Jev (ключ платформи чи `TYPESAFE_API_KEY`); null — ключа
   * немає, вузли Jev ідуть запасним LLM (модуль AI-2 через `generate`).
   */
  jev?: () => Promise<JevAdapter | null>;
  now?: () => number;
}

export interface ExecEnv {
  repo: CoreRepository;
  run: WorkflowRunRow;
  definition: WorkflowDefinition;
  services: EngineServices;
  binding: BindingRuntime | null;
  actor: CoreActor;
  /** Списання з бюджету задачі черги (Т0.7), якщо запуск — у задачі. */
  recordUsage?: (usage: { tokens: number; requests: number }) => Promise<void>;
  signal?: AbortSignal;
  /** Т5.5: рушій цього запуску — для підпроцесів (SUBGRAPH, маршрутизатор Jev із реєстром). */
  engine?: import('./runner').EngineDeps;
}

/** Помилка вузла з класом (для §30 і трасування). */
export class NodeError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_executable' | 'bad_input' | 'timeout' | 'provider' | 'cost_limit' | 'schema' | 'binding',
    readonly trace: StepTrace = {},
  ) {
    super(message);
    this.name = 'NodeError';
  }
}
