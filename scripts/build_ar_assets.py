"""Derive portable, textured AR variants from the unchanged supplied GLB.

Requires Python 3, Pillow, and macOS usdcat/usdchecker. No source field data
or numerical property estimates are generated. Every atlas tile copies one
RGB triplet from the original six-row texture.
"""
import copy
import hashlib
import io
import json
import pathlib
import struct
import subprocess
import tempfile
import zipfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
COLS, ROWS, TILE = 64, 32, 16
SLUGS = ['oil-saturation', 'permeability-het', 'permeability-hom',
         'porosity-het', 'porosity-hom', 'depth']


def read_glb(path):
    b = path.read_bytes()
    size = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20 + size]), b[28 + size:]


def accessor(j, binary, number):
    a = j['accessors'][number]
    view = j['bufferViews'][a['bufferView']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    fmt = {5126: 'f', 5125: 'I', 5123: 'H'}[a['componentType']]
    offset = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    return list(struct.unpack_from('<' + fmt * a['count'] * width, binary, offset))


def pack_glb(j, binary):
    binary += b'\0' * (-len(binary) % 4)
    j['buffers'][0]['byteLength'] = len(binary)
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    return (struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(binary))
            + struct.pack('<II', len(js), 0x4E4F534A) + js
            + struct.pack('<II', len(binary), 0x004E4942) + binary)


def numbers(values):
    return ', '.join(str(v) for v in values)


def vectors(values, width):
    return ', '.join('(' + numbers(values[i:i + width]) + ')'
                     for i in range(0, len(values), width))


def usda(j, binary, uv):
    text = '''#usda 1.0
(
    defaultPrim = "Reservoir"
    metersPerUnit = 1
    upAxis = "Y"
)
def Xform "Reservoir" (kind = "component") {
    def Scope "Looks" {
        def Material "Property" {
            token outputs:surface.connect = </Reservoir/Looks/Property/Surface.outputs:surface>
            def Shader "Surface" {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor.connect = </Reservoir/Looks/Property/Texture.outputs:rgb>
                float inputs:metallic = 0
                float inputs:roughness = 0.85
                token outputs:surface
            }
            def Shader "Texture" {
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @property.png@
                token inputs:sourceColorSpace = "sRGB"
                token inputs:wrapS = "clamp"
                token inputs:wrapT = "clamp"
                float2 inputs:st.connect = </Reservoir/Looks/Property/UV.outputs:result>
                float3 outputs:rgb
            }
            def Shader "UV" {
                uniform token info:id = "UsdPrimvarReader_float2"
                string inputs:varname = "st"
                float2 outputs:result
            }
        }
'''
    for m in j['materials'][1:]:
        pbr = m['pbrMetallicRoughness']
        text += f'''        def Material "{m['name']}" {{
            token outputs:surface.connect = </Reservoir/Looks/{m['name']}/Surface.outputs:surface>
            def Shader "Surface" {{
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = ({numbers(pbr['baseColorFactor'][:3])})
                float inputs:metallic = {pbr['metallicFactor']}
                float inputs:roughness = {pbr['roughnessFactor']}
                token outputs:surface
            }}
        }}
'''
    text += '    }\n'
    for mesh in j['meshes']:
        p = mesh['primitives'][0]
        points = accessor(j, binary, p['attributes']['POSITION'])
        indices = accessor(j, binary, p['indices'])
        name = mesh['name'].replace('-', '_')
        mat = 'Property' if p['material'] == 0 else j['materials'][p['material']]['name']
        text += f'''    def Mesh "{name}" (prepend apiSchemas = ["MaterialBindingAPI"]) {{
        uniform token subdivisionScheme = "none"
        uniform bool doubleSided = true
        rel material:binding = </Reservoir/Looks/{mat}>
        point3f[] points = [{vectors(points, 3)}]
        int[] faceVertexCounts = [{numbers([3] * (len(indices) // 3))}]
        int[] faceVertexIndices = [{numbers(indices)}]
'''
        if 'NORMAL' in p['attributes']:
            normals = accessor(j, binary, p['attributes']['NORMAL'])
            text += f'        normal3f[] normals = [{vectors(normals, 3)}] (interpolation = "vertex")\n'
        if p['material'] == 0:
            usd_uv = [value if i % 2 == 0 else 1 - value for i, value in enumerate(uv)]
            text += f'        texCoord2f[] primvars:st = [{vectors(usd_uv, 2)}] (interpolation = "vertex")\n'
        text += '    }\n'
    return text + '}\n'


