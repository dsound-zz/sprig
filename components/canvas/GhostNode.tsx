"use client";

import { Handle, Position } from "reactflow";
import type { NodeProps } from "reactflow";

export type GhostNodeData = {
  label?: string;
};

export function GhostNode({ data }: NodeProps<GhostNodeData>) {
  return (
    <div
      className="animate-node-enter flex items-center justify-center"
      style={{ opacity: 0.4 }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="opacity-0 pointer-events-none"
      />

      <svg width="72" height="40" viewBox="0 0 72 40" fill="none">
        <rect
          x="1"
          y="1"
          width="70"
          height="38"
          rx="19"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="4 4"
          className="text-[#CCCAC4] dark:text-[#3A3A38]"
          fill="transparent"
        />
        {data.label ? (
          <text
            x="36"
            y="24"
            textAnchor="middle"
            fontSize="12"
            fontFamily="var(--font-geist-mono), DM Mono, monospace"
            fill="currentColor"
            className="text-[#1a1a18] dark:text-[#e8e8e4]"
          >
            {data.label}
          </text>
        ) : null}
      </svg>

      <Handle
        type="source"
        position={Position.Right}
        className="opacity-0 pointer-events-none"
      />
    </div>
  );
}
