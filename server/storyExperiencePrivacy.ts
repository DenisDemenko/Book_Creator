/**
 * Conservative guard for direct identifiers before session material is persisted.
 * A heuristic cannot certify anonymization: false positives and missed indirect
 * identifiers remain possible. Explicit human review is still mandatory.
 */
export interface PrivacyIssue { field: string; category: string; }
const tests: Array<[string, RegExp]> = [
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['phone', /(?:\+?\d[\s().-]*){10,14}/],
  ['url', /\bhttps?:\/\/\S+/i],
  ['telegram', /(?:^|\s)@[a-zA-Z][\w]{4,}\b/],
  ['passport-id', /\b\d{9}\b/],
];
export function inspectApprovedExperience(events: Array<{label:string; description:string}>, title: string): PrivacyIssue[] {
  const fields = [{field:'title', value:title}, ...events.flatMap((e,i)=>[{field:'events.'+i+'.label',value:e.label},{field:'events.'+i+'.description',value:e.description}])];
  const issues: PrivacyIssue[] = [];
  for (const item of fields) for (const [category,pattern] of tests) if (pattern.test(item.value)) issues.push({field:item.field,category});
  return issues;
}

/** Draft redaction for human review only: never a certificate of anonymity. */
export function proposeExperienceRedactions(events: Array<{label:string;description:string}>, title:string) {
  const redact=(value:string)=>{
    let result=value;
    for(const [category,pattern] of tests) {
      const global=new RegExp(pattern.source, pattern.flags.includes('g')?pattern.flags:pattern.flags+'g');
      result=result.replace(global,'[приховано: '+category+']');
    }
    return result;
  };
  return {title:redact(title),events:events.map(event=>({label:redact(event.label),description:redact(event.description)})),
    issues:inspectApprovedExperience(events,title), requiresHumanReview:true as const};
}
