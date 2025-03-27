import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
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

  constructor() {
    effect(() => {
      if (this.map()) {
        console.log('Map is ready');
      }
    });
  }

  onMapLoad(map: maplibregl.Map) {
    this.map.set(map);
  }

  getBoundsFromGeoJsonGeometry(
    geometry: Geometry | FeatureCollection
  ): LngLatBounds | null {
    if (!geometry) return null;

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
      return bounds.isEmpty() ? null : bounds;
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
        coordinates = ([] as Position[]).concat(...geometry.coordinates);
        break;
      case 'MultiPolygon':
        coordinates = ([] as Position[]).concat(
          ...geometry.coordinates.map((p) => [].concat(...p))
        );
        break;
      case 'GeometryCollection':
        // Handle each geometry in the collection
        (geometry as GeometryCollection).geometries.forEach((g) => {
          // Recursively get bounds for each geometry
          const geomBounds = this.getBoundsFromGeoJsonGeometry(g);
          // Extend the main bounds with the bounds of each geometry
          if (geomBounds) {
            bounds.extend(geomBounds);
          }
        });
        // Return early as we're handling coordinates differently for collections
        return bounds.isEmpty() ? null : bounds;
      default:
        console.error(`Unsupported geometry type: ${geometry['type']}`);
        return null;
    }

    if (!coordinates.length) return null;

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
}
