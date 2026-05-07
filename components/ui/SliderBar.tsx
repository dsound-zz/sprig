"use client";

export type SliderMode = "manual" | "suggest" | "auto";

type Props = {
  mode: SliderMode;
  onModeChange: (mode: SliderMode) => void;
};

// Maps discrete slider index (0/1/2) → mode
const INDEX_TO_MODE: SliderMode[] = ["manual", "suggest", "auto"];

function modeToIndex(mode: SliderMode): number {
  return INDEX_TO_MODE.indexOf(mode);
}

export function SliderBar({ mode, onModeChange }: Props) {
  const index = modeToIndex(mode);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const idx = Number(e.target.value);
    onModeChange(INDEX_TO_MODE[idx]);
  }

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 select-none"
      aria-label="Autopilot mode"
    >
      <span className="text-[10px] text-[#888880] dark:text-[#888880] font-mono opacity-70">
        manual
      </span>
      <input
        type="range"
        min={0}
        max={2}
        step={1}
        value={index}
        onChange={handleChange}
        className="w-24 accent-[#888880] cursor-pointer"
        aria-label="Autopilot slider"
      />
      <span className="text-[10px] text-[#888880] dark:text-[#888880] font-mono opacity-70">
        autopilot
      </span>
    </div>
  );
}
