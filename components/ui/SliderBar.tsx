"use client";

export function SliderBar() {
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 pointer-events-none select-none"
      aria-hidden="true"
    >
      <span className="text-[10px] text-[#888880] dark:text-[#888880] opacity-50 font-mono">
        manual
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        defaultValue={0.5}
        disabled
        className="w-24 accent-[#888880] opacity-30 cursor-not-allowed"
      />
      <span className="text-[10px] text-[#888880] dark:text-[#888880] opacity-50 font-mono">
        autopilot
      </span>
    </div>
  );
}
