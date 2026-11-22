import type { InputHTMLAttributes, ReactNode } from 'react';

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
      />
    </label>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{children}</p>;
}

export const primaryButton =
  'w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-50';
