"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactFlow, {
  useNodesState,
  useEdgesState,
  Background,
  BackgroundVariant,
  getBezierPath,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeMouseHandler,
  type OnNodesChange,
} from "reactflow";
import "reactflow/dist/style.css";
import { MapNode, type MapNodeData } from "./MapNode";
import { GhostNode, type GhostNodeData } from "./GhostNode";
import type { SliderMode } from "@/components/ui/SliderBar";

const MAX_AUTO_DEPTH = 5;

// Node types must be defined outside the component to prevent remounting
const nodeTypes = {
  mindmap: MapNode,
  ghost: GhostNode,
};

// Custom connection edge — sage green dashed (pending) or solid (accepted)
function ConnectionEdgeComponent({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
}: EdgeProps) {
  const accepted = (data as { accepted?: boolean } | undefined)?.accepted ?? false;
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <path
      id={id}
      className="react-flow__edge-path"
      d={edgePath}
      stroke="#7C9E87"
      strokeWidth={accepted ? 1.5 : 1}
      strokeDasharray={accepted ? undefined : "6 3"}
      fill="none"
    />
  );
}

// Edge types must be defined outside the component to prevent remounting
const edgeTypes = {
  connectionEdge: ConnectionEdgeComponent,
};

const CHILD_RADIUS = 180;
// Root fan: 45° (upper-right), 180° (left), 315° (lower-right) — balanced triangle spread
const ROOT_CHILD_ANGLES = [45, 180, 315];
// Fan spread: ±40° around the outward direction
const FAN_SPREAD_DEG = 40;
// Minimum distance between any two node centers
const MIN_NODE_SEPARATION = 120;
// Maximum overlap-nudge iterations
const MAX_NUDGE_ITERATIONS = 5;

function radialPosition(
  cx: number,
  cy: number,
  angleDeg: number,
  radius = CHILD_RADIUS
): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    // Canvas Y is inverted relative to standard math coords
    y: cy - radius * Math.sin(rad),
  };
}

/**
 * Derive the three child angles for a given parent node.
 * If the parent is the root (no grandparent position), use the balanced triangle fan.
 * Otherwise, compute the outward direction from grandparent → parent,
 * then fan ±FAN_SPREAD_DEG around that direction.
 */
function computeChildAngles(
  parentPos: { x: number; y: number },
  grandparentPos: { x: number; y: number } | null
): number[] {
  if (!grandparentPos) {
    // Root node — use the balanced triangle fan
    return ROOT_CHILD_ANGLES;
  }
  // Outward direction = direction parent is relative to grandparent,
  // i.e. continuing the same heading away from the tree trunk.
  // Canvas Y is inverted, so we negate dy when computing the angle.
  const dx = parentPos.x - grandparentPos.x;
  const dy = -(parentPos.y - grandparentPos.y); // flip for standard math coords
  const baseAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return [
    baseAngleDeg - FAN_SPREAD_DEG,
    baseAngleDeg,
    baseAngleDeg + FAN_SPREAD_DEG,
  ];
}

/**
 * After placing a candidate position, nudge it away from any existing node
 * that is closer than MIN_NODE_SEPARATION. Repeats up to MAX_NUDGE_ITERATIONS.
 */
function nudgeForSeparation(
  candidate: { x: number; y: number },
  existingNodes: Array<{ x: number; y: number }>
): { x: number; y: number } {
  let pos = { ...candidate };
  for (let iter = 0; iter < MAX_NUDGE_ITERATIONS; iter++) {
    let moved = false;
    for (const existing of existingNodes) {
      const dx = pos.x - existing.x;
      const dy = pos.y - existing.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MIN_NODE_SEPARATION && dist > 0) {
        // Nudge along the radial direction away from the existing node
        const scale = MIN_NODE_SEPARATION / dist;
        pos = { x: existing.x + dx * scale, y: existing.y + dy * scale };
        moved = true;
      }
    }
    if (!moved) break;
  }
  return pos;
}

type ConnectionEntry = {
  id: string;
  sourceId: string;
  targetId: string;
  reason: string;
};

type Props = {
  initialMapId: string | null;
  userId: string;
  sliderMode: SliderMode;
  autoDepth: number;
  onMapCreated?: (mapId: string) => void;
};

