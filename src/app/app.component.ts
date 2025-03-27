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
import { TerraDrawService } from './terradraw.service';
import { LngLatBounds } from 'maplibre-gl';
import { style } from './maplibreStyle';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  standalone: true,
})
export class AppComponent {}
