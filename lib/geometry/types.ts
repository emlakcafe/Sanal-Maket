export type Point2D = [number, number];

export type ExtractedPolygon = {
  outer: Point2D[];
  holes?: Point2D[][];
};

export type FloorplanExtraction = {
  canvas_size: [number, number];
  content_rect?: [number, number, number, number];
  polygons: {
    wall?: ExtractedPolygon[];
    door?: ExtractedPolygon[];
    window?: ExtractedPolygon[];
    floor?: ExtractedPolygon[];
    [key: string]: ExtractedPolygon[] | undefined;
  };
  input_image_b64?: string;
};
