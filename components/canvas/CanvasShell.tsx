"use client";

import { useState } from "react";
import { MindMapCanvas } from "./MindMapCanvas";
import { MapListPanel } from "@/components/ui/MapListPanel";

type Props = {
  initialMapId: string | null;
  userId: string;
};

export function CanvasShell({ initialMapId, userId }: Props) {
  const [currentMapId, setCurrentMapId] = useState<string | null>(initialMapId);

  function handleMapSelect(mapId: string) {
    setCurrentMapId(mapId);
  }

  function handleNewMap() {
    setCurrentMapId(null);
  }

  function handleMapDelete(mapId: string) {
    // If the deleted map is the one currently on the canvas, clear it
    if (mapId === currentMapId) {
      setCurrentMapId(null);
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
        key={currentMapId ?? "new"}
        initialMapId={currentMapId}
        userId={userId}
      />
    </>
  );
}
