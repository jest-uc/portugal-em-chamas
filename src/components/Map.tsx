import React, { Component } from 'react'
import { Map, TileLayer, Marker, Popup, GeoJSON} from 'react-leaflet'
import {LeafletMouseEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css';
import * as Topojson from "topojson";
import {Topology, GeometryCollection} from "topojson-specification"
import Cities_topojson_raw from './NUTS_RG_01M_2021_4326_LEVL_3.json'
import {
  FeatureCollection, 
  Feature, 
  GeometryObject,
  Polygon, 
  MultiPolygon,
  BBox,
  Position
} from 'geojson'

// Properties in TopoJson plus a few we add
interface Properties {
  NUTS_ID: string,
  LEVL_CODE: number,
  CNTR_CODE: string,
  NAME_LATN: string,
  NUTS_NAME: string,
  MOUNT_TYPE: string | null,
  URBN_TYPE: string | null,
  COAST_TYPE: string | null,
  FID: string,
  neighbors?: number[],
  area?: number
}

//Custom Type for TopoJson
type EU_topology = Topology<{
  NUTS_RG_01M_2021_4326: GeometryCollection<Properties>
}>

interface EnhancedGeometries<T extends GeometryTypes>{
  get_bbox(): [number, number, number, number]
  get_area(): number
  in_region(point:[number, number]): boolean,
  get_subregion(target_area:number): T['coordinates'] | null
}

type GeometryTypes = Polygon | MultiPolygon
type EnhancedGeometryTypes = PolygonEnhanced | MultiPolygonEnhanced

function point_in_polygon(point:[number, number], vs: Position[]) {
  // ray-casting algorithm based on
  // http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
  
  var x = point[0], y = point[1];
  
  var inside = false;
  for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      var xi = vs[i][0], yi = vs[i][1];
      var xj = vs[j][0], yj = vs[j][1];
      
      var intersect = ((yi > y) != (yj > y))
          && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
  }
  
  return inside;
};

function area(coords:Position[], interior:boolean){
  return Topojson.sphericalRingArea(coords as Array<[number, number]>, interior) * 100**2
}

function fill_area(
  cities:EUGeojson, 
  initial_city: Feature<EnhancedGeometryTypes, Properties>,
  target_area: number){

  let pushed_candidates:Array<Feature<EnhancedGeometryTypes, Properties>> = []
  const painted_cities = []
  let candidates = [initial_city]
  let total_area = 0

  //Deals with initial city

  if(candidates[0].properties.area as number < target_area){
    painted_cities.push(candidates[0])
    total_area += candidates[0].properties.area as number
    pushed_candidates.push(candidates[0])
  }

  //Deals with neighbors
  while (pushed_candidates.length > 0){
    //populate candidates
    let painted_cities_ids = painted_cities.map(cur=>cur.id)
    const candidate_idxs = pushed_candidates
      .reduce((acc, city, idx, arr)=>([...acc, ...(city.properties.neighbors as number[])]), [] as number[] )
      .filter((cur, idx, arr)=>arr.findIndex(cur2=>cur2==cur)==idx) // remove duplicates
      
    candidates = candidate_idxs
      .map(cand_idx=>cities.features[cand_idx])
      .filter(city=>!painted_cities_ids.includes(city.id))
       
    //calculate area for candidates
    candidates = candidates.sort((a, b) => ((b.properties.area as number) - (a.properties.area as number)))
    //Try to push candidates
    pushed_candidates = []
    for (let candidate of candidates){
      if (total_area + (candidate.properties.area as number) <= target_area){
        painted_cities.push(candidate)
        total_area += candidate.properties.area as number
        pushed_candidates.push(candidate)
      } 
    }
  }
  //Deals with incomplete neighbor to fill the remaining gap
  if (candidates.length == 0){
     // there are no candidates. That happens in islands. 
     //TODO: handle islands
  } else {
    const smaller_candidate = candidates[candidates.length - 1]
    const subregion_coordinates = smaller_candidate.geometry.get_subregion(target_area - total_area)
    if(subregion_coordinates != null){
      const subregion:Feature<EnhancedGeometryTypes, Properties> = {
        ...smaller_candidate,
        geometry: EUGeojson.geometry_parser({
          ...smaller_candidate.geometry,
          //@ts-ignore
          coordinates:subregion_coordinates
        })
      }
      subregion.properties.area = subregion.geometry.get_area()
      painted_cities.push(subregion)
    }
  } 
  return painted_cities

}


class MultiPolygonEnhanced implements MultiPolygon, EnhancedGeometries<MultiPolygon>{
  type: "MultiPolygon";
  coordinates
  constructor(multi_polygon: MultiPolygon){
    const {type, coordinates} = multi_polygon
    const enhanced_coordinates = coordinates.map(polygon=>new PolygonShape(...polygon))
    this.type = type
    this.coordinates = enhanced_coordinates
  }

