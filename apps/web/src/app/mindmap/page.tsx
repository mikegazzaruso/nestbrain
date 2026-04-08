"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface GraphNode {
  id: string;
  label: string;
  type: "concept" | "source" | "output";
  path: string;
  connections: number;
}

interface GraphLink { source: string; target: string; }
interface GraphData { nodes: GraphNode[]; links: GraphLink[]; }

interface TreeNode {
  node: GraphNode;
  children: TreeNode[];
  x: number;
  y: number;
  r: number;
  depth: number;
}

const TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  concept: { color: "#6c9cfc", label: "Concepts" },
  source: { color: "#c084fc", label: "Sources" },
};

function buildTree(data: GraphData): TreeNode[] {
  if (data.nodes.length === 0) return [];

  const adj = new Map<string, Set<string>>();
  for (const n of data.nodes) adj.set(n.id, new Set());
  for (const l of data.links) { adj.get(l.source)?.add(l.target); adj.get(l.target)?.add(l.source); }

  const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const roots: TreeNode[] = [];

  // Score each node for "root worthiness"
  // Concepts > sources. Among concepts: more connections to OTHER concepts = better root.
  function rootScore(n: GraphNode): number {
    if (n.type === "source") return -1000; // sources should never be root
    // Count connections to other concepts only
    const neighbors = adj.get(n.id) ?? new Set();
    let conceptConns = 0;
    for (const nId of neighbors) {
      const neighbor = nodeMap.get(nId);
      if (neighbor?.type === "concept") conceptConns++;
    }
    return conceptConns * 10 + n.connections;
  }

  const remaining = [...data.nodes].sort((a, b) => rootScore(b) - rootScore(a));

  while (remaining.length > 0) {
    const rootNode = remaining.find((n) => !visited.has(n.id));
    if (!rootNode) break;

    const root: TreeNode = { node: rootNode, children: [], x: 0, y: 0, r: 0, depth: 0 };
    visited.add(rootNode.id);

    // BFS: concepts first, then sources as leaves
    const queue: TreeNode[] = [root];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const neighbors = [...(adj.get(cur.node.id) ?? new Set())];

      // Sort: concepts first (by connections desc), then sources
      const sorted = neighbors
        .filter((nId) => !visited.has(nId) && nodeMap.has(nId))
        .map((nId) => nodeMap.get(nId)!)
        .sort((a, b) => {
          if (a.type === "concept" && b.type !== "concept") return -1;
          if (a.type !== "concept" && b.type === "concept") return 1;
          return b.connections - a.connections;
        });

      for (const n of sorted) {
        if (visited.has(n.id)) continue;
        visited.add(n.id);
        const child: TreeNode = { node: n, children: [], x: 0, y: 0, r: 0, depth: cur.depth + 1 };
        cur.children.push(child);
        queue.push(child);
      }
    }

    roots.push(root);
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (visited.has(remaining[i].id)) remaining.splice(i, 1);
    }
  }

  // Orphan nodes
  for (const n of data.nodes) {
    if (!visited.has(n.id)) {
      roots.push({ node: n, children: [], x: 0, y: 0, r: 0, depth: 0 });
    }
  }

  return roots;
}

