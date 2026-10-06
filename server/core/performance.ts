/** Process-local, bounded metadata only. Never accept text, IDs or model responses. */
export const PERF_NAMES = ['profile_hit','profile_build','snapshot_hit','snapshot_build','jev_call','jev_hit_strategic','jev_hit_scene','jev_hit_tactical','fallback_call','decision','rejected_decision','continuity_violation','causality_violation','tokens','cost_usd','ai_call','ai_error','queue_wait_ms','operation_ms','operation_count'] as const;
type Metric = typeof PERF_NAMES[number];
const totals = Object.fromEntries(PERF_NAMES.map(name => [name,0])) as Record<Metric,number>;
const latencies:number[]=[];
const startedAt = new Date().toISOString();
export function metric(name:Metric,value=1){if(PERF_NAMES.includes(name)&&Number.isFinite(value)&&value>=0){totals[name]+=value;if(name==='operation_ms'){latencies.push(value);if(latencies.length>512)latencies.shift();}};}
export function performanceReport(){const ordered=[...latencies].sort((a,b)=>a-b);return {latency:{samples:ordered.length,averageMs:ordered.length?ordered.reduce((a,b)=>a+b,0)/ordered.length:null,p95Ms:ordered.length?ordered[Math.ceil(ordered.length*.95)-1]:null},startedAt,scope:'current_process',totals:{...totals},fallbackShare:totals.decision?totals.fallback_call/totals.decision:null};}
