// Furniture sketches drawn inside each module on the plan, in local (unrotated) coordinates 0..w, 0..h (dm).
import type { TypeId } from '../model/catalog';

type Attrs = Record<string, string | number>;
function el(tag: string, attrs: Attrs, parent: Element): SVGElement {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent.appendChild(e);
  return e;
}

export function interior(g: Element, type: TypeId, w: number, h: number): void {
  const L: Attrs = { fill: 'none', stroke: 'var(--ink-dim)', 'stroke-width': 0.6, 'vector-effect': 'non-scaling-stroke' };
  const bed = (x: number, y: number) => { el('rect', { ...L, x, y, width: 16, height: 20, rx: 1 }, g); el('rect', { ...L, x: x + 1.5, y: y + 1, width: 13, height: 4, rx: 1 }, g); };
    if(type==="sala"){ el('rect',{...L,x:w/2-9,y:3,width:18,height:8,rx:1.5},g); // sofa
      el('rect',{...L,x:w/2-8,y:h-15,width:16,height:7,rx:1},g); // dining table
      for(const cx of [w/2-5,w/2,w/2+5]){el('rect',{...L,x:cx-1.5,y:h-18,width:3,height:2},g);el('rect',{...L,x:cx-1.5,y:h-7,width:3,height:2},g)}
    } else if(type==="cozinha"){ el('rect',{...L,x:2,y:2,width:6,height:h-4},g);
      el('circle',{...L,cx:5,cy:6,r:1.4},g); el('circle',{...L,cx:5,cy:10,r:1.4},g); el('rect',{...L,x:3,y:17,width:4,height:5,rx:1},g);
      el('rect',{...L,x:12,y:6,width:12,height:h-12,fill:'rgba(200,225,255,0.06)'},g);
    } else if(type==="entrada"){ el('line',{...L,x1:0,y1:15,x2:w*0.62,y2:15},g); el('line',{...L,x1:w*0.62,y1:0,x2:w*0.62,y2:15},g);
      el('rect',{...L,x:2,y:2,width:9,height:11},g); el('ellipse',{...L,cx:w*0.4,cy:6,rx:2.5,ry:3.5},g); el('circle',{...L,cx:w*0.53,cy:6,r:2.5},g);
    } else if(type==="quarto"){ bed((w-16)/2,h-22); el('rect',{...L,x:2,y:2,width:w-4,height:6},g);
    } else if(type==="suite"){ bed(2,h-22); el('line',{...L,x1:w-12,y1:h*0.3,x2:w-12,y2:h,"stroke-dasharray":"2 2"},g);
      el('ellipse',{...L,cx:w-6,cy:h*0.45,rx:2.5,ry:3.5},g); el('rect',{...L,x:w-10,y:h-10,width:8,height:8},g);
    } else if(type==="escada"){ el('rect',{...L,x:(w-10)/2,y:3,width:10,height:h-6},g);
      for(let y=6;y<h-3;y+=3) el('line',{...L,x1:(w-10)/2,y1:y,x2:(w+10)/2,y2:y},g);
      el('line',{...L,x1:w/2,y1:h-5,x2:w/2,y2:6},g); el('path',{...L,d:`M${w/2-2} 9 L${w/2} 6 L${w/2+2} 9`},g);
    } else if(type==="deck"||type==="deckL"){
      for(let y=3;y<h;y+=3) el('line',{...L,x1:1,y1:y,x2:w-1,y2:y,opacity:0.5},g);
    }
}