function layoutTree(root: TreeNode, startX: number, startY: number): { width: number; height: number } {

  function subtreeSize(n: TreeNode): number {
    if (n.children.length === 0) return 1;
    return n.children.reduce((s, c) => s + subtreeSize(c), 0);
  }

  // Radial layout: place children in concentric rings around parent
  function layoutRadial(parent: TreeNode, children: TreeNode[], depth: number, baseRadius: number, angleStart: number, angleEnd: number) {
    if (children.length === 0) return;

    // Ensure minimum angular spacing so nodes never overlap
    const MIN_ARC_DISTANCE = 50; // minimum pixels between adjacent nodes on the arc
    const minAnglePerNode = MIN_ARC_DISTANCE / baseRadius;
    const neededAngle = children.length > 1 ? (children.length - 1) * minAnglePerNode : 0;
    let angleRange = angleEnd - angleStart;

    // If the arc is too tight, expand the radius
    let r = baseRadius;
    if (neededAngle > angleRange && children.length > 1) {
      r = Math.max(baseRadius, (children.length - 1) * MIN_ARC_DISTANCE / angleRange);
    }

    // Recalculate with actual radius
    const actualMinAngle = MIN_ARC_DISTANCE / r;
    const actualNeeded = children.length > 1 ? (children.length - 1) * actualMinAngle : 0;

    // Center the children within the available arc
    const usedAngle = Math.max(angleRange, actualNeeded);
    const midAngle = (angleStart + angleEnd) / 2;
    const effectiveStart = midAngle - usedAngle / 2;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const t = children.length === 1 ? 0.5 : i / (children.length - 1);
      const angle = effectiveStart + t * usedAngle;

      const hasGrandchildren = child.children.length > 0;
      const nodeR = r + (hasGrandchildren ? 20 : 0);

      child.x = parent.x + Math.cos(angle) * nodeR;
      child.y = parent.y + Math.sin(angle) * nodeR;
      child.depth = depth;
      child.r = child.node.type === "source" ? 7 : Math.max(8, 16 - depth * 3);

      // Recursively layout grandchildren
      if (child.children.length > 0) {
        const subSpread = Math.max(
          child.children.length * minAnglePerNode,
          Math.min(usedAngle / children.length * 2, Math.PI * 0.6)
        );
        const nextRadius = 100 + child.children.length * 15;
        layoutRadial(child, child.children, depth + 1, nextRadius, angle - subSpread / 2, angle + subSpread / 2);
      }
    }
  }

  // Root
  root.x = startX;
  root.y = startY;
  root.depth = 0;
  root.r = 22;

  if (root.children.length === 0) {
    return { width: 100, height: 100 };
  }

  // Separate sources from concepts
  const concepts = root.children.filter((c) => c.node.type === "concept");
  const sources = root.children.filter((c) => c.node.type !== "concept");

  const totalChildren = concepts.length + sources.length;

  // Distribute all children around 360 degrees
  // Concepts get the top 270 degrees, sources get the bottom 90 degrees
  const conceptAngle = sources.length > 0 ? Math.PI * 1.5 : Math.PI * 2;
  const baseRadius = Math.max(150, 80 + totalChildren * 8);

  // Layout concepts
  if (concepts.length > 0) {
    const startAngle = -Math.PI / 2 - conceptAngle / 2; // start from top-left
    layoutRadial(root, concepts, 1, baseRadius, startAngle, startAngle + conceptAngle);
  }

  // Layout sources in remaining arc at bottom
  if (sources.length > 0) {
    const sourceStartAngle = Math.PI / 2 - Math.PI * 0.25;
    const sourceEndAngle = Math.PI / 2 + Math.PI * 0.25;
    const sourceRadius = baseRadius * 0.7;
    for (let i = 0; i < sources.length; i++) {
      const t = sources.length === 1 ? 0.5 : i / (sources.length - 1);
      const angle = sourceStartAngle + t * (sourceEndAngle - sourceStartAngle);
      sources[i].x = startX + Math.cos(angle) * sourceRadius;
      sources[i].y = startY + Math.sin(angle) * sourceRadius;
      sources[i].depth = 1;
      sources[i].r = 7;
    }
  }

  // Calculate bounding box
  const all = collectNodes([root]);
  let maxDist = 0;
  for (const n of all) {
    const dx = n.x - startX, dy = n.y - startY;
    maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
  }
  const size = maxDist * 2 + 100;

  return { width: size, height: size };
}

function collectNodes(roots: TreeNode[]): TreeNode[] {
  const all: TreeNode[] = [];
  function walk(n: TreeNode) { all.push(n); for (const c of n.children) walk(c); }
  for (const r of roots) walk(r);
  return all;
}

