import React, { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Mic, MicOff } from 'lucide-react';
import { parseVoiceCommand } from '../utils/voiceDictation';

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type SpeechRecognizer = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognizer;
  webkitSpeechRecognition?: new () => SpeechRecognizer;
};

export function VoiceDictationButton({ editor, language = 'uk-UA' }: { editor: Editor | null; language?: string }) {
  const [listening, setListening] = useState(false);
  const [commandMode, setCommandMode] = useState(false);
  const [error, setError] = useState('');
  const recognition = useRef<SpeechRecognizer | null>(null);
  const editorRef = useRef(editor);
  const commandRef = useRef(commandMode);
  useEffect(() => { editorRef.current = editor; }, [editor]);
  useEffect(() => { commandRef.current = commandMode; }, [commandMode]);
  useEffect(() => () => { if (recognition.current) { recognition.current.onend = null; recognition.current.stop(); } }, []);

  const toggle = () => {
    if (recognition.current) {
      recognition.current.stop();
      recognition.current = null;
      setListening(false);
      return;
    }
    const browser = window as SpeechWindow;
    const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Recognition) {
      setError('Розпізнавання мовлення недоступне в цьому браузері.');
      return;
    }
    const instance = new Recognition();
    instance.lang = language;
    instance.continuous = true;
    instance.interimResults = false;
    instance.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const action = parseVoiceCommand(result[0].transcript, commandRef.current);
        const active = editorRef.current;
        if (!active || !active.isEditable) continue;
        if (action.type === 'text') active.chain().focus().insertContent(action.text + (/[.!?]$/.test(action.text) ? ' ' : ' ')).run();
        else if (action.type === 'paragraph') active.chain().focus().insertContent('<p></p>').run();
        else if (action.type === 'chapter') active.chain().focus().insertContent('<h2>Новий розділ</h2><p></p>').run();
        else active.chain().focus().insertContent('— ').run();
      }
    };
    instance.onerror = event => { setError('Мікрофон: ' + event.error); };
    instance.onend = () => { recognition.current = null; setListening(false); };
    try { instance.start(); recognition.current = instance; setListening(true); setError(''); }
    catch { setError('Не вдалося запустити мікрофон.'); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 p-2" aria-label="Голосовий набір">
      <button type="button" onClick={toggle} disabled={!editor?.isEditable}
        aria-pressed={listening} title={listening ? 'Зупинити диктування' : 'Почати диктування'}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm">
        {listening ? <MicOff size={16}/> : <Mic size={16}/>}
        {listening ? 'Зупинити' : 'Диктувати'}
      </button>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={commandMode} onChange={e => setCommandMode(e.target.checked)}/>
        Голосові команди
      </label>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
