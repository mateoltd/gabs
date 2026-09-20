import { useId, useRef, useState } from "react";
import type { OrganizationPolicy, Rank } from "@suite/module-sdk/governance";
import { Button, Field, SearchSelect } from "@suite/ui-web";

export function OrganizationChart({
  policy,
  zoom,
  matchingRanks,
  matchDescription,
  onSelect,
  onChange,
}: {
  policy: OrganizationPolicy;
  zoom: number;
  matchingRanks: Set<string>;
  matchDescription: string;
  onSelect(id: string): void;
  onChange(policy: OrganizationPolicy): void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<
    | { id?: string; x: number; y: number; startX: number; startY: number }
    | undefined
  >(undefined);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [frame, setFrame] = useState({ width: 1000, height: 500 });
  const suppressClick = useRef(false);
  const [found, setFound] = useState("");
  const instructions = useId();
  const bounds = {
    width: Math.max(1000, ...policy.ranks.map((rank) => rank.x + 200)),
    height: Math.max(500, ...policy.ranks.map((rank) => rank.y + 90)),
  };
  const width = frame.width / zoom;
  const height = frame.height / zoom;
  const camera = {
    x: Math.max(0, Math.min(position.x, Math.max(0, bounds.width - width))),
    y: Math.max(0, Math.min(position.y, Math.max(0, bounds.height - height))),
  };
  const focusRank = (rank: Rank, reveal = false) => {
    if (
      reveal ||
      rank.x < camera.x ||
      rank.y < camera.y ||
      rank.x + 160 > camera.x + width ||
      rank.y + 50 > camera.y + height
    ) {
      setFrame({ width: 1000, height: 500 });
      setPosition({
        x: Math.max(0, rank.x + 80 - 500 / zoom),
        y: Math.max(0, rank.y + 25 - 250 / zoom),
      });
    }
  };
  const point = (element: SVGGraphicsElement, x: number, y: number) => {
    const matrix = element.getScreenCTM();
    return matrix
      ? new DOMPoint(x, y).matrixTransform(matrix.inverse())
      : undefined;
  };
  return (
    <>
      <div className="organization-classification">
        <Field label="Find role in chart">
          <SearchSelect
            options={policy.ranks.map((rank) => ({
              value: rank.id,
              label: rank.name,
            }))}
            value={found}
            onValueChange={(id) => {
              setFound(id);
              const rank = policy.ranks.find((item) => item.id === id);
              if (!rank) return;
              focusRank(rank, true);
              requestAnimationFrame(() =>
                svg.current
                  ?.querySelector<SVGGElement>(`[data-rank-id="${id}"]`)
                  ?.focus(),
              );
            }}
            placeholder="Search roles"
            clearLabel="Clear role search"
          />
        </Field>
        <Button
          onClick={() => {
            setFrame({
              width: bounds.width * zoom,
              height: bounds.height * zoom,
            });
            setPosition({ x: 0, y: 0 });
          }}
        >
          Fit chart
        </Button>
      </div>
      <p id={instructions} className="sr-only">
        Drag the chart background or use arrow keys to pan. Find a role to bring
        it into view, then press Enter to configure it.
      </p>
      <div className="organization-canvas">
        <svg
          ref={svg}
          viewBox={`${camera.x} ${camera.y} ${width} ${height}`}
          role="group"
          tabIndex={0}
          aria-roledescription="Organization chart"
          aria-label="Organization hierarchy"
          aria-describedby={instructions}
          onKeyDown={(event) => {
            const direction = (
              {
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0],
                ArrowUp: [0, -1],
                ArrowDown: [0, 1],
              } as Record<string, number[]>
            )[event.key];
            if (!direction) return;
            event.preventDefault();
            setPosition({
              x: Math.max(0, camera.x + (direction[0] * width) / 5),
              y: Math.max(0, camera.y + (direction[1] * height) / 5),
            });
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const p = point(event.currentTarget, event.clientX, event.clientY);
            if (!p) return;
            drag.current = {
              x: p.x,
              y: p.y,
              startX: camera.x,
              startY: camera.y,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (!current || !svg.current) return;
            const p = point(svg.current, event.clientX, event.clientY);
            if (!p) return;
            if (current.id) {
              if (Math.abs(p.x - current.x) + Math.abs(p.y - current.y) > 5)
                suppressClick.current = true;
              const x = Math.max(
                0,
                Math.round((current.startX + p.x - current.x) / 10) * 10,
              );
              const y = Math.max(
                0,
                Math.round((current.startY + p.y - current.y) / 10) * 10,
              );
              onChange({
                ...policy,
                ranks: policy.ranks.map((rank) =>
                  rank.id === current.id ? { ...rank, x, y } : rank,
                ),
              });
            } else {
              setPosition({
                x: Math.max(0, camera.x + current.x - p.x),
                y: Math.max(0, camera.y + current.y - p.y),
              });
            }
          }}
          onPointerUp={() => {
            drag.current = undefined;
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
        >
          {policy.ranks.flatMap((rank) =>
            rank.parents.map((id) => {
              const parent = policy.ranks.find((item) => item.id === id);
              return parent ? (
                <path
                  key={`${id}/${rank.id}`}
                  d={`M${parent.x + 80},${parent.y + 50} L${rank.x + 80},${rank.y}`}
                  fill="none"
                  stroke="currentColor"
                />
              ) : null;
            }),
          )}
          {policy.ranks.map((rank) => (
            <g
              key={rank.id}
              data-rank-id={rank.id}
              role="button"
              tabIndex={0}
              aria-label={`Configure ${rank.name}`}
              aria-describedby={
                matchingRanks.has(rank.id) ? matchDescription : undefined
              }
              data-classification-match={
                matchingRanks.has(rank.id) || undefined
              }
              transform={`translate(${rank.x},${rank.y})`}
              onFocus={() => focusRank(rank)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(rank.id);
                }
              }}
              onClick={() => {
                if (!suppressClick.current) onSelect(rank.id);
                suppressClick.current = false;
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                suppressClick.current = false;
                if (event.button !== 0 || !svg.current) return;
                const p = point(svg.current, event.clientX, event.clientY);
                if (!p) return;
                drag.current = {
                  id: rank.id,
                  x: p.x,
                  y: p.y,
                  startX: rank.x,
                  startY: rank.y,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
            >
              <rect
                width="160"
                height="50"
                rx="8"
                fill="var(--surface)"
                stroke="currentColor"
              />
              <text x="10" y="30" fill="currentColor">
                {rank.name.slice(0, 20)}
              </text>
              {matchingRanks.has(rank.id) && (
                <circle
                  cx="146"
                  cy="11"
                  r="3"
                  fill="currentColor"
                  aria-hidden="true"
                />
              )}
            </g>
          ))}
        </svg>
        <svg
          className="organization-minimap"
          viewBox={`0 0 ${bounds.width} ${bounds.height}`}
          aria-label="Organization overview"
          role="img"
          onPointerDown={(event) => {
            const p = point(event.currentTarget, event.clientX, event.clientY);
            if (p)
              setPosition({
                x: Math.max(0, p.x - width / 2),
                y: Math.max(0, p.y - height / 2),
              });
          }}
        >
          {policy.ranks.map((rank) => (
            <rect
              key={rank.id}
              x={rank.x}
              y={rank.y}
              width="160"
              height="50"
              fill="currentColor"
              data-classification-match={
                matchingRanks.has(rank.id) || undefined
              }
            />
          ))}
          <rect
            x={camera.x}
            y={camera.y}
            width={Math.min(width, bounds.width)}
            height={Math.min(height, bounds.height)}
            fill="none"
            stroke="var(--text)"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </>
  );
}