export default function MindMapPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // All mutable state as refs for use in event handlers
  const zoom = useRef(1);
  const pan = useRef({ x: 0, y: 0 });
  const hovered = useRef<string | null>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const lastMouse = useRef({ x: 0, y: 0 });
  const treeRoots = useRef<TreeNode[]>([]);
  const allNodes = useRef<TreeNode[]>([]);
  const animT = useRef(0);
  const animFrame = useRef(0);
  const drawScheduled = useRef(false);

  function scheduleDraw() {
    if (drawScheduled.current) return;
    drawScheduled.current = true;
    requestAnimationFrame(() => { drawScheduled.current = false; draw(); });
  }

  function fitToView() {
    if (allNodes.current.length === 0) { zoom.current = 1; pan.current = { x: 0, y: 0 }; return; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of allNodes.current) { minX = Math.min(minX, n.x - 60); maxX = Math.max(maxX, n.x + 60); minY = Math.min(minY, n.y - 40); maxY = Math.max(maxY, n.y + 40); }
    const gW = maxX - minX, gH = maxY - minY;
    const cX = (minX + maxX) / 2, cY = (minY + maxY) / 2;
    const fz = Math.min((dimensions.width - 60) / gW, (dimensions.height - 60) / gH, 2.5);
    zoom.current = Math.max(0.3, fz);
    pan.current = { x: -cX * zoom.current, y: -cY * zoom.current };
  }

  useEffect(() => { loadGraph(); }, []);
  useEffect(() => {
    function update() { if (containerRef.current) setDimensions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight }); }
    update(); window.addEventListener("resize", update); return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (graphData.nodes.length === 0) return;
    const roots = buildTree(graphData);
    let cy = 0;
    for (const r of roots) { const res = layoutTree(r, 0, cy); cy += res.height + 120; }
    treeRoots.current = roots;
    allNodes.current = collectNodes(roots);
    fitToView();
    animT.current = 0;
    animate();
  }, [graphData, dimensions]);

  function animate() {
    cancelAnimationFrame(animFrame.current);
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - start) / 1200);
      animT.current = 1 - Math.pow(1 - t, 3);
      draw();
      if (t < 1) animFrame.current = requestAnimationFrame(tick);
    }
    animFrame.current = requestAnimationFrame(tick);
  }

  useEffect(() => { scheduleDraw(); }, [selectedNode]);

  const getConnected = useCallback((nodeId: string | null): Set<string> => {
    if (!nodeId) return new Set();
    const s = new Set<string>([nodeId]);
    for (const l of graphData.links) { if (l.source === nodeId) s.add(l.target); if (l.target === nodeId) s.add(l.source); }
    return s;
  }, [graphData]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maybeCtx = canvas.getContext("2d");
    if (!maybeCtx) return;
    const ctx = maybeCtx;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    ctx.scale(dpr, dpr);
    const W = dimensions.width, H = dimensions.height;
    const z = zoom.current, px = pan.current.x, py = pan.current.y;

    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    const nodes = allNodes.current;
    if (nodes.length === 0) return;
    const p = animT.current;
    const activeId = hovered.current ?? selectedNode;
    const conn = getConnected(activeId);
    const hasAct = activeId !== null;

    ctx.save();
    ctx.translate(W / 2 + px, H / 2 + py);
    ctx.scale(z, z);

    // Branches
    function drawBranches(node: TreeNode, parentX?: number, parentY?: number) {
      const nx = node.x * p, ny = node.y * p;
      if (parentX !== undefined && parentY !== undefined) {
        const isHL = hasAct && (activeId === node.node.id || conn.has(node.node.id));
        const isDim = hasAct && !isHL;
        const midX = (parentX + nx) / 2;
        ctx.beginPath();
        ctx.moveTo(parentX, parentY);
        ctx.bezierCurveTo(midX, parentY, midX, ny, nx, ny);
        ctx.strokeStyle = isHL ? (TYPE_CONFIG[node.node.type]?.color ?? "#6c9cfc") + "60" : isDim ? "rgba(255,255,255,0.015)" : "rgba(255,255,255,0.045)";
        ctx.lineWidth = isHL ? Math.max(1, 3 - node.depth * 0.5) : Math.max(0.3, 1.5 - node.depth * 0.3);
        ctx.stroke();
      }
      for (const ch of node.children) drawBranches(ch, nx, ny);
    }
    for (const root of treeRoots.current) drawBranches(root);

    // Nodes
    for (const tn of nodes) {
      const x = tn.x * p, y = tn.y * p;
      const cfg = TYPE_CONFIG[tn.node.type] ?? TYPE_CONFIG.concept;
      const isAct = activeId === tn.node.id;
      const isConn = conn.has(tn.node.id);
      const isDim = hasAct && !isConn;
      const r = tn.r * (isAct ? 1.15 : 1);

      if (isAct) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        g.addColorStop(0, cfg.color + "22"); g.addColorStop(1, cfg.color + "00");
        ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      }

      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      grad.addColorStop(0, cfg.color + (isDim ? "10" : isAct ? "ff" : "cc"));
      grad.addColorStop(1, cfg.color + (isDim ? "05" : isAct ? "99" : "55"));
      ctx.fillStyle = grad; ctx.fill();
      ctx.strokeStyle = cfg.color + (isDim ? "05" : isAct ? "50" : "15");
      ctx.lineWidth = isAct ? 1.2 : 0.5; ctx.stroke();

      if (!isDim) { ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.15, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,255,255,${isAct ? 0.2 : 0.06})`; ctx.fill(); }

      if (isDim) continue;
      const fs = tn.depth === 0 ? 12 : Math.max(8, 10 - tn.depth);
      ctx.font = `${isAct || tn.depth === 0 ? 600 : 400} ${fs}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      const ly = y + r + 4;
      const m = ctx.measureText(tn.node.label);
      ctx.beginPath(); ctx.roundRect(x - (m.width + 6) / 2, ly - 1, m.width + 6, fs + 4, 2.5);
      ctx.fillStyle = isAct ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.4)"; ctx.fill();
      ctx.fillStyle = isAct ? "#fff" : `rgba(220,220,220,${isConn && hasAct ? 0.85 : 0.6})`;
      ctx.fillText(tn.node.label, x, ly);
    }
    ctx.restore();
  }

  function nodeAt(cx: number, cy: number): TreeNode | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const mx = (cx - rect.left - dimensions.width / 2 - pan.current.x) / zoom.current;
    const my = (cy - rect.top - dimensions.height / 2 - pan.current.y) / zoom.current;
    const p = animT.current;
    for (const n of allNodes.current) { const dx = mx - n.x * p, dy = my - n.y * p; if (dx * dx + dy * dy < (n.r + 6) * (n.r + 6)) return n; }
    return null;
  }

  function onMouseMove(e: React.MouseEvent) {
    const n = nodeAt(e.clientX, e.clientY);
    const newId = n?.node.id ?? null;
    if (newId !== hovered.current) { hovered.current = newId; scheduleDraw(); }
    if (canvasRef.current && !isDragging.current) canvasRef.current.style.cursor = n ? "pointer" : "grab";
  }

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    lastMouse.current = { x: e.clientX, y: e.clientY };
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - lastMouse.current.x;
      const dy = ev.clientY - lastMouse.current.y;
      pan.current = { x: pan.current.x + dx, y: pan.current.y + dy };
      lastMouse.current = { x: ev.clientX, y: ev.clientY };
      scheduleDraw();
    }
    function onUp(ev: MouseEvent) {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      isDragging.current = false;
      if (canvasRef.current) canvasRef.current.style.cursor = "grab";
      const moved = Math.abs(ev.clientX - dragStart.current.x) + Math.abs(ev.clientY - dragStart.current.y);
      if (moved < 5) {
        const n = nodeAt(ev.clientX, ev.clientY);
        if (n) {
          if (selectedNode === n.node.id) router.push(`/wiki?path=${encodeURIComponent(n.node.path)}`);
          else setSelectedNode(n.node.id);
        } else { setSelectedNode(null); }
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Wheel zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const newZoom = Math.min(6, Math.max(0.15, zoom.current * factor));
      // Scale pan to keep viewport center stable
      const ratio = newZoom / zoom.current;
      pan.current = { x: pan.current.x * ratio, y: pan.current.y * ratio };
      zoom.current = newZoom;
      scheduleDraw();
    }
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [dimensions, graphData]);

  async function loadGraph() {
    try { const res = await fetch("/api/wiki/graph"); setGraphData(await res.json()); }
    catch { setGraphData({ nodes: [], links: [] }); }
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="h-12 border-b border-border flex items-center justify-between px-6 shrink-0">
        <h1 className="text-sm font-medium">Mind Map</h1>
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-4 text-[11px] text-muted/60">
            {Object.entries(TYPE_CONFIG).map(([key, c]) => (
              <span key={key} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color, boxShadow: `0 0 6px ${c.color}40` }} />
                {c.label}
              </span>
            ))}
          </div>
          <span className="text-[11px] text-muted/30">{graphData.nodes.length} nodes · {graphData.links.length} connections</span>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 relative">
        {graphData.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]">
            <div className="text-center text-muted"><div className="text-5xl mb-4">🕸️</div><p className="text-sm text-muted/50">No concepts yet. Ingest sources and compile.</p></div>
          </div>
        ) : (
          <canvas ref={canvasRef} style={{ width: dimensions.width, height: dimensions.height }} className="absolute inset-0"
            onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseLeave={() => { hovered.current = null; scheduleDraw(); }} />
        )}

        {/* Zoom controls */}
        <div className="absolute bottom-6 right-6 z-20 flex flex-col gap-1">
          <button onClick={() => { const nz = Math.min(6, zoom.current * 1.3); const r = nz / zoom.current; pan.current = { x: pan.current.x * r, y: pan.current.y * r }; zoom.current = nz; scheduleDraw(); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-card/80 backdrop-blur-sm border border-border text-foreground/70 hover:text-foreground hover:bg-card transition-colors text-sm font-medium" title="Zoom in">+</button>
          <button onClick={() => { const nz = Math.max(0.15, zoom.current * 0.7); const r = nz / zoom.current; pan.current = { x: pan.current.x * r, y: pan.current.y * r }; zoom.current = nz; scheduleDraw(); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-card/80 backdrop-blur-sm border border-border text-foreground/70 hover:text-foreground hover:bg-card transition-colors text-sm font-medium" title="Zoom out">−</button>
          <button onClick={() => { fitToView(); scheduleDraw(); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-card/80 backdrop-blur-sm border border-border text-foreground/70 hover:text-foreground hover:bg-card transition-colors" title="Reset view">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 1 9 9"/><polyline points="3 21 3 12 12 12"/></svg>
          </button>
        </div>

        {selectedNode && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
            <div className="bg-card/90 backdrop-blur-md border border-border rounded-xl px-5 py-3 shadow-2xl flex items-center gap-4">
              <div>
                <p className="text-sm font-medium">{graphData.nodes.find((n) => n.id === selectedNode)?.label}</p>
                <p className="text-[11px] text-muted/50 mt-0.5">Click again to open</p>
              </div>
              <button onClick={() => { const n = graphData.nodes.find((n) => n.id === selectedNode); if (n) router.push(`/wiki?path=${encodeURIComponent(n.path)}`); }}
                className="px-3 py-1.5 bg-accent text-background text-xs font-medium rounded-lg hover:bg-accent-hover transition-colors">Open</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
