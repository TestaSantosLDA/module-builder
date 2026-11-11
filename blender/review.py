import bpy, bmesh, os, sys, math
from mathutils import Vector
OUT = sys.argv[sys.argv.index('--')+1]; KIT = os.path.join(OUT, 'kit')
bpy.ops.wm.open_mainfile(filepath=os.path.join(KIT, 'kit_pecas.blend'))
sc = bpy.context.scene; col = sc.collection
units = {o.name: o for o in bpy.data.objects if o.parent is None}
for o in units.values(): o.location = (100, 100, -50)  # park originals

def img(name, cs='sRGB'):
    im = bpy.data.images.load(os.path.join(KIT, name)); im.colorspace_settings.name = cs; return im
def tex_mat(name, cor, nrm, ao, size, tint=(1,1,1), rough=0.75):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; L = nt.links
    b = N['Principled BSDF']; b.inputs['Roughness'].default_value = rough
    tc = N.new('ShaderNodeTexCoord'); mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1/size[0], 1/size[1], 1/size[1])
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    def T(im):
        n = N.new('ShaderNodeTexImage'); n.image = im; n.projection = 'BOX'; n.projection_blend = 0.1; L.new(mp.outputs['Vector'], n.inputs['Vector']); return n
    c, a, nn = T(img(cor)), T(img(ao, 'Non-Color')), T(img(nrm, 'Non-Color'))
    mul = N.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
    L.new(c.outputs['Color'], mul.inputs['A']); L.new(a.outputs['Color'], mul.inputs['B'])
    tn = N.new('ShaderNodeMix'); tn.data_type = 'RGBA'; tn.blend_type = 'MULTIPLY'; tn.inputs['Factor'].default_value = 1
    L.new(mul.outputs['Result'], tn.inputs['A']); tn.inputs['B'].default_value = (*tint, 1)
    L.new(tn.outputs['Result'], b.inputs['Base Color'])
    nm = N.new('ShaderNodeNormalMap'); L.new(nn.outputs['Color'], nm.inputs['Color']); L.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m
