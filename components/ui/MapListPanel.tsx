"use client";

import { useEffect, useState } from "react";

type MapSummary = {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type Props = {
  onMapSelect: (mapId: string) => void;
  onNewMap: () => void;
};

export function MapListPanel({ onMapSelect, onNewMap }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [maps, setMaps] = useState<MapSummary[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    async function loadMaps() {
      const res = await fetch("/api/maps");
      if (!res.ok) return;
      const data = (await res.json()) as { maps: MapSummary[] };
      setMaps(data.maps);
    }

    loadMaps();
  }, [isOpen]);

  return (
    <>
      {/* Hamburger trigger */}
      <button
        className="
          fixed top-4 left-4 z-20
          text-[#1a1a18] dark:text-[#e8e8e4]
          opacity-30 hover:opacity-70
          transition-opacity duration-150
          p-1
        "
        onClick={() => setIsOpen(true)}
        aria-label="Open map list"
      >
        <svg
          width="18"
          height="14"
          viewBox="0 0 18 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <line x1="0" y1="1" x2="18" y2="1" />
          <line x1="0" y1="7" x2="18" y2="7" />
          <line x1="0" y1="13" x2="18" y2="13" />
        </svg>
      </button>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Slide-in panel */}
      <div
        className={`
          fixed left-0 top-0 h-full w-60 z-40
          bg-[#FAFAF8] dark:bg-[#111110]
          border-r border-[#CCCAC4]/30 dark:border-[#3A3A38]/30
          transition-transform duration-200 ease-out
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex flex-col h-full pt-12 pb-6 px-5">
          <button
            className="
              text-[11px] font-mono text-left mb-6
              text-[#888880] hover:text-[#1a1a18] dark:hover:text-[#e8e8e4]
              transition-colors duration-100
              border border-[#CCCAC4] dark:border-[#3A3A38]
              px-3 py-1.5 rounded
            "
            onClick={() => {
              setIsOpen(false);
              onNewMap();
            }}
          >
            + new map
          </button>

          <div className="flex-1 overflow-y-auto space-y-1">
            {maps.length === 0 && (
              <p className="text-[11px] font-mono text-[#888880] opacity-50">
                no maps yet
              </p>
            )}
            {maps.map((map) => (
              <button
                key={map.id}
                className="
                  w-full text-left px-2 py-1.5 rounded
                  text-[12px] font-mono
                  text-[#1a1a18] dark:text-[#e8e8e4]
                  hover:bg-[#CCCAC4]/20 dark:hover:bg-[#3A3A38]/20
                  transition-colors duration-100
                "
                onClick={() => {
                  setIsOpen(false);
                  onMapSelect(map.id);
                }}
              >
                {map.title || "untitled"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
