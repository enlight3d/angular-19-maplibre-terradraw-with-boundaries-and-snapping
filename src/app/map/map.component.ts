import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MapComponent } from '@maplibre/ngx-maplibre-gl';
import {
  Polygon,
  Geometry,
  FeatureCollection,
  Position,
  GeometryCollection,
} from 'geojson';
import {
  TerraDrawFeatureEvent,
  TerraDrawOptions,
  TerraDrawService,
} from '../terradraw.service';
import { LngLatBounds } from 'maplibre-gl';
import { style } from '../maplibreStyle';
import { GeoJSONStoreFeatures } from 'terra-draw';
import { Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'map-demmo',
  imports: [MapComponent, MatButtonModule],
  templateUrl: './map.component.html',
  styleUrl: './map.component.css',
  standalone: true,
})
export class MapDemoComponent {
  mapStyle = style;
  terraDrawService = inject(TerraDrawService);

  // Define boundary polygon for constrained drawing
  boundaryPolygon: Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [-61.77193095, 16.197542798],
        [-61.75306759, 16.072337124],
        [-61.697945151, 15.960371344],
        [-61.628621468, 15.984106716],
        [-61.577217834, 16.037297717],
        [-61.574560179, 16.116380266],
        [-61.594377872, 16.178304259],
        [-61.677855002, 16.224774678],
        [-61.77193095, 16.197542798],
      ],
    ],
  };

  // Computed boundary bounds for map display
  boundaryBounds = computed(() => {
    return this.getBoundsFromGeoJsonGeometry(this.boundaryPolygon);
  });

  map = signal<maplibregl.Map | undefined>(undefined);

  // Track Terra Draw state using MapLibreService signals
  showBoundary = signal(true);
  snapToBoundary = signal(true);
  snapToFeatures = signal(true);

  drawnFeatures = signal<GeoJSONStoreFeatures[]>([]);

  private subscriptions: Subscription[] = [];

  constructor() {
    effect(() => {
      if (this.map()) {
        console.log('Map is ready');
      }
    });

    effect(() => {
      console.log('drawnFeatures', this.drawnFeatures());
    });
  }

  onMapLoad(map: maplibregl.Map) {
    this.map.set(map);
    this.terraDrawService.mapLoad(map);
    const terraDrawOptions: TerraDrawOptions = {
      boundary: this.boundaryPolygon,
      modes: [
        'render', // Built-in render mode
        'select',
        'delete-selection',
        'download',
        'point',
        'linestring',
        'polygon',
      ],
      showBoundary: this.showBoundary,
      snapToBoundary: this.snapToBoundary,
      snapToFeatures: this.snapToFeatures,
    };

    // Initialize Terra Draw through the service
    this.terraDrawService.initTerraDraw(terraDrawOptions);

    // Subscribe to feature events
    this.subscriptions.push(
      this.terraDrawService.featureFinished.subscribe(
        this.handleFeatureFinished.bind(this)
      )
    );
  }

  getBoundsFromGeoJsonGeometry(
    geometry: Geometry | FeatureCollection
  ): LngLatBounds | undefined {
    if (!geometry) return undefined;

    const bounds = new LngLatBounds();
    let coordinates: any[] = [];

    // Handle FeatureCollection separately as it's not a Geometry type
    if ('features' in geometry) {
      // This is a FeatureCollection
      geometry.features.forEach((f) => {
        // Recursively get bounds for each feature
        const geomBounds = this.getBoundsFromGeoJsonGeometry(f.geometry);
        // Extend the main bounds with the bounds of each feature
        if (geomBounds) {
          bounds.extend(geomBounds);
        }
      });
      return bounds.isEmpty() ? undefined : bounds;
    }
    switch (geometry.type) {
      case 'Point':
        coordinates = [geometry.coordinates];
        break;
      case 'MultiPoint':
      case 'LineString':
        coordinates = geometry.coordinates;
        break;
      case 'MultiLineString':
      case 'Polygon':
        coordinates = geometry.coordinates.flat();
        break;
      case 'MultiPolygon':
        coordinates = geometry.coordinates.flat(2);
        break;
      case 'GeometryCollection':
        // Handle each geometry in the collection
        (geometry as GeoJSON.GeometryCollection).geometries.forEach((g) => {
          // Recursively get bounds for each geometry
          const geomBounds = this.getBoundsFromGeoJsonGeometry(g);
          // Extend the main bounds with the bounds of each geometry
          if (geomBounds) {
            bounds.extend(geomBounds);
          }
        });
        // Return early as we're handling coordinates differently for collections
        return bounds.isEmpty() ? undefined : bounds;
      default:
        console.error(`Unsupported geometry type: ${geometry['type']}`);
        return undefined;
    }

    if (!coordinates.length) return undefined;

    coordinates.forEach((coord, index) => {
      if (Array.isArray(coord) && coord.length >= 2) {
        const [lng, lat] = coord;
        if (typeof lng === 'number' && typeof lat === 'number') {
          bounds.extend([lng, lat] as [number, number]);
        } else {
          console.error(`Invalid coordinate at index ${index}:`, coord);
        }
      } else {
        console.error(`Invalid coordinate structure at index ${index}:`, coord);
      }
    });

    return bounds;
  }

  handleFeatureFinished(event: TerraDrawFeatureEvent): void {
    if (event.features) {
      this.drawnFeatures.set(event.features);
    }
  }

  getSubpolygons(): void {
    if (this.terraDrawService.draw()) {
      const res = this.terraDrawService.getSubpolygons();
      console.log('res', res, this.boundaryPolygon);
    }
  }
}