def plain(name, rgb, rough=0.6, metal=0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal; return m
CLAD = tex_mat('revestimento', 'revestimento_cor.jpg', 'revestimento_normal.png', 'revestimento_ao.jpg', (1.2, 2.4), tint=(1.08, 1.08, 1.08))
DECK = tex_mat('deck', 'deck_cor.jpg', 'deck_normal.png', 'deck_ao.jpg', (1.12, 1.12), rough=0.8)
PLASTER = plain('estuque', (0.85, 0.83, 0.79), 0.9); FLOOR = plain('soalho', (0.55, 0.38, 0.22), 0.5)
ROOF = plain('cobertura', (0.12, 0.13, 0.14), 0.9); FLASH = plain('rufo', (0.05, 0.055, 0.06), 0.4, 0.6); PLINTH = plain('sapata', (0.2, 0.2, 0.2), 0.9)
GRASS = plain('relva', (0.12, 0.2, 0.06), 1.0)

def cube(name, sx, sy, sz, loc, mat):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts: v.co = Vector((v.co.x*sx, v.co.y*sy, v.co.z*sz))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(mat)
    o = bpy.data.objects.new(name, me); o.location = loc; col.objects.link(o); return o

def module(x0, y0, W, D, openings):
    """openings: list of (side, unit, offset_along_wall, sill). side N(-y) S(+y) E(+x) W(-x); outside = away from centre."""
    T, H, FL = 0.2, 3.0, 0.25
    base = 0.3
    cx, cy = x0+W/2, y0+D/2
    shell = cube('casca', W, D, H, (cx, cy, base+H/2), CLAD)
    inner = cube('vazio', W-2*T, D-2*T, H-FL-0.3, (cx, cy, base+FL+(H-FL-0.3)/2), CLAD)
    m = shell.modifiers.new('oco', 'BOOLEAN'); m.object = inner; m.operation = 'DIFFERENCE'; inner.hide_render = True; inner.hide_viewport = True
    cube('soalho', W-2*T, D-2*T, 0.02, (cx, cy, base+FL), FLOOR)
    cube('tecto', W-2*T, D-2*T, 0.02, (cx, cy, base+H-0.3), PLASTER)
    cube('cobertura', W-0.04, D-0.04, 0.02, (cx, cy, base+H+0.005), ROOF)
    for (sx, sy, lx, ly) in [(W+0.04, 0.06, cx, y0), (W+0.04, 0.06, cx, y0+D), (0.06, D+0.04, x0, cy), (0.06, D+0.04, x0+W, cy)]:
        cube('rufo', sx, sy, 0.14, (lx, ly, base+H+0.02), FLASH)
    cube('sapata', W-0.4, D-0.4, base, (cx, cy, base/2), PLINTH)
    # interior plaster lining
    lin = cube('reboco', W-2*T+0.002, D-2*T+0.002, H-FL-0.3, (cx, cy, base+FL+(H-FL-0.3)/2), PLASTER)
    lin2 = cube('reboco_vazio', W-2*T-0.02, D-2*T-0.02, H, (cx, cy, base+H/2), PLASTER); lin2.hide_render = True; lin2.hide_viewport = True
    lm = lin.modifiers.new('oco', 'BOOLEAN'); lm.object = lin2; lm.operation = 'DIFFERENCE'
    for side, uname, off, sill in openings:
        u = units[uname]; w, h = u['w'], u['h']
        c = u.copy(); col.objects.link(c)
        for ch in u.children:
            cc = ch.copy(); col.objects.link(cc); cc.parent = c
        rot = {'N': 0, 'S': math.pi, 'E': math.pi/2, 'W': -math.pi/2}[side]
        if side in 'NS':
            px, py = cx+off, (y0 if side == 'N' else y0+D)
        else:
            px, py = (x0+W if side == 'E' else x0), cy+off
        c.location = (px, py, base+FL+sill); c.rotation_euler = (0, 0, rot)
        # hole through shell and lining
        dx, dy = (w, 1.0) if side in 'NS' else (1.0, w)
        hole = cube('vao', dx, dy, h, (px, py, base+FL+sill+h/2), CLAD); hole.hide_render = True; hole.hide_viewport = True
        for target in (shell, lin):
            b = target.modifiers.new('vao', 'BOOLEAN'); b.object = hole; b.operation = 'DIFFERENCE'
    return base

# two modules of the Riga: sala (3.8 x 3.5) with glass slider to a deck, quarto (2.8 x 3.5) beside it
module(0, 0, 3.8, 3.5, [('N', 'G_240', 0, 0), ('W', 'W_sala2', 0, 0.7)])
module(3.8, 0, 2.8, 3.5, [('N', 'W_quarto', 0, 0.9), ('E', 'D_entrada', 0.6, 0)])
deck = cube('deck', 3.8, 2.8, 0.06, (1.9, -1.4, 0.27), DECK)
for x in (0.2, 3.6):
    for y in (-0.2, -2.6): cube('pe', 0.1, 0.1, 0.24, (x, y, 0.12), PLINTH)
g = cube('relva', 80, 80, 0.02, (3, 0, -0.01), GRASS)

# sky + sun, camera
w = bpy.data.worlds.new('mundo'); sc.world = w; w.use_nodes = True
sky = w.node_tree.nodes.new('ShaderNodeTexSky')
try: sky.sky_type = 'NISHITA'
except Exception: pass
try: sky.sun_elevation = math.radians(32); sky.sun_rotation = math.radians(200)
except Exception: pass
w.node_tree.links.new(sky.outputs['Color'], w.node_tree.nodes['Background'].inputs['Color'])
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
sun = bpy.data.lights.new('sol', 'SUN'); sun.energy = 3.5; sun.angle = math.radians(1.5)
so = bpy.data.objects.new('sol', sun); col.objects.link(so); so.rotation_euler = (math.radians(55), 0, math.radians(200))
cam = bpy.data.cameras.new('cam'); cam.lens = 30; co = bpy.data.objects.new('cam', cam); col.objects.link(co); sc.camera = co
co.location = (-3.6, -9.5, 2.4)
tgt = Vector((3.4, 0.6, 1.5)); co.rotation_euler = (tgt - co.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 48; sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 1280, 760
sc.view_settings.view_transform = 'AgX'; sc.view_settings.exposure = -1.6; sc.view_settings.look = 'AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in [i.identifier for i in sc.view_settings.bl_rna.properties['look'].enum_items] else 'None'
sc.render.filepath = os.path.join(OUT, 'blender_revisao.jpg'); sc.render.image_settings.file_format = 'JPEG'
bpy.ops.render.render(write_still=True)
print('RENDER OK')
