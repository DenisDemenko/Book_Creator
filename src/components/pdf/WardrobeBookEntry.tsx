import React,{useEffect,useState} from 'react';
import {useAuth} from '../../hooks/useAuth';
import {AuthScreen} from '../AuthScreen';
import {API_BASE} from '../../utils/basePath';
import {cacheBookFromServer,loadBook,saveBook} from '../../utils/storage';
import type {Book} from '../../types';
import WardrobeDocumentEditor from './WardrobeDocumentEditor';

/** Server-owned document links must not enter the legacy local-only hydration. */
export function WardrobeBookEntry({documentId}:{documentId:string}){
  const auth=useAuth(),[loaded,setLoaded]=useState<{userId:string;book:Book}|null>(null),[error,setError]=useState('');
  const userId=auth.user?.id;
  useEffect(()=>{if(auth.loading||!userId||auth.isGuest)return;let cancelled=false;const abort=new AbortController();setError('');
    void(async()=>{try{
      const response=await fetch(`/api/books/${encodeURIComponent(documentId)}`,{credentials:'same-origin',signal:abort.signal});if(!response.ok)throw Error('Документ не знайдено у вашому акаунті або немає доступу.');
      const stored=await response.json();if(stored.book?.id!==documentId||!stored.book.wardrobeDocument||!Number.isInteger(stored.revision))throw Error('Сервер повернув неповний документ.');
      const local=await loadBook(documentId).catch(()=>undefined);if(cancelled)return;
      const book=local?.wardrobeDocument?.dirty?local:{...stored.book,wardrobeDocument:{...stored.book.wardrobeDocument,cloudRevision:stored.revision,dirty:false}};
      if(!local?.wardrobeDocument?.dirty)await cacheBookFromServer(book,stored.revision).catch(()=>undefined);
      if(!cancelled)setLoaded({userId,book});
    }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Документ недоступний.');}})();
    return()=>{cancelled=true;abort.abort();};
  },[auth.loading,auth.isGuest,userId,documentId]);
  if(auth.loading)return <p className="p-6">Перевіряємо вхід…</p>;
  if(auth.isGuest)return <AuthScreen onLogin={auth.login} onRegister={auth.register} onLoginWithGoogle={auth.loginWithGoogle} onContinueAsGuest={()=>{auth.continueAsGuest();location.assign(API_BASE||'/');}} onClearError={auth.clearError} error={auth.error} firebaseEnabled={auth.firebaseEnabled}/>;
  const book=loaded?.userId===userId?loaded.book:null;
  return <main className="flex min-h-screen flex-col bg-slate-900 text-slate-100">
    <header className="border-b border-slate-700 p-3"><a className="underline" href={`${API_BASE}/projects/${encodeURIComponent(documentId)}/dashboard`}>← Книги та документи Студії</a></header>
    {error&&<p role="alert" className="p-4 text-rose-300">{error}</p>}
    {!book&&!error&&<p role="status" className="p-5">Завантажуємо приватний документ із Книг…</p>}
    {book&&<WardrobeDocumentEditor key={userId+':'+book.id} book={book} onUpdateBook={next=>{setLoaded({userId:userId!,book:next});void saveBook(next).catch(e=>setError('Локальна чернетка не збереглася: '+(e instanceof Error?e.message:'помилка сховища')));}}/>}
  </main>;
}
