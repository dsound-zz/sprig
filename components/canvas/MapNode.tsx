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
  onLabelChange: (value: string) => void;
  onEditConfirm: () => void;
  onEditCancel: () => void;
  onEditExpand: () => void;
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
    ? "ring-[1.5px] ring-[#888880] dark:ring-[#888880]"
    : "ring-1 ring-[#CCCAC4] dark:ring-[#3A3A38]";

  const textStyle = isRoot
    ? "text-[13px] font-medium"
    : "text-[12px] font-normal";

  return (
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
          maxLength={20}
          onChange={(e) => data.onLabelChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              data.onEditConfirm();
              data.onEditExpand();
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
  );
}
