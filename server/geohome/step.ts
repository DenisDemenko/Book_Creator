/** STEP AP214 surface/wire geometry for KumCAD's OpenCASCADE reader.
 * Detailed beam profiles, cuts and connector specifications remain in cad.json.
 */
export function kumCadStep(cad: Record<string, any>): string {
  const data:string[]=[];
  let serial=0;
  const entity=(text:string)=>{const id='#'+(++serial);data.push(`${id} = ${text};`);return id;};
  const num=(n:number)=>{
    if(!Number.isFinite(n))throw new Error('Non-finite CAD coordinate');
    const text=n.toPrecision(15).replace('e','E');return text.includes('.')||text.includes('E')?text:text+'.';
  };
  const tuple=(v:number[])=>'('+v.map(num).join(',')+')';
  const normalize=(v:number[])=>{const length=Math.hypot(...v);if(length<1e-10)throw new Error('Degenerate CAD geometry');return v.map(n=>n/length);};
  const sub=(a:number[],b:number[])=>a.map((n,i)=>n-b[i]);
  const app=entity("APPLICATION_CONTEXT('automotive design')");
  entity(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${app})`);
  const context=entity(`PRODUCT_CONTEXT('',${app},'mechanical')`);
  const product=entity(`PRODUCT('Fusion_GeoHome','Geodesic dome','',(${context}))`);
  const formation=entity(`PRODUCT_DEFINITION_FORMATION('1','',${product})`);
  const definitionContext=entity(`PRODUCT_DEFINITION_CONTEXT('part definition',${app},'design')`);
  const definition=entity(`PRODUCT_DEFINITION('design','',${formation},${definitionContext})`);
  const definitionShape=entity(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
  const lengthUnit=entity('(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))');
  const angleUnit=entity('(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))');
  const solidUnit=entity('(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())');
  const uncertainty=entity(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.000001),${lengthUnit},'distance_accuracy_value','')`);
  const geometricContext=entity(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${lengthUnit},${angleUnit},${solidUnit})) REPRESENTATION_CONTEXT('',''))`);
  const nodes=new Map<number,{p:number[];point:string;vertex:string}>();
  for(const value of cad.vertices){
    const p=[value.position.x,value.position.y,value.position.z];
    const point=entity(`CARTESIAN_POINT('',${tuple(p)})`),vertex=entity(`VERTEX_POINT('',${point})`);
    nodes.set(value.id,{p,point,vertex});
  }
  const edges=new Map<string,{start:number;curve:string}>();
  const edge=(a:number,b:number)=>{
    const key=[a,b].sort((x,y)=>x-y).join(':');
    const found=edges.get(key);if(found)return found;
    const start=nodes.get(a)!,end=nodes.get(b)!;
    const direction=entity(`DIRECTION('',${tuple(normalize(sub(end.p,start.p)))})`);
    const vector=entity(`VECTOR('',${direction},1.)`);
    const line=entity(`LINE('',${start.point},${vector})`);
    const curve=entity(`EDGE_CURVE('',${start.vertex},${end.vertex},${line},.T.)`);
    const result={start:a,curve};edges.set(key,result);return result;
  };
  const wires:string[]=[];
  for(const beam of cad.struts){
    const start=nodes.get(beam.startVertexId)!,end=nodes.get(beam.endVertexId)!;
    edge(beam.startVertexId,beam.endVertexId);
    wires.push(entity(`POLYLINE('',(${start.point},${end.point}))`));
  }
  const faces:string[]=[];
  for(const triangle of cad.triangles){
    const [a,b,c]=triangle.vertexIds as number[];
    const oriented=[[a,b],[b,c],[c,a]].map(([start,end])=>{
      const e=edge(start,end);return entity(`ORIENTED_EDGE('',*,*,${e.curve},${e.start===start?'.T.':'.F.'})`);
    });
    const loop=entity(`EDGE_LOOP('',(${oriented.join(',')}))`);
    const bound=entity(`FACE_OUTER_BOUND('',${loop},.T.)`);
    const ab=sub(nodes.get(b)!.p,nodes.get(a)!.p),ac=sub(nodes.get(c)!.p,nodes.get(a)!.p);
    const normal=normalize([ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]]);
    const axis=entity(`DIRECTION('',${tuple(normal)})`),reference=entity(`DIRECTION('',${tuple(normalize(ab))})`);
    const placement=entity(`AXIS2_PLACEMENT_3D('',${nodes.get(a)!.point},${axis},${reference})`);
    const plane=entity(`PLANE('',${placement})`);
    faces.push(entity(`ADVANCED_FACE('',(${bound}),${plane},.T.)`));
  }
  const items:string[]=[];
  if(faces.length){const shell=entity(`OPEN_SHELL('',(${faces.join(',')}))`);items.push(entity(`SHELL_BASED_SURFACE_MODEL('',(${shell}))`));}
  if(wires.length)items.push(entity(`GEOMETRIC_CURVE_SET('',(${wires.join(',')}))`));
  if(!items.length)throw new Error('No CAD geometry');
  const representation=entity(`SHAPE_REPRESENTATION('Fusion GeoHome',(${items.join(',')}),${geometricContext})`);
  entity(`SHAPE_DEFINITION_REPRESENTATION(${definitionShape},${representation})`);
  return ["ISO-10303-21;","HEADER;","FILE_DESCRIPTION(('Fusion GeoHome geometry'),'2;1');",`FILE_NAME('dome.step','${new Date().toISOString()}',('Fusion Lab'),('Fusion Lab'),'Fusion GeoHome','Fusion GeoHome','');`,"FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));","ENDSEC;","DATA;",...data,"ENDSEC;","END-ISO-10303-21;"].join('\n');
}
