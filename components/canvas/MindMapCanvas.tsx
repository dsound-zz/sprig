"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactFlow, {
  useNodesState,
  useEdgesState,
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type OnNodesChange,
} from "reactflow";
import "reactflow/dist/style.css";
import { MapNode, type MapNodeData } from "./MapNode";
import { GhostNode, type GhostNodeData } from "./GhostNode";

// Node types must be defined outside the component to prevent remounting
const nodeTypes = {
  mindmap: MapNode,
  ghost: GhostNode,
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

type Props = {
  initialMapId: string | null;
  userId: string;
};

export function MindMapCanvas({ initialMapId, userId }: Props) {
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
  const [expandRequest, setExpandRequest] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLabelsRef = useRef<Record<string, string>>({});

  // Load map on mount if one exists
  useEffect(() => {
    if (!initialMapId) return;

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
        }>;
      };

      const rfNodes: Node<MapNodeData>[] = data.nodes.map((n) => ({
        id: n.id,
        type: "mindmap",
        position: { x: n.positionX, y: n.positionY },
        data: {
          label: n.label,
          depth: n.depth,
          parentId: n.parentId,
          isSelected: false,
          isEditing: false,
          onLabelChange: () => { },
          onEditConfirm: () => { },
          onEditCancel: () => { },
          onEditExpand: () => { },
        },
      }));

      const rfEdges: Edge[] = data.edges.map((e) => ({
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        style: {
          stroke: "var(--edge-color)",
          strokeWidth: 0.8,
        },
      }));

      setNodes(rfNodes);
      setEdges(rfEdges);
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
      onEditExpand: () => {
        setExpandRequest(nodeId);
      },
    }),
    [setNodes, setExpandRequest, mapId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Keep node data in sync with selection/editing state
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== "mindmap") return n;
        const isSelected = n.id === selectedNodeId;
        const isEditing = n.id === editingNodeId;
        const handlers = getNodeHandlers(n.id, (n.data as MapNodeData).label);
        return {
          ...n,
          data: {
            ...(n.data as MapNodeData),
            isSelected,
            isEditing,
            ...handlers,
          },
        };
      })
    );
  }, [selectedNodeId, editingNodeId, getNodeHandlers, setNodes]);

  // Expand a node into 3 blank children when a label is confirmed for the first time
  useEffect(() => {
    if (!expandRequest || !mapId) return;

    const nodeId = expandRequest;
    setExpandRequest(null);

    const parentNode = nodes.find((n) => n.id === nodeId);
    if (!parentNode) return;

    const confirmedLabel = (parentNode.data as MapNodeData).label;
    if (!confirmedLabel.trim()) return;

    const hasChildren = nodes.some(
      (n) => (n.data as MapNodeData).parentId === nodeId
    );
    if (hasChildren) return;

    const { x: px, y: py } = parentNode.position;
    const parentDepth = (parentNode.data as MapNodeData).depth;
    const currentMapId = mapId;

    (async () => {
      // Determine the grandparent position to compute angle inheritance
      const grandparentId = (parentNode.data as MapNodeData).parentId;
      const grandparentNode = grandparentId
        ? nodes.find((n) => n.id === grandparentId)
        : null;
      const grandparentPos = grandparentNode
        ? grandparentNode.position
        : null;

      const childAngles = computeChildAngles(
        { x: px, y: py },
        grandparentPos
      );

      // Existing node centers for overlap detection
      const existingCenters = nodes.map((n) => ({
        x: n.position.x,
        y: n.position.y,
      }));

      // Place children and nudge each one away from existing nodes
      const childPositions = childAngles.map((angle) => {
        const raw = radialPosition(px, py, angle);
        return nudgeForSeparation(raw, existingCenters);
      });
      const newChildIds: string[] = [];

      for (const pos of childPositions) {
        const res = await fetch("/api/nodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mapId: currentMapId,
            parentId: nodeId,
            label: "",
            fullConcept: "",
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
          body: JSON.stringify({
            mapId: currentMapId,
            sourceId: nodeId,
            targetId: childId,
          }),
        });
      }

      const newRfNodes: Node<MapNodeData>[] = newChildIds.map((id, i) => ({
        id,
        type: "mindmap",
        position: childPositions[i],
        data: {
          label: "",
          depth: parentDepth + 1,
          parentId: nodeId,
          isSelected: false,
          isEditing: false,
          onLabelChange: () => { },
          onEditConfirm: () => { },
          onEditCancel: () => { },
          onEditExpand: () => { },
        },
      }));

      const newRfEdges: Edge[] = newChildIds.map((childId) => ({
        id: `e-${nodeId}-${childId}`,
        source: nodeId,
        target: childId,
        style: { stroke: "var(--edge-color)", strokeWidth: 0.8 },
      }));

      setNodes((nds) => [...nds, ...newRfNodes]);
      setEdges((eds) => [...eds, ...newRfEdges]);

      if (newChildIds.length > 0) {
        setSelectedNodeId(newChildIds[0]);
        prevLabelsRef.current[newChildIds[0]] = "";
        setEditingNodeId(newChildIds[0]);
      }
    })();
  }, [expandRequest]); // eslint-disable-line react-hooks/exhaustive-deps

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
          setExpandRequest(editingNodeId);
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

    // Remove the node and all its descendants from local state
    const idsToRemove = collectDescendants(nodeId, nodes);
    setNodes((nds) => nds.filter((n) => !idsToRemove.has(n.id)));
    setEdges((eds) =>
      eds.filter(
        (e) => !idsToRemove.has(e.source) && !idsToRemove.has(e.target)
      )
    );
    setSelectedNodeId(null);
  }

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
    setMapId(newMapId);

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

    // Create 3 blank child nodes at radial positions (root uses fixed left-biased fan)
    const childPositions = ROOT_CHILD_ANGLES.map((angle) =>
      radialPosition(cx, cy, angle)
    );

    const childIds: string[] = [];
    for (const pos of childPositions) {
      const childRes = await fetch("/api/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapId: newMapId,
          parentId: rootId,
          label: "",
          fullConcept: "",
          positionX: pos.x,
          positionY: pos.y,
          depth: 1,
        }),
      });

      if (childRes.ok) {
        const childData = (await childRes.json()) as { node: { id: string } };
        childIds.push(childData.node.id);
      }
    }

    // Persist edges to DB
    for (const childId of childIds) {
      await fetch("/api/edges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapId: newMapId, sourceId: rootId, targetId: childId }),
      });
    }

    // Build React Flow state
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

    const rfChildNodes: Node<MapNodeData>[] = childIds.map((id, i) => ({
      id,
      type: "mindmap",
      position: childPositions[i],
      data: {
        label: "",
        depth: 1,
        parentId: rootId,
        isSelected: false,
        isEditing: false,
        onLabelChange: () => { },
        onEditConfirm: () => { },
        onEditCancel: () => { },
        onEditExpand: () => { },
      },
    }));

    const rfEdges: Edge[] = childIds.map((childId) => ({
      id: `e-${rootId}-${childId}`,
      source: rootId,
      target: childId,
      style: { stroke: "#CCCAC4", strokeWidth: 0.8 },
    }));

    setNodes([rfRootNode, ...rfChildNodes]);
    setEdges(rfEdges);

    // Auto-focus first child in edit mode
    if (childIds.length > 0) {
      setSelectedNodeId(childIds[0]);
      prevLabelsRef.current[childIds[0]] = "";
      setEditingNodeId(childIds[0]);
    }

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
            placeholder:text-[#CCCAC4] dark:placeholder:text-[#3A3A38]
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
