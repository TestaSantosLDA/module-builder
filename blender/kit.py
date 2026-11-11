# Jular Treehouse builder - kit of parts. Blender coords: X along wall, Z up, -Y = outside.
# Wall occupies y in [0, 0.20]; origin of each unit = outer wall face, bottom-centre of the opening.
import bpy, bmesh, math, random, os, sys
from mathutils import Vector
OUT = sys.argv[sys.argv.index('--')+1]
random.seed(702)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def M(name, rgb, metal=0.0, rough=0.5, transmission=0.0, ior=1.45):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission; b.inputs['IOR'].default_value = ior
    return m
ALU = M('alu_antracite', (0.035, 0.04, 0.045), 0.6, 0.35)
GLASS = M('vidro', (0.92, 0.96, 0.97), 0.0, 0.02, transmission=1.0, ior=1.5)
SILL = M('peitoril', (0.55, 0.56, 0.57), 0.5, 0.4)
OAK = M('madeira_porta', (0.32, 0.19, 0.10), 0.0, 0.55)
STEEL = M('inox', (0.8, 0.8, 0.8), 1.0, 0.22)
GASKET = M('borracha', (0.01, 0.01, 0.01), 0.0, 0.8)

def box(name, sx, sy, sz, loc, mat, parent=None, bevel=0.004):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x*sx, v.co.y*sy, v.co.z*sz))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, sx/3, sy/3, sz/3), segments=2, affect='EDGES', profile=0.5)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = False
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); ob.location = loc; scene.collection.objects.link(ob)
    if parent: ob.parent = parent
    return ob

def empty(name):
    e = bpy.data.objects.new(name, None); scene.collection.objects.link(e); return e

def ring(prefix, w, h, prof, y0, y1, zb, mat, parent):
    d = y1 - y0; yc = (y0 + y1) / 2
    box(prefix+'_t', w, d, prof, (0, yc, zb+h-prof/2), mat, parent)
    box(prefix+'_b', w, d, prof, (0, yc, zb+prof/2), mat, parent)
    box(prefix+'_l', prof, d, h-2*prof, (-w/2+prof/2, yc, zb+h/2), mat, parent)
    box(prefix+'_r', prof, d, h-2*prof, (w/2-prof/2, yc, zb+h/2), mat, parent)

def sash(prefix, w, h, xc, zb, y0, y1, parent):
    e = empty(prefix); e.parent = parent; e.location = (xc, 0, 0)
    ring(prefix+'_aro', w, h, 0.055, y0, y1, zb, ALU, e)
    box(prefix+'_vidro', w-0.09, 0.024, h-0.09, (0, (y0+y1)/2, zb+h/2), GLASS, e, bevel=0)
    return e

def window(name, w, h, sashes=1):
    root = empty(name)
    P = 0.065
    ring(name+'_caixilho', w, h, P, 0.06, 0.18, 0, ALU, root)          # outer frame, recessed 6 cm
    iw, ih = w-2*P, h-2*P
    sw = iw / sashes
    for i in range(sashes):
        sash(f'{name}_folha{i}', sw+0.01, ih+0.01, -iw/2+sw*(i+0.5), P-0.005, 0.085, 0.155, root)
    box(name+'_peitoril', w+0.08, 0.17, 0.03, (0, 0.025, -0.015), SILL, root)   # aluminium sill, 5 cm drip outside
    box(name+'_pingadeira', w+0.08, 0.012, 0.03, (0, -0.054, -0.04), SILL, root, bevel=0.002)
    return root

def glass_slider(name, w, h):
    root = empty(name); P = 0.07
    ring(name+'_caixilho', w, h, P, 0.04, 0.19, 0, ALU, root)
    iw, ih = w-2*P, h-P
    pw = iw/2 + 0.04
    sash(name+'_fixa', pw, ih, -iw/2+pw/2, P*0.5, 0.13, 0.18, root)
    s = sash(name+'_correr', pw, ih, iw/2-pw/2, P*0.5, 0.06, 0.11, root)
    box(name+'_puxador', 0.03, 0.035, 0.45, (-pw/2+0.06, 0.035, P*0.5+1.0), STEEL, s, bevel=0.008)
    box(name+'_soleira', w, 0.2, 0.02, (0, 0.1, 0.01), SILL, root, bevel=0.002)
    return root

def door(name, w, h):
    root = empty(name); P = 0.07
    ring(name+'_aro', w, h+P, P, 0.05, 0.19, 0, ALU, root)
    lw, lh = w-2*P-0.006, h-0.01
    n = 7; pw = lw/n
    for i in range(n):  # timber leaf in vertical planks, matching the cladding rhythm
        box(f'{name}_tabua{i}', pw-0.005, 0.055, lh, (-lw/2+pw*(i+0.5), 0.11, 0.005+lh/2), OAK, root, bevel=0.003)
    hx = lw/2-0.13
    box(name+'_puxador', 0.028, 0.028, 0.7, (hx, 0.025, 1.0), STEEL, root, bevel=0.01)
    for z in (0.75, 1.25): box(name+f'_suporte{z}', 0.018, 0.06, 0.018, (hx, 0.055, z), STEEL, root, bevel=0.004)
    box(name+'_soleira', w, 0.2, 0.02, (0, 0.1, 0.01), SILL, root, bevel=0.002)
    return root

UNITS = {  # name: (kind, w, h, sashes)
    'W_sala': ('w', 2.4, 2.2, 2), 'W_sala2': ('w', 1.6, 1.6, 2), 'W_quarto': ('w', 1.2, 1.2, 1),
    'W_cozinha': ('w', 1.4, 1.0, 2), 'W_wc': ('w', 0.6, 0.6, 1), 'W_escada': ('w', 0.5, 2.0, 1),
    'W_livre': ('w', 1.4, 1.4, 2), 'D_entrada': ('d', 1.0, 2.2, 0), 'G_240': ('g', 2.4, 2.3, 0), 'G_180': ('g', 1.8, 2.3, 0)}
roots = []
for i, (n, (k, w, h, s)) in enumerate(UNITS.items()):
    r = window(n, w, h, s) if k == 'w' else door(n, w, h) if k == 'd' else glass_slider(n, w, h)
    r['w'] = w; r['h'] = h
    r.location = (i*3.2, 0, 0); roots.append(r)

# ---- merge each unit into one mesh per material (fewer draw calls on the web) ----
for r in roots:
    meshes = [c for c in r.children_recursive if c.type == 'MESH']
    by = {}
    for c in meshes: by.setdefault(c.data.materials[0].name, []).append(c)
    for mname, obs in by.items():
        with bpy.context.temp_override(active_object=obs[0], object=obs[0], selected_objects=obs, selected_editable_objects=obs):
            bpy.ops.object.join()
        j = obs[0]; mw = j.matrix_world.copy(); j.parent = r; j.matrix_world = mw; j.name = f'{r.name}_{mname}'
    for c in list(r.children_recursive):
        if c.type == 'EMPTY': bpy.data.objects.remove(c)
# ---- export kit (units placed side by side; the site uses each root by name, position reset) ----
for o in bpy.data.objects: o.select_set(False)
for r in roots:
    r.select_set(True)
    for c in r.children_recursive: c.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'kit.glb'), use_selection=True, export_extras=True, export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'kit_pecas.blend'))
print('KIT OK', len(roots))
