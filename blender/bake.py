# Bake real-geometry textures: vertical pine cladding (1.2 x 2.4 m) and pine deck (1.12 x 1.12 m).
import bpy, bmesh, random, os, sys
from mathutils import Vector
OUT = sys.argv[sys.argv.index('--')+1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 24
random.seed(7)

def mesh_box(name, sx, sy, sz, loc, mat, bevel=0.0, rot=None):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x*sx, v.co.y*sy, v.co.z*sz))
    if bevel: bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=3, affect='EDGES', profile=0.5)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(mat)
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me); o.location = loc
    if rot: o.rotation_euler = rot
    sc.collection.objects.link(o); return o

def wood_mat(name, base, dark, scale, rough=0.7):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; L = nt.links
    bsdf = N['Principled BSDF']; bsdf.inputs['Roughness'].default_value = rough
    tc = N.new('ShaderNodeTexCoord'); oi = N.new('ShaderNodeObjectInfo')
    mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = scale  # stretch along the board
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    wave = N.new('ShaderNodeTexWave'); wave.wave_type = 'BANDS'; wave.bands_direction = 'X'
    wave.inputs['Scale'].default_value = 3; wave.inputs['Distortion'].default_value = 3; wave.inputs['Detail'].default_value = 4
    L.new(mp.outputs['Vector'], wave.inputs['Vector'])
    noise = N.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 40
    L.new(mp.outputs['Vector'], noise.inputs['Vector'])
    mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    L.new(wave.outputs['Fac'], mix.inputs['Factor'])
    mix.inputs['A'].default_value = (*base, 1); mix.inputs['B'].default_value = (*dark, 1)
    # per-board tint from Object Info random
    ramp = N.new('ShaderNodeMix'); ramp.data_type = 'RGBA'; ramp.blend_type = 'MULTIPLY'
    L.new(oi.outputs['Random'], ramp.inputs['Factor'])
    L.new(mix.outputs['Result'], ramp.inputs['A']); ramp.inputs['B'].default_value = (0.86, 0.84, 0.82, 1)
    L.new(ramp.outputs['Result'], bsdf.inputs['Base Color'])
    bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.15; bump.inputs['Distance'].default_value = 0.0008
    L.new(noise.outputs['Fac'], bump.inputs['Height']); L.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m

def low_plane(name, w, h, res):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in [(-w/2,-h/2,0),(w/2,-h/2,0),(w/2,h/2,0),(-w/2,h/2,0)]]
    f = bm.faces.new(vs); uv = bm.loops.layers.uv.new()
    for l, c in zip(f.loops, [(0,0),(1,0),(1,1),(0,1)]): l[uv].uv = c
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o); o.location = (0, 0, 0.05)
    m = bpy.data.materials.new(name+'_m'); m.use_nodes = True; me.materials.append(m)
    imgs = {}
    for k, cs in [('albedo','sRGB'),('normal','Non-Color'),('ao','Non-Color'),('rough','Non-Color')]:
        im = bpy.data.images.new(f'{name}_{k}', res[0], res[1], alpha=False, float_buffer=False); im.colorspace_settings.name = cs; imgs[k] = im
    node = m.node_tree.nodes.new('ShaderNodeTexImage'); m.node_tree.nodes.active = node
    return o, imgs, node

def bake(low, highs, node, img, typ, out, **kw):
    node.image = img
    for o in bpy.data.objects: o.select_set(False)
    for h in highs: h.select_set(True)
    low.select_set(True); bpy.context.view_layer.objects.active = low
    bpy.ops.object.bake(type=typ, use_selected_to_active=True, cage_extrusion=0.06, max_ray_distance=0.2, margin=8, **kw)
    img.filepath_raw = out; img.file_format = 'JPEG' if out.endswith('.jpg') else 'PNG'; img.save()
    print('baked', out)

def clear():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)

# ---------- cladding: 8 boards x 0.15 m, 2.4 m tall, neutral pale pine (tinted per finish on the web) ----------
W, H = 1.2, 2.4
clad = wood_mat('pinho', (0.80, 0.76, 0.70), (0.70, 0.65, 0.58), (7, 0.35, 1))
back = bpy.data.materials.new('fundo'); back.use_nodes = True; back.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.05, 0.05, 1)
highs = [mesh_box('fundo', W+0.1, H+0.1, 0.005, (0, 0, -0.024), back)]
bw = W/8
for i in range(8):
    dz = random.uniform(-0.0015, 0.0015)
    highs.append(mesh_box(f'tabua{i}', bw-0.008, H+0.02, 0.022, (-W/2+bw*(i+0.5), 0, dz), clad, bevel=0.0035, rot=(0, random.uniform(-0.01, 0.01), 0)))
low, imgs, node = low_plane('revestimento', W, H, (512, 1024))
bake(low, highs, node, imgs['normal'], 'NORMAL', os.path.join(OUT, 'revestimento_normal.png'))
bake(low, highs, node, imgs['ao'], 'AO', os.path.join(OUT, 'revestimento_ao.jpg'))
bake(low, highs, node, imgs['albedo'], 'DIFFUSE', os.path.join(OUT, 'revestimento_cor.jpg'), pass_filter={'COLOR'})
clear()

# ---------- deck: 8 boards x 0.14 m, ribbed top, two screws per board end ----------
D = 1.12
deckm = wood_mat('deck', (0.62, 0.43, 0.25), (0.50, 0.33, 0.18), (7, 0.4, 1), rough=0.8)
screw = bpy.data.materials.new('parafuso'); screw.use_nodes = True; sb = screw.node_tree.nodes['Principled BSDF']
sb.inputs['Base Color'].default_value = (0.35, 0.34, 0.33, 1); sb.inputs['Metallic'].default_value = 1
highs = [mesh_box('fundo', D+0.1, D+0.1, 0.005, (0, 0, -0.03), back)]
bw = D/8
for i in range(8):
    x = -D/2+bw*(i+0.5)
    highs.append(mesh_box(f'deck{i}', bw-0.008, D-0.006, 0.028, (x, 0, random.uniform(-0.001, 0.001)), deckm, bevel=0.004))
    for r in range(5):  # anti-slip ribs
        highs.append(mesh_box(f'rib{i}_{r}', 0.006, D-0.03, 0.003, (x-bw*0.36+r*bw*0.18, 0, 0.0145), deckm, bevel=0.001))
    for y in (-D/2+0.04, D/2-0.04):
        for dx in (-0.03, 0.03):
            highs.append(mesh_box(f's{i}{y}{dx}', 0.009, 0.009, 0.004, (x+dx, y, 0.0155), screw, bevel=0.0035))
low, imgs, node = low_plane('deck', D, D, (1024, 1024))
bake(low, highs, node, imgs['normal'], 'NORMAL', os.path.join(OUT, 'deck_normal.png'))
bake(low, highs, node, imgs['ao'], 'AO', os.path.join(OUT, 'deck_ao.jpg'))
bake(low, highs, node, imgs['albedo'], 'DIFFUSE', os.path.join(OUT, 'deck_cor.jpg'), pass_filter={'COLOR'})
print('BAKE OK')
