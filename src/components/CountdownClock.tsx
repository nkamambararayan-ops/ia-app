import React from 'react';
import { getTimeRemaining, pad2 } from '../lib/time';

interface CountdownClockProps {
  targetIso: string;
  createdIso?: string;
  nowMs: number;
  variant?: 'hero' | 'compact';
  accentColor?: string;
}

export const CountdownClock: React.FC<CountdownClockProps> = ({
  targetIso,
  createdIso,
  nowMs,
  variant = 'compact',
  accentColor = '#007aff',
}) => {
  const t = getTimeRemaining(targetIso, createdIso, nowMs);

  if (variant === 'compact') {
    if (t.isExpired) {
      return (
        <div className="font-mono tabular-nums text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          Événement atteint
        </div>
      );
    }

    return (
      <div className="space-y-2.5">
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { val: String(t.days), label: 'J' },
            { val: pad2(t.hours), label: 'H' },
            { val: pad2(t.minutes), label: 'M' },
            { val: pad2(t.seconds), label: 'S' },
          ].map((unit) => (
            <div
              key={unit.label}
              className="rounded-[12px] bg-slate-900/[0.045] dark:bg-white/[0.06] py-1.5 px-1"
            >
              <div className="font-mono tabular-nums text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                {unit.val}
              </div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {unit.label}
              </div>
            </div>
          ))}
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-900/[0.07] dark:bg-white/[0.1] overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              width: `${t.progressPercent}%`,
              backgroundColor: accentColor,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {t.isExpired ? (
        <div className="rounded-[20px] border border-emerald-500/25 bg-emerald-500/10 backdrop-blur-xl px-5 py-4">
          <div className="text-lg font-semibold text-emerald-800 dark:text-emerald-300">
            Le compte à rebours est arrivé à échéance
          </div>
          <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-1">
            Vous pouvez archiver cet événement ou ajuster une nouvelle date cible.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3 sm:gap-4">
            {[
              { val: String(t.days), label: t.days > 1 ? 'Jours' : 'Jour' },
              { val: pad2(t.hours), label: t.hours > 1 ? 'Heures' : 'Heure' },
              { val: pad2(t.minutes), label: t.minutes > 1 ? 'Minutes' : 'Minute' },
              { val: pad2(t.seconds), label: t.seconds > 1 ? 'Secondes' : 'Seconde' },
            ].map((unit) => (
              <div
                key={unit.label}
                className="ios-glass-subtle rounded-[20px] py-4 px-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              >
                <div className="font-mono tabular-nums text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  {unit.val}
                </div>
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
                  {unit.label}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Progression temporelle</span>
              <span className="font-mono tabular-nums font-medium text-slate-700 dark:text-slate-200">
                {t.progressPercent.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-900/[0.07] dark:bg-white/[0.1] overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{
                  width: `${t.progressPercent}%`,
                  backgroundColor: accentColor,
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