  get_bbox(){
    const coordinates = this.coordinates
    const bboxes = coordinates.map(polygon_coors => polygon_coors.get_bbox())
    const bbox:[number, number, number, number] = [
      Math.min(...bboxes.map(bbox=>bbox[0])),
      Math.max(...bboxes.map(bbox=>bbox[1])),
      Math.min(...bboxes.map(bbox=>bbox[2])),
      Math.max(...bboxes.map(bbox=>bbox[3]))
    ]
    return bbox
  }
  
  get_area(){
    const coordinates = this.coordinates
    const area = coordinates
      .map(polygon_coors=>polygon_coors.get_area())
      .reduce((acc, area)=>acc + area, 0)
    return area
  }

  in_region(point:[number, number]){
    const coordinates = this.coordinates
    const in_any_polygon = coordinates.some(polygon_coors => polygon_coors.in_region(point))
    return in_any_polygon
  }

  get_subregion(target_area:number){
    const coordinates = this.coordinates
    let acc_area = 0
    const subregion = []
    for(let polygon_coors of coordinates){
      const subregion_piece = polygon_coors.get_subregion(target_area - acc_area)
      if(subregion_piece == null){
        //smallest region bigger that target
        break
      } else {
        subregion.push(subregion_piece)
        if(subregion_piece.length < polygon_coors.length){
          //search hit target
          break
        }
      }
    }
    return subregion.length == 0 ? null : subregion
  }

}

class PolygonShape extends Array<Position[]>{
  
  get_bbox(){
    const polygon = this
    const coordinates = polygon[0] // coordinates of external border
    const xs = coordinates.map(cur=>cur[0])
    const ys = coordinates.map(cur=>cur[1])
    const bbox: [number, number, number, number] = [
      Math.min(...xs), 
      Math.max(...xs),
      Math.min(...ys), 
      Math.max(...ys),
    ]
    return bbox
  }

  get_area(){
    const polygon = this
    const outer_area = area(polygon[0], false)
    const hole_area = polygon.slice(1).map(coors=>area(coors, true)).reduce((acc, area)=>acc + area, 0)
    return outer_area - hole_area
  }

  in_region(point:[number, number]){
    const polygon = this
    const inside_external_border = point_in_polygon(point, polygon[0])
    if (inside_external_border == true && polygon.length > 1){
      const in_a_hole = polygon.slice(1).some(coor => point_in_polygon(point, coor))
      return inside_external_border && !in_a_hole
    } else {
      return inside_external_border
    }
  }

  get_subregion(target_area:number){
    const polygon = this
    const coordinates = polygon[0]
    let lower = 3
    let upper = coordinates.length
    let newpoint

    if(area(
        PolygonShape.fix_winding(
          PolygonShape.get_subcoordinates(coordinates, lower)), 
        false
      ) > target_area){
      return null
    }
    while (lower != upper - 1){
      // binary search
      newpoint = Math.ceil((lower + upper)/2)
      if(area(
        PolygonShape.fix_winding(
            PolygonShape.get_subcoordinates(coordinates, newpoint)), 
            false
          ) > target_area){
        upper = newpoint
      } else {
        lower = newpoint
      }
    }
    return [PolygonShape.fix_winding(PolygonShape.get_subcoordinates(coordinates, lower))]
  }

  static get_subcoordinates(coordinates:Position[], npoints:number){
    return [...coordinates.slice(0, npoints), coordinates[0]]
  }

  static fix_winding(coordinates: Position[]){
    if(area(coordinates, false)<510e6/2){
      return coordinates
    } else {
      return coordinates.reverse()
    }
  }

}

class PolygonEnhanced implements Polygon, EnhancedGeometries<Polygon>{
  type: "Polygon";
  coordinates
  constructor(multi_polygon: Polygon){
    const {type, coordinates} = multi_polygon
    this.type = type
    this.coordinates = new PolygonShape(...coordinates)
  }

  get_bbox(){
    const coordinates = this.coordinates
    return coordinates.get_bbox()
  }

  get_area(){
    const coordinates = this.coordinates
    return coordinates.get_area()
  }

  in_region(point:[number, number]){
    const coordinates = this.coordinates
    return coordinates.in_region(point)
  }

  get_subregion(target_area: number){
    const coordinates = this.coordinates
    return coordinates.get_subregion(target_area)
  }
}

class EUGeojson implements FeatureCollection<EnhancedGeometryTypes, Properties>{
  type;
  features;
  constructor(geojson: FeatureCollection<GeometryObject, Properties>){
    const {type, features} = geojson
    const features_obj = EUGeojson.parse_features(features)
    this.type = type
    this.features = features_obj
  }

