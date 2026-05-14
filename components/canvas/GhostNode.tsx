"use client";

import { useRef, useEffect, useState } from "react";
import { Handle, Position } from "reactflow";
import type { NodeProps } from "reactflow";

export type GhostNodeData = {
  label: string;
  /** When true the ghost is in "replace" mode — inline edit input shown */
  isReplacing?: boolean;
  /** Called when the user accepts the current label */
  onKeep?: () => void;
  /** Called when the user wants to replace — enters inline edit */
  onReplace?: () => void;
  /** Called when a replacement label is confirmed */
  onReplaceConfirm?: (label: string) => void;
  /** Whether this ghost is currently being expanded (pulsing ring) */
  isExpanding?: boolean;
  /** Used to determine Handle orientation */
  outwardAngle?: number;
};

export function GhostNode({ data }: NodeProps<GhostNodeData>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [replaceValue, setReplaceValue] = useState(data.label);

  // Sync input value when label changes from outside
  useEffect(() => {
    setReplaceValue(data.label);
  }, [data.label]);

  // Focus input when replace mode is entered
  useEffect(() => {
    if (data.isReplacing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [data.isReplacing]);

  function confirmReplace() {
    const trimmed = replaceValue.trim().slice(0, 15);
    if (trimmed.length > 0) {
      data.onReplaceConfirm?.(trimmed);
    }
  }

  const isLeft = Math.abs(data.outwardAngle || 0) > 90;

  return (
    <div
      className="flex flex-col items-center gap-1"
      style={{ opacity: data.isExpanding ? 1 : 0.75 }}
    >
      <Handle
        type="target"
        position={isLeft ? Position.Right : Position.Left}
        className="opacity-0 pointer-events-none"
      />

      {/* Ghost ring + label */}
      <div className="relative flex items-center justify-center">
        <svg
          width="72"
          height="40"
          viewBox="0 0 72 40"
          fill="none"
          className={data.isExpanding ? "animate-ghost-pulse" : ""}
        >
          <rect
            x="1"
            y="1"
            width="70"
            height="38"
            rx="19"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="4 4"
            className="text-[#A8A49E] dark:text-[#5A5A56]"
            fill="transparent"
          />
        </svg>

        {/* Label or replace input — overlaid on the SVG */}
        <div className="absolute inset-0 flex items-center justify-center px-2">
          {data.isReplacing ? (
            <input
              ref={inputRef}
              value={replaceValue}
              maxLength={15}
              onChange={(e) => setReplaceValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmReplace();
                } else if (e.key === "Escape") {
                  setReplaceValue(data.label);
                  data.onReplace?.(); // toggle back
                }
              }}
              className="
                w-full bg-transparent border-none outline-none
                text-[11px] font-mono text-center
                text-[#1a1a18] dark:text-[#e8e8e4]
              "
            />
          ) : (
            <span className="text-[12px] font-mono text-center text-[#1a1a18] dark:text-[#e8e8e4]">
              {data.label || "..."}
            </span>
          )}
        </div>
      </div>

      {/* Keep / Replace buttons */}
      {!data.isExpanding && (data.onKeep || data.onReplace) && (
        <div className="flex items-center gap-1 mt-0.5">
          {data.isReplacing ? (
            <button
              onClick={confirmReplace}
              className="
                text-[9px] font-mono px-1.5 py-0.5 rounded
                text-[#888880] hover:text-[#1a1a18] dark:hover:text-[#e8e8e4]
                border border-[#CCCAC4] dark:border-[#3A3A38]
                hover:border-[#888880] transition-colors duration-100
              "
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  confirmReplace();
                }
              }}
            >
              keep
            </button>
          ) : (
            <>
              <button
                onClick={data.onKeep}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    data.onKeep?.();
                  }
                }}
                className="
                  text-[11px] font-mono px-2 py-0.5 rounded
                  text-[#1a1a18] dark:text-[#e8e8e4]
                  border border-[#A8A49E] dark:border-[#5A5A56]
                  hover:border-[#5C5955] dark:hover:border-[#AAAAA4] transition-colors duration-100
                "
              >
                keep
              </button>
              <button
                onClick={data.onReplace}
                className="
                  text-[11px] font-mono px-2 py-0.5 rounded
                  text-[#1a1a18] dark:text-[#e8e8e4]
                  border border-[#A8A49E] dark:border-[#5A5A56]
                  hover:border-[#5C5955] dark:hover:border-[#AAAAA4] transition-colors duration-100
                "
              >
                edit
              </button>
            </>
          )}
        </div>
      )}

      <Handle
        id="right"
        type="source"
        position={Position.Right}
        className="opacity-0 pointer-events-none"
      />
      <Handle
        id="left"
        type="source"
        position={Position.Left}
        className="opacity-0 pointer-events-none"
      />
    </div>
  );
}
