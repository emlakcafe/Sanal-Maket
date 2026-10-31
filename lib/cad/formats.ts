export type CadSupport = "direct" | "convert" | "bim" | "preview" | "planned";

export type CadFormat = {
  ext: string;
  label: string;
  category: "CAD" | "BIM" | "3D" | "Dokuman";
  support: CadSupport;
  description: string;
};

export const CAD_FORMATS: CadFormat[] = [
  { ext: ".dwg", label: "AutoCAD DWG", category: "CAD", support: "convert", description: "LibreDWG ile DXF'e dönüştürülerek açılır." },
  { ext: ".dxf", label: "AutoCAD DXF", category: "CAD", support: "direct", description: "Katman ve 2B CAD geometrisi doğrudan okunur." },
  { ext: ".ifc", label: "IFC / BIM", category: "BIM", support: "bim", description: "BIM modeli; web-ifc altyapısı için hazırlanmıştır." },
  { ext: ".glb", label: "GLB", category: "3D", support: "direct", description: "3B model doğrudan görüntülenebilir." },
  { ext: ".gltf", label: "glTF", category: "3D", support: "direct", description: "3B model doğrudan görüntülenebilir." },
  { ext: ".obj", label: "Wavefront OBJ", category: "3D", support: "direct", description: "3B geometri doğrudan görüntülenebilir." },
  { ext: ".stl", label: "STL", category: "3D", support: "direct", description: "3B geometri doğrudan görüntülenebilir." },
  { ext: ".svg", label: "SVG Plan", category: "CAD", support: "preview", description: "Vektorel plan olarak onizlenir." },
  { ext: ".pdf", label: "PDF Plan", category: "Dokuman", support: "preview", description: "Plan/pafta dokumani olarak onizlenir." },
  { ext: ".rvt", label: "Revit RVT", category: "BIM", support: "planned", description: "Yerel okuyucu yok; IFC/Autodesk donusum adaptoru gerekir." },
  { ext: ".rfa", label: "Revit Family RFA", category: "BIM", support: "planned", description: "Yerel okuyucu yok; Revit/Autodesk donusumu gerekir." },
  { ext: ".dgn", label: "MicroStation DGN", category: "CAD", support: "planned", description: "ODA veya Bentley donusum adaptoru gerekir." },
  { ext: ".skp", label: "SketchUp SKP", category: "3D", support: "planned", description: "SketchUp SDK/donusum adaptoru gerekir." }
];

export const ACCEPTED_ARCHITECTURAL_EXTENSIONS = CAD_FORMATS.map(f => f.ext).join(",");

export function getCadFormat(filename: string) {
  const name = filename.toLowerCase();
  return CAD_FORMATS.find(f => name.endsWith(f.ext)) ?? null;
}
