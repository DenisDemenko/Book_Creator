export type VoiceCommand = {type:"text";text:string}|{type:"paragraph"|"chapter"|"dialogue"};
/** Voice commands are interpreted only with explicit command mode enabled. */
export function parseVoiceCommand(transcript:string,commandMode=false):VoiceCommand {
 if(!commandMode)return {type:"text",text:transcript};
 const normalized=transcript.trim().toLocaleLowerCase();
 const commands:Record<string,VoiceCommand>={
  "новий абзац":{type:"paragraph"},"new paragraph":{type:"paragraph"},
  "новий розділ":{type:"chapter"},"new chapter":{type:"chapter"},
  "почати діалог":{type:"dialogue"},"start dialogue":{type:"dialogue"},
  "крапка":{type:"text",text:"."},"кома":{type:"text",text:","},
  "знак питання":{type:"text",text:"?"},"знак оклику":{type:"text",text:"!"},
  "period":{type:"text",text:"."},"comma":{type:"text",text:","},
  "question mark":{type:"text",text:"?"},"exclamation mark":{type:"text",text:"!"}
 };
 return commands[normalized]??{type:"text",text:transcript};
}
