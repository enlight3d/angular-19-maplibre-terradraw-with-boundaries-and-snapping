import { StyleSpecification } from 'maplibre-gl';

export const style: StyleSpecification = {
  sources: {
    googleMaps: {
      tiles: [
        'https://mts0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        'https://mts1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        'https://mts2.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        'https://mts3.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      ],
      tileSize: 256,
      maxzoom: 24,
      scheme: 'xyz',
      attribution: 'Google Maps',
      type: 'raster',
    },
  },
  version: 8,
  layers: [
    {
      id: 'displayed-map-tile-layer',
      type: 'raster',
      source: 'googleMaps',
      maxzoom: 24,
    },
  ],
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
};
