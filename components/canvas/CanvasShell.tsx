"use client";

import { useState, useEffect } from "react";
import { MindMapCanvas } from "./MindMapCanvas";
import { MapListPanel } from "@/components/ui/MapListPanel";
import { SliderBar, type SliderMode } from "@/components/ui/SliderBar";

type Props = {
  initialMapId: string | null;
  userId: string;
};

export function CanvasShell({ initialMapId, userId }: Props) {
  const [currentMapId, setCurrentMapId] = useState<string | null>(initialMapId);
  const [canvasKey, setCanvasKey] = useState<number>(0);
  const [sliderMode, setSliderMode] = useState<SliderMode>("manual");
  // Auto-mode depth limit (1–5); default 3. Only shown in auto mode.
  const [autoDepth, setAutoDepth] = useState<number>(3);

  // Restore settings from localStorage on client mount
  useEffect(() => {
    const savedMode = localStorage.getItem("sprig_sliderMode");
    const savedDepth = localStorage.getItem("sprig_autoDepth");
    if (savedMode === "manual" || savedMode === "suggest" || savedMode === "auto") {
      setSliderMode(savedMode);
    }
    if (savedDepth) {
      const parsed = parseInt(savedDepth, 10);
      if (parsed >= 1 && parsed <= 5) setAutoDepth(parsed);
    }
  }, []);

  const handleModeChange = (mode: SliderMode) => {
    setSliderMode(mode);
    localStorage.setItem("sprig_sliderMode", mode);
  };

  const handleDepthChange = (depth: number) => {
    setAutoDepth(depth);
    localStorage.setItem("sprig_autoDepth", depth.toString());
  };

  function handleMapSelect(mapId: string) {
    setCurrentMapId(mapId);
    setCanvasKey(k => k + 1);
  }

  function handleNewMap() {
    setCurrentMapId(null);
    setCanvasKey(k => k + 1);
  }

  function handleMapDelete(mapId: string) {
    // If the deleted map is the one currently on the canvas, clear it
    if (mapId === currentMapId) {
      setCurrentMapId(null);
      setCanvasKey(k => k + 1);
    }
  }

  return (
    <>
      <MapListPanel
        onMapSelect={handleMapSelect}
        onNewMap={handleNewMap}
        onMapDelete={handleMapDelete}
        currentMapId={currentMapId}
      />
      <MindMapCanvas
        key={canvasKey}
        initialMapId={currentMapId}
        userId={userId}
        sliderMode={sliderMode}
        autoDepth={autoDepth}
        onMapCreated={(id) => setCurrentMapId(id)}
      />
      <SliderBar mode={sliderMode} onModeChange={handleModeChange} />

      {/* Depth selector — only visible in auto mode */}
      {sliderMode === "auto" && (
        <div
          className="fixed bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2"
          aria-label="Auto-expand depth"
        >
          <span className="text-[10px] text-[#888880] font-mono opacity-70">depth</span>
          {[2, 3].map((d) => (
            <button
              key={d}
              onClick={() => handleDepthChange(d)}
              className={`
                px-2 py-0.5 rounded transition-colors duration-100
                ${autoDepth === d
                  ? "bg-[#EAE8E4] dark:bg-[#2A2A28] text-[#1a1a18] dark:text-[#e8e8e4]"
                  : "text-[#888880] hover:text-[#1a1a18] dark:hover:text-[#e8e8e4]"
                }
              `}
              aria-pressed={autoDepth === d}
            >
              {d}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
