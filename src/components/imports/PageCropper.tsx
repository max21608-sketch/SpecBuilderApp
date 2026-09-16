"use client";

// Drag a rectangle over a rendered page.
//
// ONE IMPLEMENTATION, used by the item picture and by a finish swatch. They
// crop the same pages for different reasons, and a second copy is how the two
// start disagreeing about what a click means — the 2% minimum below is the
// difference between "no crop" and a one-pixel smear the reviewer has to
// notice and undo.
//
// Coordinates come back as FRACTIONS of the page, which is the same shape the
// model reports for a view region, so a hand-drawn box and a proposed one are
// the same kind of thing to everything downstream.
import { useRef, useState } from "react";
import type { CropBox } from "@/lib/pdf-crop";
import Button from "@/components/ui/Button";

export default function PageCropper({
  pageImage,
  onPicked,
  onCancel,
}: {
  pageImage: string;
  onPicked: (bbox: CropBox) => void;
  onCancel: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);

  const pointFrom = (event: React.MouseEvent) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const rect =
    start && current
      ? {
          left: `${Math.min(start.x, current.x) * 100}%`,
          top: `${Math.min(start.y, current.y) * 100}%`,
          width: `${Math.abs(current.x - start.x) * 100}%`,
          height: `${Math.abs(current.y - start.y) * 100}%`,
        }
      : null;

  return (
    <div className="mt-3">
      <p className="text-xs text-neutral-500">
        Drag over the picture you want. Release to use it.
        <Button size="xs" variant="quiet" className="ml-2" onClick={onCancel}>
          Cancel
        </Button>
      </p>
      <div
        ref={boxRef}
        onMouseDown={(event) => {
          const point = pointFrom(event);
          if (!point) return;
          setStart(point);
          setCurrent(point);
        }}
        onMouseMove={(event) => {
          if (!start) return;
          setCurrent(pointFrom(event));
        }}
        onMouseUp={() => {
          if (!start || !current) return;
          const bbox: CropBox = [
            Math.min(start.x, current.x),
            Math.min(start.y, current.y),
            Math.max(start.x, current.x),
            Math.max(start.y, current.y),
          ];
          setStart(null);
          setCurrent(null);
          // A click rather than a drag is not a crop. Ignoring it beats
          // capturing a one-pixel smear the reviewer then has to undo.
          if (bbox[2] - bbox[0] < 0.02 || bbox[3] - bbox[1] < 0.02) return;
          onPicked(bbox);
        }}
        className="relative mt-2 inline-block border border-neutral-300 cursor-crosshair select-none"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- blob URL */}
        <img src={pageImage} alt="" draggable={false} className="block max-h-[28rem] w-auto" />
        {rect && <div style={rect} className="absolute border-2 border-neutral-900 bg-neutral-900/10" />}
      </div>
    </div>
  );
}
