"use client";

import { useRef, useEffect } from "react";
import { Handle, Position } from "reactflow";
import type { NodeProps } from "reactflow";

export type MapNodeData = {
  label: string;
  depth: number;
  parentId: string | null;
  isSelected: boolean;
  isEditing: boolean;
  /** Phase 2: true while the node is a pending ghost (suggest mode keep/replace flow) */
  ghost?: boolean;
  
  // Suggest & Auto mode arrow support
  isSuggestMode?: boolean;
  isAutoMode?: boolean;
  hasChildren?: boolean;
  outwardAngle?: number;
  onArrowClick?: (label: string) => void;

  onLabelChange: (value: string) => void;
  onEditConfirm: () => void;
  onEditCancel: () => void;
  onEditExpand: (label: string) => void;
};

export function MapNode({ data }: NodeProps<MapNodeData>) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data.isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [data.isEditing]);

  const isRoot = data.depth === 0;

  const ringStyle = data.isSelected
    ? "ring-[1.5px] ring-[#5C5955] dark:ring-[#AAAAA4]"
    : "ring-1 ring-[#A8A49E] dark:ring-[#5A5A56]";

  const textStyle = isRoot
    ? "text-[13px] font-medium"
    : "text-[12px] font-normal";

  const showArrow =
    !data.ghost &&
    !data.hasChildren &&
    !data.isEditing;

  // Convert the math angle (standard polar) back to canvas CSS rotation
  // Canvas Y is inverted, so we flip the angle.
  const arrowAngle = data.outwardAngle !== undefined ? -data.outwardAngle : 0;

  return (
    <div className="relative group flex items-center justify-center">
      {/* 
        We use an absolute container rotated to the outward heading.
        The container is full width/height, so translate-x moves the arrow outward.
      */}
      <div
        className={`
          animate-node-enter
          flex items-center justify-center
          rounded-full px-4 py-2
          min-w-[64px] min-h-[36px]
          bg-[#FAFAF8] dark:bg-[#111110]
          ${ringStyle}
          cursor-pointer select-none
        `}
      >
        <Handle
          type="target"
          position={Position.Left}
          className="opacity-0 pointer-events-none"
        />

        {data.isEditing ? (
          <input
            ref={inputRef}
            className={`
              ${textStyle}
              bg-transparent border-none outline-none text-center
              w-full max-w-[120px] font-mono
              text-[#1a1a18] dark:text-[#e8e8e4]
            `}
            value={data.label}
            maxLength={15}
            onChange={(e) => data.onLabelChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                data.onEditConfirm();
                data.onEditExpand(data.label);
              } else if (e.key === "Escape") {
                e.preventDefault();
                data.onEditCancel();
              }
            }}
            onBlur={data.onEditConfirm}
          />
        ) : (
          <span
            className={`
              ${textStyle}
              font-mono text-center
              text-[#1a1a18] dark:text-[#e8e8e4]
            `}
          >
            {data.label || <span className="opacity-30">·</span>}
          </span>
        )}

        <Handle
          type="source"
          position={Position.Right}
          className="opacity-0 pointer-events-none"
        />
      </div>

      {showArrow && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{ transform: `rotate(${arrowAngle}deg)` }}
        >
          <div
            className="absolute top-1/2 -translate-y-1/2 -right-6 pointer-events-auto cursor-pointer flex items-center justify-center transition-opacity duration-150 opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              data.onArrowClick?.(data.label);
            }}
          >
            <div className="bg-[#FAFAF8] dark:bg-[#111110] rounded-full p-1 shadow-sm">
              <svg 
                width="14" 
                height="14" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                className="text-[#5C5955] dark:text-[#AAAAA4]"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
