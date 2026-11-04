import { useMemo } from 'react';
import './GrandQCOverlay.css';

// GrandQC GeoJSON uses slide level-0 pixel coordinates (not ROI offsets).
export function qcClass(feature) {
  const props = feature?.properties || {};
  const value = props.class_id ?? props.classId ?? props.label_id ?? props.class ??
    props.classification ?? props.label ?? props.name ?? props.type ?? props.category;
  const raw = value && typeof value === 'object'
    ? (value.name ?? value.label ?? value.id ?? value.value)
    : value;
  const labels = {
    '1': 'Normal Tissue', '2': 'Fold', '3': 'Darkspot & Foreign Object',
    '4': 'Pen Marking', '5': 'Edge & Air Bubble', '6': 'Out of Focus',
    '7': 'Background',
  };
  if (raw == null || raw === '') return 'Unclassified';
  return labels[String(raw)] || String(raw);
}

const PALETTE = {
  'Normal Tissue': '#3b9f82', 'Fold': '#f59e0b',
  'Darkspot & Foreign Object': '#c45e42', 'Pen Marking': '#a855f7',
  'Edge & Air Bubble': '#06b6d4', 'Out of Focus': '#e11d48',
  'Background': '#64748b', 'Unclassified': '#f97316',
};
export function qcClassColor(name) {
  return PALETTE[name] || '#d97706';
}

function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates || [];
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).flatMap((polygon) => polygon);
  return [];
}

export default function GrandQCOverlay({ geojson, imageToViewport, hiddenClasses, visible, onSelect }) {
  const polygons = useMemo(() => {
    if (!Array.isArray(geojson?.features)) return [];
    return geojson.features.flatMap((feature, index) => {
      const type = qcClass(feature);
      return ringsOf(feature.geometry).map((ring, ringIndex) => ({
        key: `${index}-${ringIndex}`, type, ring, feature, index,
      }));
    });
  }, [geojson]);

  if (!visible) return null;
  return (
    <g className="grandqc-overlay-layer" aria-label="GrandQC artifact annotations">
      {polygons.filter(({ type }) => !hiddenClasses?.has(type)).map(({ key, type, ring, feature, index }) => {
        const points = ring.filter((xy) => Array.isArray(xy) && xy.length >= 2 &&
          Number.isFinite(Number(xy[0])) && Number.isFinite(Number(xy[1])))
          .map(([x, y]) => imageToViewport(Number(x), Number(y)));
        if (points.length < 3) return null;
        const path = `M ${points.map(({ x, y }) => `${x} ${y}`).join(' L ')} Z`;
        return (
          <path key={key} d={path} fill={qcClassColor(type)} fillOpacity="0.12"
            stroke={qcClassColor(type)} strokeWidth="1.6" strokeOpacity="0.95"
            fillRule="evenodd" vectorEffect="non-scaling-stroke"
            onClick={(event) => { event.stopPropagation(); onSelect?.({ type, feature, index }); }}>
            <title>{`GrandQC: ${type} · region ${index + 1}`}</title>
          </path>
        );
      })}
    </g>
  );
}
