export interface MarkerModel {
  id: string;
  lat: number;
  lng: number;
}

export interface EdgeModel {
  id: string;
  fromMarkerId: string;
  toMarkerId: string;
}

export interface TripModel {
  id: string;
  name: string;
  description: string;
  markers: MarkerModel[];
  edges: EdgeModel[];
  createdAt: string;
  updatedAt: string;
}