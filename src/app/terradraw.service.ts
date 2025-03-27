import {
  effect,
  inject,
  Injectable,
  Injector,
  signal,
  Signal,
} from '@angular/core';
import { point } from '@turf/helpers';
import * as turf from '@turf/turf';
import {
  MaplibreTerradrawControl,
  TerradrawMode,
} from '@watergis/maplibre-gl-terradraw';
import {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  Point,
  Polygon,
  Position,
} from 'geojson';
import { OnFinishContext } from 'node_modules/terra-draw/dist/common';
import {
  BaseAdapterConfig,
  FeatureId,
} from 'node_modules/terra-draw/dist/extend';
import { StoreValidation } from 'node_modules/terra-draw/dist/store/store';
import { Subject } from 'rxjs';
import {
  GeoJSONStoreFeatures,
  TerraDrawMouseEvent,
  ValidateNotSelfIntersecting,
} from 'terra-draw';
import { v4 as uuidv4 } from 'uuid';

// Terra Draw interfaces
export interface TerraDrawFeatureEvent {
  features: GeoJSONStoreFeatures[];
  type: string;
}

export interface TerraDrawOptions {
  boundary?: GeoJSON.Polygon;
  modes?: TerradrawMode[];
  showBoundary?: boolean | Signal<boolean>;
  snapToBoundary?: boolean | Signal<boolean>;
  snapToFeatures?: boolean | Signal<boolean>;
  existingFeatures?: string;
  adapterOptions?: BaseAdapterConfig;
  open?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class TerraDrawService {
  // Terra Draw instance
  draw = signal<MaplibreTerradrawControl | null>(null);
  map = signal<maplibregl.Map | null>(null);

  // Default boundary ID for Terra Draw features
  private BOUNDARY_ID = uuidv4();

  // Terra Draw state signals
  showBoundary = signal<boolean>(false);
  snapToBoundary = signal<boolean>(false);
  snapToFeatures = signal<boolean>(false);
  nearestSnapPoint = signal<Position | null>(null);

  // Store the boundary polygon for persistent reference
  boundary = signal<GeoJSON.Polygon | undefined>(undefined);

  // Event emitters
  featureChange = new Subject<TerraDrawFeatureEvent>();
  featureFinished = new Subject<TerraDrawFeatureEvent>();

  // Terra Draw constants
  private readonly SNAP_THRESHOLD = 50; // Snap distance threshold in pixels

  // Store the last known state of features to revert when needed
  private lastKnownFeatures = new Map<string, GeoJSONStoreFeatures>();

  constructor(private injector: Injector) {
    effect(() => {
      if (this.draw()) {
        const showBoundaryValue = this.showBoundary();
        const snapToBoundaryValue = this.snapToBoundary();
        const snapToFeaturesValue = this.snapToFeatures();

        console.log('Terra Draw options changed:', {
          showBoundary: showBoundaryValue,
          snapToBoundary: snapToBoundaryValue,
          snapToFeatures: snapToFeaturesValue,
        });

        this.updateModeOptions();
        this.setShowBoundary(showBoundaryValue);
      }
    });
  }

  mapLoad(map: maplibregl.Map) {
    this.map.set(map);
  }

  initTerraDraw(options?: TerraDrawOptions): MaplibreTerradrawControl | null {
    if (!this.map()) {
      console.error('Map must be loaded before initializing Terra Draw');
      return null;
    }

    try {
      if (options?.showBoundary !== undefined) {
        if (typeof options.showBoundary === 'boolean') {
          this.showBoundary.set(options.showBoundary);
        } else {
          this.showBoundary.set(options.showBoundary());
          effect(
            () => {
              this.showBoundary.set(
                (options.showBoundary as Signal<boolean>)()
              );
            },
            { injector: this.injector }
          );
        }
      }

      if (options?.snapToBoundary !== undefined) {
        if (typeof options.snapToBoundary === 'boolean') {
          this.snapToBoundary.set(options.snapToBoundary);
        } else {
          this.snapToBoundary.set(options.snapToBoundary());
          effect(
            () => {
              this.snapToBoundary.set(
                (options.snapToBoundary as Signal<boolean>)()
              );
            },
            { injector: this.injector }
          );
        }
      }

      if (options?.snapToFeatures !== undefined) {
        if (typeof options.snapToFeatures === 'boolean') {
          this.snapToFeatures.set(options.snapToFeatures);
        } else {
          this.snapToFeatures.set(options.snapToFeatures());
          effect(
            () => {
              this.snapToFeatures.set(
                (options.snapToFeatures as Signal<boolean>)()
              );
            },
            { injector: this.injector }
          );
        }
      }

      const drawControl = new MaplibreTerradrawControl({
        modes: options?.modes || [
          'render',
          'point',
          'linestring',
          'polygon',
          'rectangle',
          'circle',
          'freehand',
          'angled-rectangle',
          'sensor',
          'sector',
          'select',
          'delete-selection',
          'delete',
          'download',
        ],
        open: options?.open || true,
        adapterOptions: options?.adapterOptions || {
          coordinatePrecision: 20,
          minPixelDragDistance: 5,
          minPixelDragDistanceDrawing: 5,
          minPixelDragDistanceSelecting: 5,
        },
      });

      this.draw.set(drawControl);

      const map = this.map();
      if (!map) return null;

      if (options?.boundary) {
        this.boundary.set(options.boundary);
      }

      map.addControl(drawControl, 'top-left');

      map.once('load', () => {
        const terradraw = drawControl.getTerraDrawInstance();
        if (terradraw) {
          console.log('Got TerraDraw instance, initializing');
          if (options?.boundary && options?.showBoundary !== false) {
            const boundaryFeature = this.generateFeature(
              {
                type: 'Feature',
                geometry: options.boundary,
                properties: { name: 'Drawing Boundary' },
              },
              false,
              'render',
              this.BOUNDARY_ID
            );
            terradraw.addFeatures([boundaryFeature]);
          }

          if (options?.existingFeatures) {
            try {
              const features = JSON.parse(options.existingFeatures);
              if (features.type === 'FeatureCollection') {
                features.features.forEach(
                  (subFeature: GeoJSONStoreFeatures) => {
                    if (subFeature.properties) {
                      subFeature.properties['existing'] = true;
                    } else {
                      subFeature.properties = { existing: true };
                    }
                    terradraw.addFeatures([subFeature]);
                    if (subFeature.id) {
                      this.lastKnownFeatures.set(
                        String(subFeature.id),
                        JSON.parse(JSON.stringify(subFeature))
                      );
                    }
                  }
                );
              }
            } catch (error) {
              console.error('Error parsing existing features:', error);
            }
          }

          this.updateModeOptions(options);

          terradraw.on('finish', this.onDrawFinish.bind(this));
          terradraw.on('change', this.onDrawChange.bind(this));

          drawControl.on('feature-deleted', () => {
            const features = drawControl
              .getFeatures()
              ?.features.filter((f) => f.properties?.['mode'] !== 'render');
            if (features) {
              this.featureChange.next({ features, type: 'delete' });
            }
          });
        }
      });

      return drawControl;
    } catch (error) {
      console.error('Error initializing TerraDraw:', error);
      return null;
    }
  }

  generateFeature(
    data: GeoJSONStoreFeatures,
    isDraggable: boolean = true,
    mode: string = 'render',
    uuid = uuidv4()
  ): GeoJSONStoreFeatures {
    return {
      id: uuid,
      type: data.type,
      geometry: data.geometry,
      properties: { ...data.properties, mode, isDraggable },
    };
  }

  updateBoundary(
    newBoundary: GeoJSON.Polygon,
    redrawVisible: boolean = true
  ): void {
    this.boundary.set(newBoundary);
    const terradraw = this.draw()?.getTerraDrawInstance();
    if (!terradraw) return;
    terradraw.removeFeatures([this.BOUNDARY_ID]);
    if (redrawVisible && this.showBoundary()) {
      const boundaryFeature = this.generateFeature(
        {
          type: 'Feature',
          geometry: newBoundary,
          properties: { name: 'Drawing Boundary' },
        },
        false,
        'render',
        this.BOUNDARY_ID
      );
      terradraw.addFeatures([boundaryFeature]);
    }
    this.updateModeOptions();
    console.log('Boundary updated:', newBoundary);
  }

  setShowBoundary(value: boolean): void {
    this.showBoundary.set(value);
    const terradraw = this.draw()?.getTerraDrawInstance();
    if (!terradraw) return;
    const boundaryToUse = this.boundary();
    if (value && boundaryToUse) {
      const boundaryFeature = this.generateFeature(
        {
          type: 'Feature',
          geometry: boundaryToUse,
          properties: { name: 'Drawing Boundary' },
        },
        false,
        'render',
        this.BOUNDARY_ID
      );
      terradraw.addFeatures([boundaryFeature]);
    } else {
      terradraw.removeFeatures([this.BOUNDARY_ID]);
    }
  }

  setSnapToBoundary(value: boolean): void {
    this.snapToBoundary.set(value);
  }

  setSnapToFeatures(value: boolean): void {
    this.snapToFeatures.set(value);
  }

  toggleBoundaryVisibility(boundary?: GeoJSON.Polygon): void {
    this.setShowBoundary(!this.showBoundary());
    if (boundary && boundary !== this.boundary()) {
      this.boundary.set(boundary);
    }
  }

  toggleSnapToBoundary(): void {
    this.setSnapToBoundary(!this.snapToBoundary());
  }

  toggleSnapToFeatures(): void {
    this.setSnapToFeatures(!this.snapToFeatures());
  }

  updateModeOptions(options?: TerraDrawOptions): void {
    const terradraw = this.draw()?.getTerraDrawInstance();
    if (!terradraw) return;
    const isSnappingEnabled = this.snapToBoundary() || this.snapToFeatures();
    const boundary = options?.boundary || this.boundary();
    terradraw.updateModeOptions('point', {
      validation: (feature: GeoJSONStoreFeatures, context: any) =>
        this.validateWithinBoundary(feature, context, boundary),
      snapping: {
        toLine: true,
        toCoordinate: true,
        toCustom: isSnappingEnabled
          ? (event: TerraDrawMouseEvent) =>
              this.findNearestSnapPoint(event, boundary)
          : undefined,
      },
    });
    terradraw.updateModeOptions('linestring', {
      validation: (feature: GeoJSONStoreFeatures, context: any) =>
        this.validateWithinBoundary(feature, context, boundary),
      snapping: {
        toLine: true,
        toCoordinate: true,
        toCustom: isSnappingEnabled
          ? (event: TerraDrawMouseEvent) =>
              this.findNearestSnapPoint(event, boundary)
          : undefined,
      },
    });
    terradraw.updateModeOptions('polygon', {
      validation: (feature: GeoJSONStoreFeatures, context: any) =>
        this.validateWithinBoundary(feature, context, boundary),
      snapping: {
        toLine: true,
        toCoordinate: true,
        toCustom: isSnappingEnabled
          ? (event: TerraDrawMouseEvent) =>
              this.findNearestSnapPoint(event, boundary)
          : undefined,
      },
    });
  }

  // === MODIFICATIONS DES FONCTIONS CLÉS ===

  /**
   * Validation function for Terra Draw to ensure feature remains within boundary.
   * Pour les points, vérifie simplement.
   * Pour LineString et Polygon, vérifie que toutes les coordonnées (ou le premier anneau) sont à l'intérieur.
   */
  private validateWithinBoundary(
    feature: GeoJSONStoreFeatures,
    context: any,
    boundary?: GeoJSON.Polygon
  ): { valid: boolean; reason?: string } {
    const updateType = context.updateType;
    if (updateType === 'finish' || updateType === 'commit') {
      return ValidateNotSelfIntersecting(feature);
    }
    if (!boundary || feature.properties?.['existing']) {
      return { valid: true };
    }
    let valid = true;
    let reason: string | undefined;
    if (feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates;
      valid = turf.booleanPointInPolygon(point([lng, lat]), boundary);
      reason = valid ? undefined : 'Point must be inside the boundary polygon';
    } else if (feature.geometry.type === 'LineString') {
      valid = feature.geometry.coordinates.every((coord: number[]) =>
        this.isPointInBoundary(coord[0], coord[1], boundary)
      );
      reason = valid
        ? undefined
        : 'All points of the line must be inside the boundary polygon';
    } else if (feature.geometry.type === 'Polygon') {
      valid = feature.geometry.coordinates[0].every((coord: number[]) =>
        this.isPointInBoundary(coord[0], coord[1], boundary)
      );
      reason = valid
        ? undefined
        : 'All points of the polygon must be inside the boundary polygon';
    }
    if (!valid) {
      console.error('Validation failed:', reason);
    }
    return { valid, reason };
  }

  /**
   * Snapping function:
   * Recherche le point de snapping le plus proche parmi les candidats issus du boundary et des features dessinées,
   * en calculant directement la distance en pixels via la projection de la carte.
   */
  private findNearestSnapPoint(
    event: TerraDrawMouseEvent,
    boundary?: Polygon
  ): Position | undefined {
    if (!this.snapToBoundary() && !this.snapToFeatures()) return undefined;
    const currentPoint: Position = [event.lng, event.lat];
    const currentPointFeature = turf.point(currentPoint);
    console.log("currentPointFeature", currentPointFeature, currentPoint)
    const map = this.map();
    if (!map) return undefined;

    let bestCandidate: Feature<Point> | null = null;
    let bestPixelDistance = Infinity;

    const processCandidateLine = (line: Feature<LineString>) => {
      const candidate = turf.nearestPointOnLine(line, currentPointFeature);
      if (
        !candidate ||
        !candidate.properties ||
        typeof candidate.properties.dist !== 'number'
      )
        return;
      const candidateCoord = candidate.geometry.coordinates as [number, number];
      const screenPoint = map.project(currentPoint as [number, number]);
      const candidateScreenPoint = map.project(candidateCoord);
      const pixelDistance = Math.sqrt(
        Math.pow(screenPoint.x - candidateScreenPoint.x, 2) +
          Math.pow(screenPoint.y - candidateScreenPoint.y, 2)
      );
      if (pixelDistance < bestPixelDistance) {
        bestPixelDistance = pixelDistance;
        bestCandidate = candidate;
      }
    };

    // Candidats du boundary
    if (this.snapToBoundary() && boundary) {
      const boundaryLine = turf.lineString(boundary.coordinates[0]);
      processCandidateLine(boundaryLine);
    }
    // Candidats issus des features dessinées
    if (this.snapToFeatures()) {
      const terradraw = this.draw()?.getTerraDrawInstance();
      if (terradraw) {
        const features = terradraw.getSnapshot();
        const drawableFeatures = features.filter((feature) => {
          if (feature.properties?.['mode'] === 'render') return false;
          if (feature.properties?.['_terraformer']) return false;
          return true;
        });
        drawableFeatures.forEach((feature) => {
          const candidateLines = this.featureToLines(feature);
          candidateLines.forEach((line) => processCandidateLine(line));
        });
      }
    }

    if (bestCandidate && bestPixelDistance <= this.SNAP_THRESHOLD) {
      this.nearestSnapPoint.set(
        (bestCandidate as Feature<Point>).geometry.coordinates
      );
      return (bestCandidate as Feature<Point>).geometry.coordinates;
    }
    this.nearestSnapPoint.set(null);
    return undefined;
  }

  /**
   * Converts a GeoJSON feature to an array of LineString features for snapping.
   */
  private featureToLines(feature: GeoJSONStoreFeatures): Feature<LineString>[] {
    const lines: Feature<LineString>[] = [];
    if (feature.geometry.type === 'Point') {
      return [];
    } else if (feature.geometry.type === 'LineString') {
      lines.push(turf.lineString(feature.geometry.coordinates));
    } else if (feature.geometry.type === 'Polygon') {
      feature.geometry.coordinates.forEach((ring) => {
        lines.push(turf.lineString(ring));
      });
    }
    return lines;
  }

  /**
   * Découpe le polygone de boundary en sous-polygones à partir des lignes qui le traversent.
   * Si les extrémités d'une ligne ne touchent pas le boundary, elles sont automatiquement étendues.
   */
  getSubpolygons(
    customBoundary?: Polygon,
    customFeatures?: GeoJSONStoreFeatures[]
  ): Array<Feature<Polygon>> {
    const boundaryPolygon = customBoundary || this.boundary();
    if (!boundaryPolygon) {
      console.error('No boundary polygon available for subpolygon extraction');
      return [];
    }
    const features = customFeatures || this.getDrawnFeatures();
    console.log(
      'Extracting subpolygons from boundary:',
      JSON.stringify(boundaryPolygon),
      'features:',
      JSON.stringify(features)
    );
    const lineFeatures = features.filter(
      (f) => f.geometry.type === 'LineString'
    );
    if (lineFeatures.length === 0) {
      console.log('No linestrings found to cut the boundary');
      return [turf.feature(boundaryPolygon) as Feature<Polygon>];
    }
    const boundaryFeature = turf.feature(boundaryPolygon) as Feature<Polygon>;
    const boundaryLines = turf.polygonToLine(boundaryFeature);
    const toLineArray = (input: any): Array<Feature<LineString>> => {
      const allLines: Array<Feature<LineString>> = [];
      if (input.type === 'FeatureCollection') {
        for (const f of input.features) {
          if (f.geometry.type === 'LineString') {
            allLines.push(f as Feature<LineString>);
          } else if (f.geometry.type === 'MultiLineString') {
            for (const coords of f.geometry.coordinates) {
              allLines.push(turf.lineString(coords) as Feature<LineString>);
            }
          }
        }
      } else if (input.type === 'Feature') {
        if (input.geometry.type === 'LineString') {
          allLines.push(input as Feature<LineString>);
        } else if (input.geometry.type === 'MultiLineString') {
          for (const coords of input.geometry.coordinates) {
            allLines.push(turf.lineString(coords) as Feature<LineString>);
          }
        }
      }
      return allLines;
    };
    const boundaryLineArray = toLineArray(boundaryLines);

    const isPointOnBoundary = (
      pt: Feature<Point>,
      boundaries: Array<Feature<LineString>>,
      threshold: number = 0.01
    ): boolean => {
      for (const seg of boundaries) {
        const d = turf.pointToLineDistance(pt, seg, { units: 'kilometers' });
        if (d <= threshold) return true;
      }
      return false;
    };

    const extendPointToBoundary = (
      pt: Feature<Point>,
      direction: number,
      boundaries: Array<Feature<LineString>>,
      maxDistance: number = 100
    ): Feature<Point> | null => {
      const extendedPt = turf.destination(pt, maxDistance, direction, {
        units: 'kilometers',
      });
      const ray = turf.lineString([
        pt.geometry.coordinates,
        extendedPt.geometry.coordinates,
      ]);
      let closestIntersection: Feature<Point> | null = null;
      let minDist = Infinity;
      for (const seg of boundaries) {
        const intersectFC = turf.lineIntersect(
          seg,
          ray
        ) as FeatureCollection<Point>;
        for (const inter of intersectFC.features) {
          const d = turf.distance(pt, inter, { units: 'kilometers' });
          if (d < minDist) {
            minDist = d;
            closestIntersection = inter;
          }
        }
      }
      return closestIntersection;
    };

    const cutLines: Array<Feature<LineString>> = [];
    const orderPointsAlongLine = (
      line: Feature<LineString>,
      points: Array<Feature<Point>>
    ): Array<Feature<Point>> => {
      return points
        .map((pt) => {
          const snapped = turf.nearestPointOnLine(line, pt);
          const dist = snapped.properties?.location ?? 0;
          return { point: pt, dist };
        })
        .sort((a, b) => a.dist - b.dist)
        .map((item) => item.point);
    };
    const sliceLineByIntersections = (
      line: Feature<LineString>,
      sortedPoints: Array<Feature<Point>>
    ): Array<Feature<LineString>> => {
      const segments: Array<Feature<LineString>> = [];
      for (let i = 0; i < sortedPoints.length - 1; i += 2) {
        const start = sortedPoints[i];
        const end = sortedPoints[i + 1];
        try {
          const sliced = turf.lineSlice(
            start,
            end,
            line
          ) as Feature<LineString>;
          if (sliced.geometry.coordinates.length > 1) {
            segments.push(sliced);
          }
        } catch (err) {
          console.error('Error slicing line:', err);
        }
      }
      return segments;
    };

    for (const lineFeature of lineFeatures) {
      const line = turf.lineString(
        (lineFeature.geometry as LineString).coordinates
      ) as Feature<LineString>;
      const startPt = turf.point(
        line.geometry.coordinates[0]
      ) as Feature<Point>;
      const endPt = turf.point(
        line.geometry.coordinates[line.geometry.coordinates.length - 1]
      ) as Feature<Point>;
      const threshold = 0.01;
      const isStartOnBoundary = isPointOnBoundary(
        startPt,
        boundaryLineArray,
        threshold
      );
      const isEndOnBoundary = isPointOnBoundary(
        endPt,
        boundaryLineArray,
        threshold
      );
      if (!isStartOnBoundary || !isEndOnBoundary) {
        const origBearing = turf.bearing(startPt, endPt);
        if (!isStartOnBoundary) {
          const newStart = extendPointToBoundary(
            startPt,
            origBearing + 180,
            boundaryLineArray
          );
          if (newStart) {
            line.geometry.coordinates[0] = newStart.geometry.coordinates;
          }
        }
        if (!isEndOnBoundary) {
          const newEnd = extendPointToBoundary(
            endPt,
            origBearing,
            boundaryLineArray
          );
          if (newEnd) {
            line.geometry.coordinates[line.geometry.coordinates.length - 1] =
              newEnd.geometry.coordinates;
          }
        }
      }
      let intersectionPoints: Array<Feature<Point>> = [];
      for (const boundarySeg of boundaryLineArray) {
        const intersectsFC = turf.lineIntersect(
          boundarySeg,
          line
        ) as FeatureCollection<Point>;
        if (intersectsFC.features.length > 0) {
          intersectionPoints = intersectionPoints.concat(intersectsFC.features);
        }
      }
      if (intersectionPoints.length >= 2) {
        const sorted = orderPointsAlongLine(line, intersectionPoints);
        const segments = sliceLineByIntersections(line, sorted);
        cutLines.push(...segments);
      }
    }

    if (cutLines.length === 0) {
      console.log('No valid cutting segments found');
      return [turf.feature(boundaryPolygon) as Feature<Polygon>];
    }
    const allLines: Array<Feature<LineString>> = [
      ...boundaryLineArray,
      ...cutLines,
    ];
    const linesFC: FeatureCollection<LineString> = {
      type: 'FeatureCollection',
      features: allLines,
    };

    let polygonized: FeatureCollection<Polygon>;
    try {
      polygonized = turf.polygonize(linesFC) as FeatureCollection<Polygon>;
    } catch (err) {
      console.error('Error during polygonize:', err);
      return [turf.feature(boundaryPolygon) as Feature<Polygon>];
    }
    if (!polygonized.features || polygonized.features.length === 0) {
      console.log('Polygonize returned no polygons');
      return [turf.feature(boundaryPolygon) as Feature<Polygon>];
    }
    const boundaryArea = turf.area(boundaryFeature);
    const subPolygons: Array<Feature<Polygon>> = [];
    for (const poly of polygonized.features) {
      const intersection = turf.intersect(
        poly as any,
        boundaryFeature as any
      ) as Feature<Polygon | MultiLineString> | null;
      if (!intersection) continue;
      const polyArea = turf.area(poly);
      const intersectArea = turf.area(intersection);
      const percentInside = (intersectArea / polyArea) * 100;
      if (percentInside > 90) {
        subPolygons.push(poly);
      }
    }
    if (subPolygons.length === 0) {
      console.log('No valid sub-polygons found within boundary');
      return [turf.feature(boundaryPolygon) as Feature<Polygon>];
    }
    if (subPolygons.length === 1 && lineFeatures.length > 0) {
      const singleArea = turf.area(subPolygons[0]);
      const diff = Math.abs(singleArea - boundaryArea);
      if (diff < boundaryArea * 0.01) {
        console.log(
          'Warning: The cutting operation did not create distinct subpolygons (areas are nearly identical).'
        );
      }
    }
    console.log(`Found ${subPolygons.length} sub-polygons after cutting.`);
    return subPolygons;
  }

  private isPointInBoundary(
    lng: number,
    lat: number,
    boundary?: GeoJSON.Polygon
  ): boolean {
    if (!boundary) return true;
    const pt = point([lng, lat]);
    return turf.booleanPointInPolygon(pt, boundary);
  }

  private onDrawFinish(id: FeatureId, context: OnFinishContext): void {
    console.log('onDrawFinish', id, context.action, context);
    const terradraw = this.draw()?.getTerraDrawInstance();
    if (!terradraw) return;
    if (
      (context.action === 'dragFeature' ||
        context.action === 'dragCoordinate' ||
        context.action === 'dragCoordinateResize') &&
      context.mode === 'select'
    ) {
      const feature = terradraw.getSnapshotFeature(id);
      if (feature) {
        const validationResult = this.validateWithinBoundary(
          feature,
          context,
          this.boundary()
        );
        if (!validationResult.valid) {
          alert('Cannot move feature outside the boundary area');
          terradraw.deselectFeature(id);
          const previousFeature = this.generateFeature(
            this.lastKnownFeatures.get(id.toString())!,
            true,
            typeof feature.properties?.['mode'] === 'string'
              ? feature.properties['mode']
              : 'polygon'
          );
          if (previousFeature) {
            const res = terradraw.addFeatures([previousFeature]);
            if (res.length > 0 && res[0].valid === false) {
              console.error('Reverting feature failed:', res[0].reason);
            }
            terradraw.removeFeatures([id]);
          } else {
            console.error('No previous state found for feature:', id);
            terradraw.removeFeatures([id]);
          }
        }
      }
    }
    const features = this.draw()
      ?.getFeatures()
      ?.features.filter((f) => f.properties?.['mode'] !== 'render');
    console.log(
      'Features:',
      features,
      this.draw()?.getTerraDrawInstance().getSnapshotFeature(id)
    );
    if (features) {
      features.forEach((feature) => {
        if (feature.id) {
          this.lastKnownFeatures.set(feature.id.toString(), feature);
        }
      });
      this.featureFinished.next({ features, type: 'finish' });
    }
  }

  private onDrawChange(ids: FeatureId[], type: string): void {
    const features = this.draw()
      ?.getFeatures()
      ?.features.filter((f) => f.properties?.['mode'] !== 'render');
    if (features) {
      this.featureChange.next({ features, type });
    }
  }

  getDrawnFeatures(): GeoJSONStoreFeatures[] {
    return (
      this.draw()
        ?.getTerraDrawInstance()
        ?.getSnapshot()
        .filter((f) => f.properties?.['mode'] !== 'render') || []
    );
  }

  addFeatures(features: GeoJSONStoreFeatures[]): StoreValidation[] {
    const terradraw = this.draw()?.getTerraDrawInstance();
    if (!terradraw) return [];
    const res = terradraw.addFeatures(features);
    features.forEach((feature) => {
      if (feature.id && res.find((r) => r.id === feature.id)?.valid) {
        this.lastKnownFeatures.set(String(feature.id), feature);
      }
    });
    return res;
  }
}
