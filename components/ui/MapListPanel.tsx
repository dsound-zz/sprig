"use client";

import { useEffect, useRef, useState } from "react";

type MapSummary = {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type Props = {
  onMapSelect: (mapId: string) => void;
  onNewMap: () => void;
  /** Called after a map is deleted so the shell can clear currentMapId if needed */
  onMapDelete?: (mapId: string) => void;
  /** The map currently loaded on the canvas — used to highlight the active row */
  currentMapId?: string | null;
};

export function MapListPanel({
  onMapSelect,
  onNewMap,
  onMapDelete,
  currentMapId,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    loadMaps();
  }, [isOpen]);

  // Focus the rename input whenever we enter edit mode
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  async function loadMaps() {
    const res = await fetch("/api/maps");
    if (!res.ok) return;
    const data = (await res.json()) as { maps: MapSummary[] };
    setMaps(data.maps);
  }

  function startEdit(map: MapSummary) {
    setEditingId(map.id);
    setEditingTitle(map.title);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingTitle("");
  }

  async function commitEdit(mapId: string) {
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      cancelEdit();
      return;
    }

    // Optimistic update in local list
    setMaps((prev) =>
      prev.map((m) => (m.id === mapId ? { ...m, title: trimmed } : m))
    );
    cancelEdit();

    const res = await fetch(`/api/maps/${mapId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });

    if (!res.ok) {
      // Revert on failure by reloading the list
      await loadMaps();
    }
  }

  function handleDelete(mapId: string, title: string, e: React.MouseEvent) {
    // Stop the click from bubbling to the backdrop, which would close the panel
    // before the optimistic setMaps update renders.
    e.stopPropagation();
    e.preventDefault();

    // Defer the confirm dialog to allow React's synthetic event to finish processing.
    // This prevents the browser from instantly dismissing the dialog in some environments.
    setTimeout(async () => {
      if (!window.confirm(`Delete "${title || "untitled"}" and all its nodes?`)) return;

      // Remove from local list immediately (optimistic)
      setMaps((prev) => prev.filter((m) => m.id !== mapId));
      onMapDelete?.(mapId);

      const res = await fetch(`/api/maps/${mapId}`, { method: "DELETE" });
      if (!res.ok) {
        // Revert on failure
        await loadMaps();
      }
    }, 10);
  }

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
          onClick={() => {
            cancelEdit();
            setIsOpen(false);
          }}
        />
      )}

      {/* Slide-in panel */}
      <div
        className={`
          fixed left-0 top-0 h-full w-64 z-40
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

          <div className="flex-1 overflow-y-auto space-y-0.5">
            {maps.length === 0 && (
              <p className="text-[11px] font-mono text-[#888880] opacity-50">
                no maps yet
              </p>
            )}

            {maps.map((map) => {
              const isActive = map.id === currentMapId;
              const isEditing = map.id === editingId;

              return (
                <div
                  key={map.id}
                  className={`
                    group flex items-center gap-1 rounded px-2 py-1.5
                    ${isActive
                      ? "bg-[#CCCAC4]/25 dark:bg-[#3A3A38]/25"
                      : "hover:bg-[#CCCAC4]/15 dark:hover:bg-[#3A3A38]/15"
                    }
                    transition-colors duration-100
                  `}
                >
                  {isEditing ? (
                    /* ── Inline rename input ── */
                    <input
                      ref={editInputRef}
                      className="
                        flex-1 min-w-0
                        text-[12px] font-mono
                        text-[#1a1a18] dark:text-[#e8e8e4]
                        bg-transparent border-none outline-none
                      "
                      value={editingTitle}
                      maxLength={20}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitEdit(map.id);
                        } else if (e.key === "Escape") {
                          cancelEdit();
                        }
                      }}
                      onBlur={() => void commitEdit(map.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    /* ── Selectable title ── */
                    <button
                      className="
                        flex-1 min-w-0 text-left truncate
                        text-[12px] font-mono
                        text-[#1a1a18] dark:text-[#e8e8e4]
                      "
                      onClick={() => {
                        setIsOpen(false);
                        onMapSelect(map.id);
                      }}
                    >
                      {map.title || "untitled"}
                    </button>
                  )}

                  {/* ── Action icons (edit + delete) ── */}
                  {!isEditing && (
                    <span className="
                      flex items-center gap-1 shrink-0
                      opacity-0 group-hover:opacity-60
                      transition-opacity duration-100
                    ">
                      {/* Pencil / rename */}
                      <button
                        aria-label="Rename map"
                        className="
                          p-0.5 rounded
                          text-[#888880]
                          hover:text-[#1a1a18] dark:hover:text-[#e8e8e4]
                          hover:opacity-100
                          transition-colors duration-100
                        "
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(map);
                        }}
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M8.5 1.5l2 2L4 10H2v-2l6.5-6.5z" />
                        </svg>
                      </button>

                      {/* Trash / delete */}
                      <button
                        aria-label="Delete map"
                        className="
                          p-0.5 rounded
                          text-[#888880]
                          hover:text-red-400 dark:hover:text-red-400
                          hover:opacity-100
                          transition-colors duration-100
                        "
                        onClick={(e) => {
                          void handleDelete(map.id, map.title, e);
                        }}
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2 3h8M5 3V2h2v1M4.5 3v6.5h3V3" />
                          <path d="M3.5 3l.5 7h4l.5-7" />
                        </svg>
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
