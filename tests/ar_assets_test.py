"""Check source geometry, every encoded cell color, and packaged AR materials."""
import ast
import hashlib
import io
import json
import pathlib
import re
import struct
import subprocess
import sys
import zipfile

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from build_ar_assets import ROOT, accessor, read_glb

original, binary = read_glb(ROOT / 'reservoir.glb')
manifest = json.loads((ROOT / 'ar/manifest.json').read_text())
assert hashlib.sha256((ROOT / 'reservoir.glb').read_bytes()).hexdigest() == manifest['sourceGLBSha256']
view = original['bufferViews'][original['images'][0]['bufferView']]
colors = Image.open(io.BytesIO(binary[view['byteOffset']:view['byteOffset'] + view['byteLength']])).convert('RGB')
original_uv = accessor(original, binary, original['meshes'][0]['primitives'][0]['attributes']['TEXCOORD_0'])

for asset in manifest['properties']:
    j, b = read_glb(ROOT / asset['glb'])
    assert j['nodes'] == original['nodes'] and j['scenes'] == original['scenes']
    assert len(j['meshes']) == len(original['meshes']) == 5
    for old, new in zip(original['meshes'], j['meshes']):
        a, c = old['primitives'][0], new['primitives'][0]
        for key in ['POSITION', 'NORMAL']:
            if key in a['attributes']:
                assert accessor(original, binary, a['attributes'][key]) == accessor(j, b, c['attributes'][key])
        assert accessor(original, binary, a['indices']) == accessor(j, b, c['indices'])
    assert j['materials'][1:] == original['materials'][1:]
    assert 'extensions' not in j['materials'][0]['pbrMetallicRoughness']['baseColorTexture']
    v = j['bufferViews'][j['images'][0]['bufferView']]
    png = b[v['byteOffset']:v['byteOffset'] + v['byteLength']]
    atlas = Image.open(io.BytesIO(png)).convert('RGB')
    assert atlas.size == (1024, 512)
    for cell in range(1870):
        x, y = cell % 64 * 16, cell // 64 * 16
        assert atlas.crop((x, y, x + 16, y + 16)).getcolors() == [(256, colors.getpixel((cell, asset['row'])))]
    uv = accessor(j, b, j['meshes'][0]['primitives'][0]['attributes']['TEXCOORD_0'])
    for i, u in enumerate(original_uv[::2]):
        assert int(u * 1870) == int(uv[i * 2 + 1] * 32) * 64 + int(uv[i * 2] * 64)
    with zipfile.ZipFile(ROOT / asset['usdz']) as z:
        assert z.namelist() == ['reservoir.usdc', 'property.png']
        assert z.read('property.png') == png
        for member in z.infolist():
            assert member.compress_type == zipfile.ZIP_STORED
        raw = (ROOT / asset['usdz']).read_bytes()
        for member in z.infolist():
            name_len, extra_len = struct.unpack_from('<HH', raw, member.header_offset + 26)
            assert (member.header_offset + 30 + name_len + extra_len) % 64 == 0
    text = subprocess.check_output(['/usr/bin/usdcat', str(ROOT / asset['usdz'])], text=True)
    assert 'UsdUVTexture' in text and 'UsdPrimvarReader_float3' not in text
    assert 'inputs:sourceColorSpace = "sRGB"' in text
    assert text.count('rel material:binding =') == 5
    points = re.findall(r'point3f\[\] points = (\[[^\n]+\])', text)
    indices = re.findall(r'int\[\] faceVertexIndices = (\[[^\n]+\])', text)
    assert len(points) == len(indices) == 5
    for n, mesh in enumerate(original['meshes']):
        p = mesh['primitives'][0]
        expected = accessor(original, binary, p['attributes']['POSITION'])
        actual = [v for xyz in ast.literal_eval(points[n]) for v in xyz]
        # usdcat prints decimal floats; tolerate only that text serialization.
        assert len(expected) == len(actual) and max(abs(a - b) for a, b in zip(expected, actual)) < 1e-7
        assert ast.literal_eval(indices[n]) == accessor(original, binary, p['indices'])
    usd_uv = ast.literal_eval(re.search(r'texCoord2f\[\] primvars:st = (\[[^\n]+\])', text)[1])
    for n, (u, v) in enumerate(usd_uv):
        assert abs(u - uv[n * 2]) < 1e-7 and abs(v - (1 - uv[n * 2 + 1])) < 1e-7
    subprocess.run(['/usr/bin/usdchecker', '--arkit', '--strict', str(ROOT / asset['usdz'])], check=True, capture_output=True)
    print(asset['name'] + ': exact source geometry / colors / UV addressing / packaged material / ARKit checks passed')