  static from_topojson(topojson: EU_topology){
    const geojson: FeatureCollection<
      GeometryObject, 
      Properties
    > = Topojson.feature(
      topojson, 
      topojson.objects.NUTS_RG_01M_2021_4326)
    const eu_geojson = new EUGeojson(geojson)
    eu_geojson.compute_bboxes()
    eu_geojson.compute_areas()
    eu_geojson.hook_neighbors(topojson)
    return eu_geojson
  }
  static geometry_parser(geometry: Polygon): PolygonEnhanced
  static geometry_parser(geometry: MultiPolygon): MultiPolygonEnhanced 
  static geometry_parser(geometry: GeometryObject): EnhancedGeometryTypes
  static geometry_parser(geometry: GeometryObject): EnhancedGeometryTypes{
    if (geometry.type == 'Polygon'){
      return new PolygonEnhanced(geometry)
    } else if (geometry.type == 'MultiPolygon'){
      return new MultiPolygonEnhanced(geometry)
    } else {
      throw "error"
    } 
  }
  static parse_features(features: Array<Feature<GeometryObject, Properties>>){
    return features.map((feature:Feature<GeometryObject, Properties>): Feature<EnhancedGeometryTypes, Properties> => {
      const { geometry } = feature
      return {
        ...feature,
        geometry: EUGeojson.geometry_parser(geometry)
      }
    })
  }

  compute_bboxes(){
    const features = this.features
    const features_with_bbox = features.map(feature=>({
      ...feature,
      bbox: feature.geometry.get_bbox()
    }))
    this.features = features_with_bbox 
  }

  compute_areas(){
    const features = this.features
    const features_with_areas = features.map(feature=>({
      ...feature,
      properties:{
        ...feature.properties,
        area: feature.geometry.get_area()
      } 
    }))
    this.features = features_with_areas
  }

  hook_neighbors(topojson: EU_topology){
    const features = this.features
    const topo_geometries = topojson.objects.NUTS_RG_01M_2021_4326.geometries
    const neighbors_arr = Topojson.neighbors(topo_geometries)
    const ids_in_topojson = topo_geometries.map(geometry=>geometry.id)
    const features_with_neighbors = features.map(feature=>{
      const idx_in_topojson = ids_in_topojson.findIndex(id => id==feature.id)
      if (idx_in_topojson == -1){
        throw 'cannot find reference in topojson'
      }
      const neighbors = neighbors_arr[idx_in_topojson]
      return {
        ...feature,
        properties:{
          ...feature.properties,
          neighbors: neighbors
        }
      }
    })
    this.features = features_with_neighbors
  }
  
  in_bbox(
    point:[number, number], 
    bbox?: BBox){
    const [x, y] = point
    if(!!bbox){
      return (
        (bbox[0]<x) && (x<bbox[1]) &&
        (bbox[2]<y) && (y<bbox[3]))
    } else {
      throw 'no bbox'
    }
  }

  point2region(x:number, y:number){
    const features = this.features
    const in_bbox = features.filter(feature=>this.in_bbox([x, y], feature.bbox))
    const in_polygon = in_bbox.filter(feature=>feature.geometry.in_region([x, y]))
    if (in_polygon.length > 1){
      console.log('Warning, more than 2 polygons match the point: ', [x, y])
    }
    return in_polygon[0]
  }
}

interface State{
  painted_cities: Array<Feature<EnhancedGeometryTypes, Properties>> | null
}

export default class MyMap extends Component<{}, State> {
  cities: EUGeojson
  map: React.RefObject<Map>
  constructor(props:{}){
    super(props)
    this.state = {
      painted_cities: null
    }
    const Cities_topojson: EU_topology = Cities_topojson_raw as EU_topology
    this.cities = EUGeojson.from_topojson(Cities_topojson)
    this.map = React.createRef()
  }
  

  onClick = (e:LeafletMouseEvent) => {
    const cities = this.cities

    const {lng, lat} = e.latlng
    
    const point_city = cities.point2region(lng, lat)
    if (point_city){
      const painted_cities = fill_area(cities, point_city, 23000) 

      this.setState({painted_cities}, ()=>{
        //TODO: zoom on bound box of the painted region, not on the selected point
        if (!!this.map.current){
          this.map.current.leafletElement.flyTo({lng, lat}, 7.5, {
            animate: true,
            duration: 1
          })
        }
      })
    } 
  }

  render() {
    const {painted_cities} = this.state
    return (
      <Map 
        center={{
          lat: 39.805131330469024,
          lng: -8.004303136599654,
        }} 
        zoom={5} 
        style={{ width: '100%', height: '100%',}}
        ref={this.map}
        onclick={this.onClick}
      >
      <TileLayer
        attribution='&copy <a href="http://osm.org/copyright">OpenStreetMap</a> contributors | &copy EuroGeographics for the administrative boundaries'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      {painted_cities !== null && 
        <GeoJSON 
          key={painted_cities.map(cur=>cur.id).reduce((acc, cur)=>acc as string+cur, '')} 
          data={painted_cities} 
          style={{stroke: false, color:'#f00'}}/>}
      </Map>
    )
  }
}