def zip_usdz(path, members):
    # USDZ entries must be stored (not compressed), with 64-byte data alignment.
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_STORED) as z:
        for name, content in members:
            info = zipfile.ZipInfo(name)
            padding = (-(z.fp.tell() + 30 + len(name.encode()) + 4)) % 64
            info.extra = struct.pack('<HH', 0xCAFE, padding) + bytes(padding)
            z.writestr(info, content)


def main():
    source, binary = read_glb(ROOT / 'reservoir.glb')
    image_view = source['bufferViews'][source['images'][0]['bufferView']]
    texture = Image.open(io.BytesIO(binary[image_view['byteOffset']:image_view['byteOffset'] + image_view['byteLength']])).convert('RGB')
    assert texture.size == (1870, 6)
    primitive = source['meshes'][0]['primitives'][0]
    uv_index = primitive['attributes']['TEXCOORD_0']
    old_uv = accessor(source, binary, uv_index)
    cells = [int(u * 1870) for u in old_uv[::2]]
    uv = [v for cell in cells for v in ((cell % COLS + .5) / COLS, (cell // COLS + .5) / ROWS)]
    out = ROOT / 'ar'
    out.mkdir(exist_ok=True)
    metadata = json.loads((ROOT / 'model.json').read_text())
    manifest = {'version': 1, 'atlas': {'columns': COLS, 'rows': ROWS, 'tilePixels': TILE},
                'sourceGLBSha256': hashlib.sha256((ROOT / 'reservoir.glb').read_bytes()).hexdigest(), 'properties': []}
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        for row, slug in enumerate(SLUGS):
            atlas = Image.new('RGB', (COLS * TILE, ROWS * TILE))
            for cell in range(1870):
                x, y = cell % COLS * TILE, cell // COLS * TILE
                atlas.paste(texture.getpixel((cell, row)), (x, y, x + TILE, y + TILE))
            png = io.BytesIO(); atlas.save(png, format='PNG'); png = png.getvalue()
            j = copy.deepcopy(source)
            data = bytearray(binary)
            def append(data_bytes):
                data.extend(b'\0' * (-len(data) % 4)); offset = len(data); data.extend(data_bytes)
                return {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data_bytes)}
            j['bufferViews'][source['images'][0]['bufferView']] = append(png)
            j['bufferViews'][j['accessors'][uv_index]['bufferView']] = append(struct.pack('<' + 'f' * len(uv), *uv))
            j['accessors'][uv_index].pop('min', None); j['accessors'][uv_index].pop('max', None)
            j['materials'][0]['pbrMetallicRoughness']['baseColorTexture'].pop('extensions', None)
            j.pop('extensionsUsed', None)
            j['asset']['generator'] = 'Reservoir Explorer portable AR export; original geometry and RGB values'
            stem = slug + '-v1'
            glb_path, usdz_path = out / (stem + '.glb'), out / (stem + '.usdz')
            glb_path.write_bytes(pack_glb(j, bytes(data)))
            (tmp / 'property.png').write_bytes(png)
            (tmp / 'reservoir.usda').write_text(usda(source, binary, uv))
            subprocess.run(['/usr/bin/usdcat', str(tmp / 'reservoir.usda'), '-o', str(tmp / 'reservoir.usdc')], check=True, capture_output=True)
            zip_usdz(usdz_path, [('reservoir.usdc', (tmp / 'reservoir.usdc').read_bytes()), ('property.png', png)])
            subprocess.run(['/usr/bin/usdchecker', '--arkit', '--strict', str(usdz_path)], check=True, capture_output=True)
            manifest['properties'].append({'row': row, 'name': metadata['properties'][row]['name'],
                'glb': 'ar/' + glb_path.name, 'usdz': 'ar/' + usdz_path.name,
                'glbSha256': hashlib.sha256(glb_path.read_bytes()).hexdigest(),
                'usdzSha256': hashlib.sha256(usdz_path.read_bytes()).hexdigest()})
            print(f'{slug}: GLB {glb_path.stat().st_size:,} bytes; USDZ {usdz_path.stat().st_size:,}; Apple ARKit strict validation passed')
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
