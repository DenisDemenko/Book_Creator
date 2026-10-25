import React from 'react';

/** Fusion Lab marketplace visual language for Story & Experience screens. */
export const storyUi={
  page:'min-h-0 flex-1 overflow-y-auto bg-[#F4ECE1] p-4 text-[#2C1A12] sm:p-6',
  card:'rounded-2xl border border-[#E0D4C7] bg-[#FFFCF8] p-4 shadow-[0_3px_16px_rgba(44,26,18,0.045)] sm:p-5',
  field:'w-full rounded-xl border border-[#CDBBAA] bg-white px-3 py-2.5 text-sm text-[#2C1A12] placeholder:text-[#917F70] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B5937]',
  primary:'inline-flex min-h-10 items-center justify-center rounded-xl bg-[#2E1B12] px-4 py-2 text-sm font-semibold text-[#FFF9F1] hover:bg-[#4A2B1C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B5937] disabled:cursor-not-allowed disabled:opacity-40',
  secondary:'inline-flex min-h-10 items-center justify-center rounded-xl border border-[#CDBBAA] bg-[#FFFCF8] px-4 py-2 text-sm font-semibold text-[#2C1A12] hover:bg-[#F0E6DA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B5937] disabled:cursor-not-allowed disabled:opacity-40',
  muted:'text-sm leading-relaxed text-[#71645A]',
} as const;

export const StorySurfaceCard:React.FC<React.PropsWithChildren<{className?:string}>>=({children,className=''})=><div className={storyUi.card+' '+className}>{children}</div>;
export const StorySectionHeading:React.FC<{title:string;description?:string}>=({title,description})=><header className="mb-5"><h2 className="text-2xl font-bold tracking-tight text-[#2C1A12] sm:text-3xl">{title}</h2>{description&&<p className={'mt-2 '+storyUi.muted}>{description}</p>}</header>;