export function MindMapCanvas({ initialMapId, userId, sliderMode, autoDepth, onMapCreated }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<
    MapNodeData | GhostNodeData
  >([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [mapId, setMapId] = useState<string | null>(initialMapId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string>("");
  const [rootInput, setRootInput] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);
  const [expandRequest, setExpandRequest] = useState<{ nodeId: string; label: string; isNewMap?: boolean; trigger?: "enter" | "arrow" } | null>(null);
  const [suggestRequest, setSuggestRequest] = useState<{ nodeId: string; label: string } | null>(null);
  // Track which ghost node IDs are in "replace" (edit) mode
  const [replacingGhostIds, setReplacingGhostIds] = useState<Set<string>>(new Set());
  // Track which node IDs are currently being auto-expanded (pulsing ring)
  const [expandingNodeIds, setExpandingNodeIds] = useState<Set<string>>(new Set());
  // Connection detection state (Phase 3a)
  const [connectionData, setConnectionData] = useState<ConnectionEntry[]>([]);
  const [isFindingConnections, setIsFindingConnections] = useState(false);

  // Ref so async auto-expand loop can read current mode/depth without stale closure
  const sliderModeRef = useRef<SliderMode>(sliderMode);
  const autoDepthRef = useRef<number>(autoDepth);
  useEffect(() => { sliderModeRef.current = sliderMode; }, [sliderMode]);
  useEffect(() => { autoDepthRef.current = autoDepth; }, [autoDepth]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLabelsRef = useRef<Record<string, string>>({});
  // Track if we just created this map locally so we don't wipe it out by fetching
  const isCreatedLocallyRef = useRef(false);

  // Load map on mount if one exists
  useEffect(() => {
    if (!initialMapId) return;

    if (isCreatedLocallyRef.current) {
      // Map was just created locally and has active state (e.g. ghost nodes spawning).
      // We don't want to load from DB and wipe that state out.
      isCreatedLocallyRef.current = false;
      return;
    }

    async function loadMap() {
      const res = await fetch(`/api/maps/${initialMapId}`);
      if (!res.ok) return;

      const data = (await res.json()) as {
        map: { id: string; title: string };
        nodes: Array<{
          id: string;
          parentId: string | null;
          label: string;
          fullConcept: string;
          positionX: number;
          positionY: number;
          depth: number;
        }>;
        edges: Array<{
          id: string;
          sourceId: string;
          targetId: string;
          edgeType: string;
        }>;
      };

      const rfNodes: Node<MapNodeData>[] = data.nodes.map((n) => {
        const parentNode = n.parentId ? data.nodes.find((p) => p.id === n.parentId) : null;
        let outwardAngle = 0;
        if (parentNode) {
          const dx = n.positionX - parentNode.positionX;
          const dy = -(n.positionY - parentNode.positionY);
          outwardAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
        }
        const hasChildren = data.nodes.some(child => child.parentId === n.id);

        return {
          id: n.id,
          type: "mindmap",
          position: { x: n.positionX, y: n.positionY },
          data: {
            label: n.label,
            depth: n.depth,
            parentId: n.parentId,
            outwardAngle,
            hasChildren,
            isSuggestMode: sliderMode === "suggest",
            isAutoMode: sliderMode === "auto",
            isSelected: false,
            isEditing: false,
            onLabelChange: () => { },
            onEditConfirm: () => { },
            onEditCancel: () => { },
            onEditExpand: () => { },
          },
        };
      });

      const connEdgesFromDB: Edge[] = [];
      const treeEdgesFromDB: Edge[] = [];

      for (const e of data.edges) {
        if (e.edgeType === "connection") {
          connEdgesFromDB.push({
            id: e.id,
            source: e.sourceId,
            target: e.targetId,
            type: "connectionEdge",
            data: { accepted: true },
          });
        } else {
          const sourceNode = data.nodes.find(n => n.id === e.sourceId);
          const targetNode = data.nodes.find(n => n.id === e.targetId);
          const isLeft = targetNode && sourceNode ? targetNode.positionX < sourceNode.positionX : false;
          treeEdgesFromDB.push({
            id: e.id,
            source: e.sourceId,
            sourceHandle: isLeft ? "left" : "right",
            target: e.targetId,
            style: {
              stroke: "var(--edge-color)",
              strokeWidth: 0.8,
            },
          });
        }
      }

      setNodes(rfNodes);
      // Connection edges first so they render below tree edges
      setEdges([...connEdgesFromDB, ...treeEdgesFromDB]);
    }

    loadMap();
  }, [initialMapId, setNodes, setEdges]);

  // Wire event handlers into node data after state changes
  const getNodeHandlers = useCallback(
    (nodeId: string, currentLabel: string) => ({
      onLabelChange: (value: string) => {
        setPendingLabel(value);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, label: value } }
              : n
          )
        );
      },
      onEditConfirm: () => {
        // Immediately persist the confirmed label for this node; the
        // debounce will also run but this guarantees the label is saved
        // even if the user closes the tab right after confirming.
        setNodes((nds) => {
          const target = nds.find((n) => n.id === nodeId);
          if (target && mapId) {
            const label = (target.data as MapNodeData).label;
            fetch(`/api/maps/${mapId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                nodes: [
                  {
                    id: nodeId,
                    positionX: target.position.x,
                    positionY: target.position.y,
                    label,
                  },
                ],
              }),
            });
          }
          return nds;
        });
        setEditingNodeId(null);
        scheduleSave();
      },
      onEditCancel: () => {
        // Restore previous label
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                ...n,
                data: {
                  ...n.data,
                  label: prevLabelsRef.current[nodeId] ?? currentLabel,
                  isEditing: false,
                },
              }
              : n
          )
        );
        setEditingNodeId(null);
      },
      onEditExpand: (label: string) => {
        setExpandRequest({ nodeId, label, trigger: "enter" });
      },
    }),
    [setNodes, setExpandRequest, mapId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Keep node data in sync with selection/editing state, replacing ghost flags, and expanding ids
  useEffect(() => {
    setNodes((nds) => {
      // Pre-calculate parent relationships to optimize hasChildren and outwardAngle
      const childrenSet = new Set(
        nds.filter(n => {
          const parentId = (n.data as { parentId?: string | null }).parentId;
          return parentId !== null && parentId !== undefined;
        }).map(n => (n.data as { parentId: string | null }).parentId)
      );

      return nds.map((n) => {
        if (n.type === "ghost") {
          // Sync isReplacing and isExpanding flags into ghost node data
          const gd = n.data as GhostNodeData;
          return {
            ...n,
            data: {
              ...gd,
              isReplacing: replacingGhostIds.has(n.id),
              isExpanding: expandingNodeIds.has(n.id),
            },
          };
        }
        if (n.type !== "mindmap") return n;
        const isSelected = n.id === selectedNodeId;
        const isEditing = n.id === editingNodeId;
        const hasChildren = childrenSet.has(n.id);
        const handlers = getNodeHandlers(n.id, (n.data as MapNodeData).label);

        // Compute outward heading (same logic used in computeChildAngles)
        const parentId = (n.data as MapNodeData).parentId;
        const parentNode = parentId ? nds.find((p) => p.id === parentId) : null;
        let outwardAngle = 0;
        if (parentNode) {
          const dx = n.position.x - parentNode.position.x;
          const dy = -(n.position.y - parentNode.position.y); // flip for standard math coords
          outwardAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
        }

        return {
          ...n,
          data: {
            ...(n.data as MapNodeData),
            isSelected,
            isEditing,
            hasChildren,
            outwardAngle,
            isSuggestMode: sliderMode === "suggest",
            isAutoMode: sliderMode === "auto",
            onArrowClick: (label: string) => {
              if (sliderMode === "suggest") {
                setSuggestRequest({ nodeId: n.id, label });
              } else {
                setExpandRequest({ nodeId: n.id, label, trigger: "arrow" });
              }
            },
            ...handlers,
          },
        };
      });
    });
  }, [selectedNodeId, editingNodeId, getNodeHandlers, setNodes, replacingGhostIds, expandingNodeIds, sliderMode]);

  // ---------------------------------------------------------------------------
  // Expand arrow click in Suggest Mode
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!suggestRequest || !mapId) return;
    const { nodeId, label } = suggestRequest;
    setSuggestRequest(null);

    const parentNode = nodes.find((n) => n.id === nodeId);
    if (!parentNode || (parentNode.data as MapNodeData).ghost) return;
    if (!label.trim()) return;

    // Robust check: do not spawn more ghosts if it already has children or ghosts!
    const children = nodes.filter((n) => n.type === "mindmap" && (n.data as MapNodeData).parentId === nodeId);
    const hasGhostChildren = nodes.some(
      (n) => n.type === "ghost" && (n.data as GhostNodeData & { parentId: string | null }).parentId === nodeId
    );
    if (children.length > 0 || hasGhostChildren) return;

    spawnGhostNodes(nodeId, label, mapId, [...nodes]);
  }, [suggestRequest, mapId, nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Helper: place 3 child positions for a parent node
  // ---------------------------------------------------------------------------
  function computeChildPositions(
    parentNode: Node,
    allNodes: Node[]
  ): Array<{ x: number; y: number }> {
    const { x: px, y: py } = parentNode.position;
    const grandparentId = (parentNode.data as MapNodeData).parentId;
    const grandparentNode = grandparentId ? allNodes.find((n) => n.id === grandparentId) : null;
    const grandparentPos = grandparentNode ? grandparentNode.position : null;
    const childAngles = computeChildAngles({ x: px, y: py }, grandparentPos);
    const existingCenters = allNodes.map((n) => ({ x: n.position.x, y: n.position.y }));
    return childAngles.map((angle) => nudgeForSeparation(radialPosition(px, py, angle), existingCenters));
  }

  // ---------------------------------------------------------------------------
  // Helper: persist one node + edge to DB, return new node id
  // ---------------------------------------------------------------------------
  async function persistChildNode(
    currentMapId: string,
    parentId: string,
    label: string,
    pos: { x: number; y: number },
    depth: number
  ): Promise<string | null> {
    // Phase 2 placeholder — full_concept may diverge from label in future
    const res = await fetch("/api/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mapId: currentMapId,
        parentId,
        label,
        fullConcept: label,
        positionX: pos.x,
        positionY: pos.y,
        depth,
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { node: { id: string } };
    const childId = body.node.id;
    await fetch("/api/edges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId: currentMapId, sourceId: parentId, targetId: childId }),
    });
    return childId;
  }

  // ---------------------------------------------------------------------------
  // Ghost node: convert ghost -> real persisted node
  // ---------------------------------------------------------------------------
  function handleGhostKeep(ghostId: string, label: string, currentMapId: string) {
    setNodes((nds) => {
      const ghostNode = nds.find((n) => n.id === ghostId);
      if (!ghostNode) return nds;
      const ghostData = ghostNode.data as GhostNodeData;
      const parentId = (ghostData as unknown as { parentId: string | null }).parentId as string | null;
      const depth = (ghostData as unknown as { depth: number }).depth as number ?? 1;

      let outwardAngle = 0;
      if (parentId) {
        const parentNode = nds.find((n) => n.id === parentId);
        if (parentNode) {
          const dx = ghostNode.position.x - parentNode.position.x;
          const dy = -(ghostNode.position.y - parentNode.position.y);
          outwardAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
        }
      }

      // Persist async — fire and forget (we optimistically update UI)
      (async () => {
        const res = await fetch("/api/nodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mapId: currentMapId,
            parentId,
            label,
            fullConcept: label, // Phase 2 placeholder — full_concept may diverge from label in future
            positionX: ghostNode.position.x,
            positionY: ghostNode.position.y,
            depth,
          }),
        });
        if (!res.ok) return;
        const body = (await res.json()) as { node: { id: string } };
        const realId = body.node.id;
        // Swap the ghost id for the real id in nodes + edges
        setNodes((nds2) =>
          nds2.map((n) => {
            if (n.id !== ghostId) return n;
            const real: Node<MapNodeData> = {
              ...n,
              id: realId,
              type: "mindmap",
              data: {
                label,
                depth,
                parentId: parentId ?? null,
                outwardAngle,
                isSelected: false,
                isEditing: false,
                onLabelChange: () => {},
                onEditConfirm: () => {},
                onEditCancel: () => {},
                onEditExpand: () => {},
              },
            };
            return real;
          })
        );
        setEdges((eds) =>
          eds.map((e) => {
            if (e.target === ghostId) return { ...e, target: realId, id: `e-${e.source}-${realId}` };
            if (e.source === ghostId) return { ...e, source: realId };
            return e;
          })
        );
        if (parentId) {
          await fetch("/api/edges", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mapId: currentMapId, sourceId: parentId, targetId: realId }),
          });
        }
      })();

      // Optimistically replace ghost with a real mindmap node in local state
      return nds.map((n) => {
        if (n.id !== ghostId) return n;
        const gd = n.data as GhostNodeData & { parentId: string | null; depth: number };
        const real: Node<MapNodeData> = {
          ...n,
          type: "mindmap",
          data: {
            label,
            depth: gd.depth ?? 1,
            parentId: gd.parentId ?? null,
            outwardAngle,
            isSelected: false,
            isEditing: false,
            onLabelChange: () => {},
            onEditConfirm: () => {},
            onEditCancel: () => {},
            onEditExpand: () => {},
          },
        };
        return real;
      });
    });
    setReplacingGhostIds((prev) => { const s = new Set(prev); s.delete(ghostId); return s; });
  }

  // ---------------------------------------------------------------------------
  // Ghost node: spawn 3 ghost nodes with LLM labels for suggest mode
  // ---------------------------------------------------------------------------
  async function spawnGhostNodes(
    parentId: string,
    confirmedLabel: string,
    currentMapId: string,
    allNodes: Node[]
  ) {
    const parentNode = allNodes.find((n) => n.id === parentId);
    if (!parentNode) return;
    const parentDepth = (parentNode.data as MapNodeData).depth;
    const childPositions = computeChildPositions(parentNode, allNodes);

    // Insert 3 ghost nodes into local state with label "..."
    const ghostIds = childPositions.map(() => `ghost-${Math.random().toString(36).slice(2)}`);

    const newGhosts: Node<GhostNodeData & { parentId: string | null; depth: number }>[] =
      ghostIds.map((gid, i) => ({
        id: gid,
        type: "ghost",
        position: childPositions[i],
        data: {
          label: "...",
          parentId,
          depth: parentDepth + 1,
          isReplacing: false,
          onKeep: undefined,
          onReplace: undefined,
          onReplaceConfirm: undefined,
        },
      }));

    const newGhostEdges: Edge[] = ghostIds.map((gid, i) => ({
      id: `e-${parentId}-${gid}`,
      source: parentId,
      sourceHandle: childPositions[i].x < parentNode.position.x ? "left" : "right",
      target: gid,
      style: { stroke: "var(--edge-color)", strokeWidth: 0.8, opacity: 0.4 },
    }));

    setNodes((nds) => {
      const parentUpdated = nds.map((n) =>
        n.id === parentId ? { ...n, data: { ...n.data, hasChildren: true } } : n
      );
      return [...parentUpdated, ...newGhosts];
    });
    setEdges((eds) => [...eds, ...newGhostEdges]);

    // Collect existing labels (not ghosts) for the LLM
    const existingLabels = allNodes
      .filter((n) => n.type === "mindmap")
      .map((n) => (n.data as MapNodeData).label)
      .filter((l) => l.trim().length > 0);

    // Fetch LLM suggestions — pass confirmedLabel directly to avoid a race where
    // the PATCH that saved the label hasn't committed to DB yet.
    const res = await fetch(`/api/maps/${currentMapId}/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: parentId, label: confirmedLabel }),
    });

    const suggestions: string[] = res.ok
      ? ((await res.json()) as { suggestions: string[] }).suggestions
      : ["", "", ""];

    // Update ghost nodes with suggested labels + wire Keep/Replace handlers
    setNodes((nds) =>
      nds.map((n) => {
        const idx = ghostIds.indexOf(n.id);
        if (idx === -1) return n;
        const suggestedLabel = suggestions[idx] ?? "";
        const gid = n.id;
        const updatedData: GhostNodeData & { parentId: string | null; depth: number } = {
          label: suggestedLabel,
          parentId,
          depth: parentDepth + 1,
          isReplacing: false,
          onKeep: () => handleGhostKeep(gid, suggestedLabel, currentMapId),
          onReplace: () => {
            setReplacingGhostIds((prev) => {
              const s = new Set(prev);
              if (s.has(gid)) s.delete(gid); else s.add(gid);
              return s;
            });
          },
          onReplaceConfirm: (newLabel: string) => {
            setReplacingGhostIds((prev) => { const s = new Set(prev); s.delete(gid); return s; });
            handleGhostKeep(gid, newLabel, currentMapId);
          },
        };
        return { ...n, data: updatedData };
      })
    );

    // Suppress unused var warning
    void existingLabels;
  }

  // ---------------------------------------------------------------------------
  // Auto mode: recursively expand a node to the chosen depth
  // ---------------------------------------------------------------------------
  async function autoExpand(
    parentId: string,
    confirmedLabel: string,
    currentMapId: string,
    parentDepth: number,
    targetDepth: number,
    allNodesSnapshot: Node[]
  ): Promise<void> {
    if (parentDepth >= Math.min(targetDepth, MAX_AUTO_DEPTH)) return;

    const parentNode = allNodesSnapshot.find((n) => n.id === parentId);
    if (!parentNode) return;

    setExpandingNodeIds((prev) => new Set(prev).add(parentId));

    const childPositions = computeChildPositions(parentNode, allNodesSnapshot);

    // Pass confirmedLabel directly to avoid race with the PATCH that saved it to DB.
    const res = await fetch(`/api/maps/${currentMapId}/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: parentId, label: confirmedLabel }),
    });

    const suggestions: string[] = res.ok
      ? ((await res.json()) as { suggestions: string[] }).suggestions
      : ["", "", ""];

    const newChildIds: string[] = [];
    const newChildPositions: Array<{ x: number; y: number }> = [];
    const newRfNodes: Node<MapNodeData>[] = [];
    const newRfEdges: Edge[] = [];

    for (let i = 0; i < childPositions.length; i++) {
      const label = suggestions[i] ?? "";
      if (!label.trim()) continue;
      const pos = childPositions[i];
      const childId = await persistChildNode(currentMapId, parentId, label, pos, parentDepth + 1);
      if (!childId) continue;
      newChildIds.push(childId);
      newChildPositions.push(pos);

      let outwardAngle = 0;
      const dx = pos.x - parentNode.position.x;
      const dy = -(pos.y - parentNode.position.y);
      outwardAngle = (Math.atan2(dy, dx) * 180) / Math.PI;

      newRfNodes.push({
        id: childId,
        type: "mindmap",
        position: pos,
        data: {
          label,
          depth: parentDepth + 1,
          parentId,
          outwardAngle,
          isSelected: false,
          isEditing: false,
          onLabelChange: () => {},
          onEditConfirm: () => {},
          onEditCancel: () => {},
          onEditExpand: () => {},
        },
      });
      newRfEdges.push({
        id: `e-${parentId}-${childId}`,
        source: parentId,
        sourceHandle: pos.x < parentNode.position.x ? "left" : "right",
        target: childId,
        style: { stroke: "var(--edge-color)", strokeWidth: 0.8 },
      });
    }

    setNodes((nds) => {
      const parentUpdated = nds.map((n) =>
        n.id === parentId ? { ...n, data: { ...n.data, hasChildren: true } } : n
      );
      return [...parentUpdated, ...newRfNodes];
    });
    setEdges((eds) => [...eds, ...newRfEdges]);
    setExpandingNodeIds((prev) => { const s = new Set(prev); s.delete(parentId); return s; });

    // Build updated snapshot for next level
    const nextSnapshot = [...allNodesSnapshot, ...newRfNodes];

    // Recurse sequentially — child nodes are new so we use their label for subsequent levels
    for (let ci = 0; ci < newChildIds.length; ci++) {
      await autoExpand(newChildIds[ci], newRfNodes[ci].data.label, currentMapId, parentDepth + 1, targetDepth, nextSnapshot);
    }
  }

  // ---------------------------------------------------------------------------
  // Cascade Re-Infer: Update all descendants based on new parent label
  // ---------------------------------------------------------------------------
  async function cascadeReInfer(
    parentNodeId: string,
    parentLabel: string,
    currentMapId: string,
    snapshot: Node[]
  ) {
    const children = snapshot.filter(
      (n) => n.type === "mindmap" && (n.data as MapNodeData).parentId === parentNodeId
    );
    if (children.length === 0) return;

    setNodes((nds) =>
      nds.map((n) =>
        children.some((c) => c.id === n.id)
          ? { ...n, data: { ...n.data, isReinferring: true } }
          : n
      )
    );

    const res = await fetch(`/api/maps/${currentMapId}/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: parentNodeId, label: parentLabel }),
    });

    const suggestions: string[] = res.ok
      ? ((await res.json()) as { suggestions: string[] }).suggestions
      : ["", "", ""];

    const updatedChildren = children.map((child, i) => ({
      id: child.id,
      positionX: child.position.x,
      positionY: child.position.y,
      newLabel: suggestions[i] || "...",
    }));

    setNodes((nds) =>
      nds.map((n) => {
        const update = updatedChildren.find((c) => c.id === n.id);
        if (update) {
          return { ...n, data: { ...n.data, label: update.newLabel, isReinferring: false } };
        }
        return n;
      })
    );

    // Persist to DB
    await fetch(`/api/maps/${currentMapId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: updatedChildren.map((c) => ({
          id: c.id,
          positionX: c.positionX,
          positionY: c.positionY,
          label: c.newLabel,
        })),
      }),
    });

    // Recursively update grandchildren
    await Promise.all(
      updatedChildren.map((child) =>
        cascadeReInfer(child.id, child.newLabel, currentMapId, snapshot)
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Expand a node — branches on slider mode
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!expandRequest || !mapId) return;

    const { nodeId, label: confirmedLabel, isNewMap, trigger } = expandRequest;
    setExpandRequest(null);

    const parentNode = nodes.find((n) => n.id === nodeId);
    if (!parentNode) return;

    const currentMode = sliderModeRef.current;

    // Guard: empty label means the node wasn't filled in.
    // In Suggest/Auto modes, we require a label to send to the LLM.
    // In Manual mode, the user can explicitly click the arrow to spawn more empty bubbles.
    if (!confirmedLabel.trim() && currentMode !== "manual") return;

    // Do not expand ghost nodes
    if ((parentNode.data as MapNodeData).ghost) return;

    const hasChildren = nodes.some(
      (n) => n.type !== "ghost" && (n.data as MapNodeData).parentId === nodeId
    );

    const parentDepth = (parentNode.data as MapNodeData).depth;
    const currentMapId = mapId;
    const currentAutoDepth = autoDepthRef.current;
    const nodesSnapshot = [...nodes];

    // Manual mode does not cascade edits or re-expand if children already exist
    if (hasChildren && currentMode === "manual") return;

    // Check if the node currently has ghost children
    const hasGhostChildren = nodes.some(
      (n) => n.type === "ghost" && (n.data as GhostNodeData & { parentId: string | null }).parentId === nodeId
    );

    if (currentMode === "suggest") {
      if (isNewMap || hasChildren || hasGhostChildren) {
        if (hasChildren) {
          // If there are real children, we cascade updates down the tree instead of deleting
          cascadeReInfer(nodeId, confirmedLabel, currentMapId, nodesSnapshot);
          return;
        }

        // If it only had ghost children, we clear them and spawn new ones
        if (hasGhostChildren) {
          setNodes(nds => nds.filter(n => n.type !== "ghost" || (n.data as GhostNodeData & { parentId: string | null }).parentId !== nodeId));
          setEdges(eds => eds.filter(e => e.source !== nodeId || !e.target.startsWith("ghost-")));
        }
        
        spawnGhostNodes(nodeId, confirmedLabel, currentMapId, nodesSnapshot);
        return;
      }
      // If none of the above apply, Suggest mode shouldn't do anything (like fall through)
      return;
    }

    if (currentMode === "auto") {
      // Auto mode edit mid-tree logic
      if (hasChildren) {
        cascadeReInfer(nodeId, confirmedLabel, currentMapId, nodesSnapshot);
        return;
      }

      // Only expand leaf nodes on Arrow click or New Map (not on Enter key)
      if (isNewMap || trigger === "arrow") {
        autoExpand(nodeId, confirmedLabel, currentMapId, parentDepth, currentAutoDepth, nodesSnapshot);
      }
      return;
    }

    // Manual mode (default): 3 blank children
    (async () => {
      const childPositions = computeChildPositions(parentNode, nodesSnapshot);
      const newChildIds: string[] = [];

      for (const pos of childPositions) {
        const res = await fetch("/api/nodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mapId: currentMapId,
            parentId: nodeId,
            label: "",
            fullConcept: "", // Phase 2 placeholder — full_concept may diverge from label in future
            positionX: pos.x,
            positionY: pos.y,
            depth: parentDepth + 1,
          }),
        });
        if (res.ok) {
          const body = (await res.json()) as { node: { id: string } };
          newChildIds.push(body.node.id);
        }
      }

      for (const childId of newChildIds) {
        await fetch("/api/edges", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mapId: currentMapId, sourceId: nodeId, targetId: childId }),
        });
      }

      const newRfNodes: Node<MapNodeData>[] = newChildIds.map((id, i) => {
        const pos = childPositions[i];
        let outwardAngle = 0;
        const dx = pos.x - parentNode.position.x;
        const dy = -(pos.y - parentNode.position.y);
        outwardAngle = (Math.atan2(dy, dx) * 180) / Math.PI;

        return {
          id,
          type: "mindmap",
          position: pos,
          data: {
            label: "",
            depth: parentDepth + 1,
            parentId: nodeId,
            outwardAngle,
          isSelected: false,
          isEditing: false,
          onLabelChange: () => {},
          onEditConfirm: () => {},
          onEditCancel: () => {},
          onEditExpand: () => {},
        },
      };
    });

      const newRfEdges: Edge[] = newChildIds.map((childId, i) => ({
        id: `e-${nodeId}-${childId}`,
        source: nodeId,
        sourceHandle: childPositions[i].x < parentNode.position.x ? "left" : "right",
        target: childId,
        style: { stroke: "var(--edge-color)", strokeWidth: 0.8 },
      }));

      setNodes((nds) => {
        const parentUpdated = nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, hasChildren: true } } : n
        );
        return [...parentUpdated, ...newRfNodes];
      });
      setEdges((eds) => [...eds, ...newRfEdges]);

      if (newChildIds.length > 0) {
        setSelectedNodeId(newChildIds[0]);
        prevLabelsRef.current[newChildIds[0]] = "";
        setEditingNodeId(newChildIds[0]);
      }
    })();
  }, [expandRequest, mapId]); // eslint-disable-line react-hooks/exhaustive-deps

  function scheduleSave() {
    if (!mapId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      setNodes((nds) => {
        const nodeUpdates = nds
          .filter((n) => n.type === "mindmap")
          .map((n) => ({
            id: n.id,
            positionX: n.position.x,
            positionY: n.position.y,
            label: (n.data as MapNodeData).label,
          }));

        fetch(`/api/maps/${mapId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodes: nodeUpdates }),
        });

        return nds;
      });
    }, 800);
  }

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      const hasPositionChange = changes.some((c) => c.type === "position");
      if (hasPositionChange) scheduleSave();
    },
    [onNodesChange] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when typing in the root concept input
      if (
        document.activeElement?.tagName === "INPUT" &&
        (document.activeElement as HTMLInputElement).dataset.rootInput === "true"
      ) {
        return;
      }

      if (!selectedNodeId) return;

      const currentNode = nodes.find((n) => n.id === selectedNodeId);
      if (!currentNode) return;

      const currentData = currentNode.data as MapNodeData;

      if (editingNodeId) {
        // Let Tab navigate to next sibling while editing
        if (e.key === "Tab") {
          e.preventDefault();
          // Read label from current nodes so the expand effect doesn't rely on a stale closure
          const label = (currentNode.data as MapNodeData).label;
          setExpandRequest({ nodeId: editingNodeId, label });
          const siblings = getSiblings(currentNode);
          const idx = siblings.findIndex((n) => n.id === editingNodeId);
          const next = siblings[idx + 1];
          if (next) {
            setEditingNodeId(next.id);
            setSelectedNodeId(next.id);
          } else {
            setEditingNodeId(null);
          }
        }
        return;
      }

      switch (e.key) {
        case "ArrowRight":
        case "Enter": {
          e.preventDefault();
          const children = getChildren(currentNode);
          if (children.length > 0) {
            setSelectedNodeId(children[0].id);
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          const parent = getParent(currentNode);
          if (parent) setSelectedNodeId(parent.id);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const siblings = getSiblings(currentNode);
          const idx = siblings.findIndex((n) => n.id === selectedNodeId);
          if (idx > 0) setSelectedNodeId(siblings[idx - 1].id);
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          const siblings = getSiblings(currentNode);
          const idx = siblings.findIndex((n) => n.id === selectedNodeId);
          if (idx < siblings.length - 1) setSelectedNodeId(siblings[idx + 1].id);
          break;
        }
        case "e":
        case "F2": {
          e.preventDefault();
          prevLabelsRef.current[selectedNodeId] = currentData.label;
          setPendingLabel(currentData.label);
          setEditingNodeId(selectedNodeId);
          break;
        }
        case "Backspace": {
          if (currentData.depth === 0) break; // Don't delete root
          e.preventDefault();
          if (confirm(`Delete "${currentData.label || "this node"}" and all its children?`)) {
            deleteNode(selectedNodeId);
          }
          break;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeId, editingNodeId, nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  function getChildren(node: Node): Node[] {
    return nodes.filter(
      (n) => n.type === "mindmap" && (n.data as MapNodeData).parentId === node.id
    );
  }

  function getParent(node: Node): Node | undefined {
    const data = node.data as MapNodeData;
    if (!data.parentId) return undefined;
    return nodes.find((n) => n.id === data.parentId);
  }

  function getSiblings(node: Node): Node[] {
    const data = node.data as MapNodeData;
    if (!data.parentId) return [node];
    return nodes.filter(
      (n) => n.type === "mindmap" && (n.data as MapNodeData).parentId === data.parentId
    );
  }

  async function deleteNode(nodeId: string) {
    await fetch(`/api/nodes?nodeId=${nodeId}`, { method: "DELETE" });

    const idsToRemove = collectDescendants(nodeId, nodes);
    setNodes((nds) => nds.filter((n) => !idsToRemove.has(n.id)));
    setEdges((eds) =>
      eds.filter(
        (e) => !idsToRemove.has(e.source) && !idsToRemove.has(e.target)
      )
    );
    setConnectionData((prev) =>
      prev.filter(
        (c) => !idsToRemove.has(c.sourceId) && !idsToRemove.has(c.targetId)
      )
    );
    setSelectedNodeId(null);
  }

  // ---------------------------------------------------------------------------
  // Connection detection handlers (Phase 3a)
  // ---------------------------------------------------------------------------
  async function handleFindConnections() {
    if (!mapId) return;
    setIsFindingConnections(true);
    try {
      const res = await fetch(`/api/maps/${mapId}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        connections: Array<{ sourceId: string; targetId: string; reason: string }>;
      };

      const newEntries: ConnectionEntry[] = data.connections.map((c) => ({
        id: `conn-${c.sourceId}-${c.targetId}`,
        sourceId: c.sourceId,
        targetId: c.targetId,
        reason: c.reason,
      }));

      const newConnEdges: Edge[] = newEntries.map((entry) => {
        const srcNode = nodes.find((n) => n.id === entry.sourceId);
        const tgtNode = nodes.find((n) => n.id === entry.targetId);
        const isTargetLeft =
          srcNode && tgtNode ? tgtNode.position.x < srcNode.position.x : false;
        return {
          id: entry.id,
          source: entry.sourceId,
          sourceHandle: isTargetLeft ? "left" : "right",
          target: entry.targetId,
          type: "connectionEdge",
          data: { reason: entry.reason, accepted: false },
        };
      });

      setConnectionData(newEntries);
      setEdges((eds) => {
        // Preserve accepted connection edges; replace pending ones with fresh results
        const accepted = eds.filter(
          (e) =>
            e.type === "connectionEdge" &&
            (e.data as { accepted?: boolean } | undefined)?.accepted === true
        );
        const tree = eds.filter((e) => e.type !== "connectionEdge");
        return [...newConnEdges, ...accepted, ...tree];
      });
    } finally {
      setIsFindingConnections(false);
    }
  }

  function handleConnectionKeep(connId: string) {
    const entry = connectionData.find((c) => c.id === connId);
    if (!entry || !mapId) return;

    setConnectionData((prev) => prev.filter((c) => c.id !== connId));
    setEdges((eds) =>
      eds.map((e) =>
        e.id === connId
          ? { ...e, data: { ...(e.data as object), accepted: true } }
          : e
      )
    );

    fetch("/api/edges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mapId,
        sourceId: entry.sourceId,
        targetId: entry.targetId,
        edgeType: "connection",
      }),
    });
  }

  function handleConnectionDismiss(connId: string) {
    setConnectionData((prev) => prev.filter((c) => c.id !== connId));
    setEdges((eds) => eds.filter((e) => e.id !== connId));
  }

  function handleDismissAll() {
    const pendingIds = new Set(connectionData.map((c) => c.id));
    setConnectionData([]);
    setEdges((eds) => eds.filter((e) => !pendingIds.has(e.id)));
  }

  function getConnectionNodeLabel(nodeId: string): string {
    const node = nodes.find((n) => n.id === nodeId);
    return node ? (node.data as MapNodeData).label || "·" : "?";
  }

  const labeledNodeCount = nodes.filter(
    (n) => n.type === "mindmap" && (n.data as MapNodeData).label.trim().length > 0
  ).length;

  async function createMap(rootLabel: string) {
    setIsInitializing(true);

    // Create the map record
    const mapRes = await fetch("/api/maps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: rootLabel }),
    });

    if (!mapRes.ok) {
      setIsInitializing(false);
      return;
    }

    const mapData = (await mapRes.json()) as { map: { id: string } };
    const newMapId = mapData.map.id;
    isCreatedLocallyRef.current = true;
    setMapId(newMapId);
    onMapCreated?.(newMapId);

    // Canvas center — ReactFlow coordinate origin
    const cx = 0;
    const cy = 0;

    // Create root node
    const rootRes = await fetch("/api/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mapId: newMapId,
        label: rootLabel,
        fullConcept: rootLabel,
        positionX: cx,
        positionY: cy,
        depth: 0,
      }),
    });

    if (!rootRes.ok) {
      setIsInitializing(false);
      return;
    }

    const rootNodeData = (await rootRes.json()) as {
      node: { id: string };
    };
    const rootId = rootNodeData.node.id;

    // Build React Flow state with only the root node
    const rfRootNode: Node<MapNodeData> = {
      id: rootId,
      type: "mindmap",
      position: { x: cx, y: cy },
      data: {
        label: rootLabel,
        depth: 0,
        parentId: null,
        isSelected: false,
        isEditing: false,
        onLabelChange: () => { },
        onEditConfirm: () => { },
        onEditCancel: () => { },
        onEditExpand: () => { },
      },
    };

    setNodes([rfRootNode]);
    setEdges([]);

    // Select the root node (mostly for visual consistency if manual mode doesn't immediately grab focus)
    setSelectedNodeId(rootId);
    
    // Delegate child creation to the main expansion effect so it correctly
    // branches based on sliderMode (Manual = 3 blank children, Suggest = ghosts, Auto = recurse)
    setExpandRequest({ nodeId: rootId, label: rootLabel, isNewMap: true });

    setIsInitializing(false);
  }

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      setSelectedNodeId(node.id);
    },
    []
  );

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type !== "mindmap") return;
      prevLabelsRef.current[node.id] = (node.data as MapNodeData).label;
      setPendingLabel((node.data as MapNodeData).label);
      setSelectedNodeId(node.id);
      setEditingNodeId(node.id);
    },
    []
  );

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
    if (editingNodeId) {
      setEditingNodeId(null);
      scheduleSave();
    }
  }, [editingNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // No map exists yet — show root concept input
  if (!mapId) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <input
          data-root-input="true"
          autoFocus
          className="
            bg-transparent border-none outline-none
            text-[13px] font-medium text-center font-mono
            text-[#1a1a18] dark:text-[#e8e8e4]
            placeholder:text-[#A8A49E] dark:placeholder:text-[#5A5A56]
            w-64
          "
          placeholder="start with a word or concept"
          maxLength={20}
          value={rootInput}
          onChange={(e) => setRootInput(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && rootInput.trim().length > 0) {
              e.preventDefault();
              await createMap(rootInput.trim());
            }
          }}
          disabled={isInitializing}
        />
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.4 }}
        minZoom={0.3}
        maxZoom={2}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        panOnDrag
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        attributionPosition="bottom-right"
        style={{ background: "transparent" }}
      >
        <Background
          color="transparent"
          variant={BackgroundVariant.Dots}
          gap={0}
        />
      </ReactFlow>

      {/* Find connections button — visible when map is loaded */}
      <button
        onClick={handleFindConnections}
        disabled={isFindingConnections}
        className={`
          fixed left-1/2 -translate-x-1/2
          text-[10px] font-mono bg-transparent border-none
          text-[#6B6864] dark:text-[#AAAAA4]
          transition-opacity
          ${labeledNodeCount >= 4 && !isFindingConnections
            ? "cursor-pointer hover:opacity-70"
            : "pointer-events-none opacity-30"}
        `}
        style={{ bottom: "96px" }}
      >
        {isFindingConnections ? "thinking..." : "find connections"}
      </button>

      {/* Connection panel — only when pending connections exist */}
      {connectionData.length > 0 && (
        <div
          className="
            fixed bottom-6 right-6
            bg-[#FAFAF8] dark:bg-[#111110]
            border border-[#A8A49E] dark:border-[#5A5A56]
            rounded-lg p-3 max-w-[240px] font-mono z-10
          "
        >
          <div className="text-[11px] text-[#6B6864] dark:text-[#AAAAA4] mb-2">
            connections
          </div>
          {connectionData.map((conn) => (
            <div key={conn.id} className="mb-3">
              <div className="text-[12px] text-[#1a1a18] dark:text-[#e8e8e4]">
                {getConnectionNodeLabel(conn.sourceId)} &mdash; {getConnectionNodeLabel(conn.targetId)}
              </div>
              <div className="text-[10px] text-[#6B6864] dark:text-[#AAAAA4] mt-0.5 mb-1">
                {conn.reason}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => handleConnectionKeep(conn.id)}
                  className="text-[10px] text-[#6B6864] dark:text-[#AAAAA4] bg-transparent border-none cursor-pointer p-0 hover:text-[#1a1a18] dark:hover:text-[#e8e8e4]"
                >
                  keep
                </button>
                <button
                  onClick={() => handleConnectionDismiss(conn.id)}
                  className="text-[10px] text-[#6B6864] dark:text-[#AAAAA4] bg-transparent border-none cursor-pointer p-0 hover:text-[#1a1a18] dark:hover:text-[#e8e8e4]"
                >
                  dismiss
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={handleDismissAll}
            className="text-[10px] text-[#6B6864] dark:text-[#AAAAA4] bg-transparent border-none cursor-pointer p-0 mt-1 hover:text-[#1a1a18] dark:hover:text-[#e8e8e4]"
          >
            dismiss all
          </button>
        </div>
      )}
    </div>
  );
}

function collectDescendants(
  nodeId: string,
  allNodes: Node[]
): Set<string> {
  const ids = new Set<string>([nodeId]);
  const children = allNodes.filter(
    (n) => (n.data as MapNodeData).parentId === nodeId
  );
  for (const child of children) {
    const desc = collectDescendants(child.id, allNodes);
    desc.forEach((id) => ids.add(id));
  }
  return ids;
}
