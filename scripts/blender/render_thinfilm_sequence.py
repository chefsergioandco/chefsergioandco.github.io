"""Cycles photographs of the conservative viscous-film scroll timeline.

The saved studio supplies geometry/camera/light. A separate, explicitly reduced
physical solver supplies every liquid frame and its finite-volume ledger.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_plating_scene import configure_render, restore_reservoir, area, aim
from plating_thinfilm import load_film_mesh
from plating_surface import AnchoredCrescentTransport, _volume, _affine

STATIONS = [24, 72, 120, 168]
STUDIO_SOURCES = [
    'scripts/blender/create_plating_scene.py', 'scripts/blender/plating_spoon.py',
    'scripts/blender/plating_fluid.py', 'scripts/blender/plating_materials.py',
    'scripts/blender/plating_engraving.py', 'scripts/blender/plating_reservoir.py',
    'scripts/blender/plating_external.py',
]
PHYSICAL_SOURCES = ['scripts/blender/plating_thinfilm.py', 'scripts/blender/plating_thinfilm_solver.cpp',
                    'scripts/blender/prepare_plating_performance.py']
RENDER_SOURCES = ['scripts/blender/plating_surface.py', 'scripts/blender/render_thinfilm_sequence.py']


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def pchip4(values, value):
    """Monotone C1 interpolation through the four display stations."""
    values = np.asarray(values, dtype=float)
    delta = np.diff(values) * 3
    slopes = np.zeros(4)
    for i in (1, 2):
        if delta[i-1] * delta[i] > 0:
            slopes[i] = 2 * delta[i-1] * delta[i] / (delta[i-1] + delta[i])
    slopes[0], slopes[3] = (3*delta[0]-delta[1])/2, (3*delta[2]-delta[1])/2
    for i, j in ((0, 0), (3, 2)):
        if slopes[i] * delta[j] <= 0: slopes[i] = 0
        elif abs(slopes[i]) > 3*abs(delta[j]): slopes[i] = 3*delta[j]
    q = np.clip(np.asarray(value), 0., 1.) * 3
    index = np.minimum(2, np.floor(q).astype(int))
    s = q-index
    return ((2*s**3-3*s*s+1)*values[index] + (s**3-2*s*s+s)*slopes[index]/3
            + (-2*s**3+3*s*s)*values[index+1] + (s**3-s*s)*slopes[index+1]/3)


def transported_pose(state, transport):
    source = Vector(state['nozzle_world'])
    target = Vector(transport.map_point(source))
    field_angle = transport.angle_at_x(source.x)
    u = max(0., min(1., (source.x + .192) / .288))
    angle = float(pchip4((-2.25, -1.10, -.70, -.46), u))
    rotation = Matrix.Rotation(angle, 3, 'Z')
    location = target + rotation @ (Vector(state['location']) - source)
    euler = list(state['rotation_euler'])
    euler[2] += angle
    return list(location), euler, {
        'angle_rad': angle, 'field_angle_rad': field_angle,
        'wrist_yaw_adjustment_rad': angle - field_angle,
        'source_anchor_m': list(source), 'target_anchor_m': list(target),
    }


def configure_crescent_photography(scene, states):
    """Keep accepted pools at the four text anchors; only connectors stretch."""
    camera = scene.camera
    camera.location = (-.495, -1.292, .491)
    target = Vector((-.005, -.028, .009))
    aim(camera, target)
    forward = (target - camera.location).normalized()
    ground_depth = (-camera.location).dot(forward)
    camera.data.sensor_fit = 'HORIZONTAL'
    camera.data.sensor_width = 36
    station_y = np.asarray((.12, .58, .76, .85))
    t = np.linspace(0., 1., 2401)
    screen = np.column_stack((.1+.6*t, pchip4(station_y, t)))
    right = Vector((forward.y, -forward.x, 0)).normalized()
    up = right.cross(forward).normalized()
    aspect = 1920 / 600
    def ground_points(field):
        result = []
        for u, v in screen:
            ray = forward + right * ((u-.5)*field/ground_depth) + up * ((.5-v)*field/(aspect*ground_depth))
            point = camera.location + ray * (-camera.location.z / ray.z)
            result.append((point.x, point.y))
        return np.asarray(result)
    field = .52
    points = ground_points(field)
    arc = np.concatenate(([0.], np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))))
    source_x = [states[frame]['nozzle_world'][0] for frame in STATIONS]
    source_y = [states[frame]['nozzle_world'][1] for frame in STATIONS]
    transport = AnchoredCrescentTransport(points, arc[[0, 800, 1600, 2400]], source_x, source_y,
                                         protected_half_width_m=.024)
    camera.data.lens = ground_depth * 36 / field
    last = states[168]
    location, euler, _ = transported_pose(last, transport)
    rotation = Euler(euler, 'XYZ').to_matrix()
    matrix = Matrix.Translation(location) @ rotation.to_4x4()
    bowl = matrix @ Vector((0, 0, .005))
    near = Vector(transport.map_point(last['nozzle_world']))
    near.z = 0
    focus = near.lerp(bowl, .5)
    camera.data.dof.use_dof = True
    camera.data.dof.focus_object = None
    camera.data.dof.focus_distance = (focus - camera.location).dot(forward)
    camera.data.dof.aperture_fstop = 4
    camera.data.dof.aperture_blades = 9

    # Keep the polished handle's reflection shaped for the actual closer view.
    visual = bpy.data.objects['SilverSpoon']
    vertex = min((v for v in visual.data.vertices if -.125 < v.co.y < -.115 and v.normal.z > .5),
                 key=lambda v: abs(v.co.x + .0037) + .25 * abs(v.co.y + .12))
    point = matrix @ vertex.co
    normal = (rotation @ vertex.normal).normalized()
    view = (camera.location - point).normalized()
    reflection = (2 * normal.dot(view) * normal - view).normalized()
    handle_axis = (rotation @ Vector((0, -1, 0))).normalized()
    long_axis = (handle_axis - reflection * handle_axis.dot(reflection)).normalized()
    z_axis = reflection
    x_axis = long_axis.cross(z_axis).normalized()
    y_axis = z_axis.cross(x_axis).normalized()
    strip = scene.objects['Long silver edge softbox']
    strip.location = point + reflection * .65
    strip.rotation_euler = Matrix((x_axis, y_axis, z_axis)).transposed().to_euler()
    key = scene.objects['Large warm silk key']
    key.location = (.12, -.15, .95)
    aim(key, (0, .015, 0))
    photography = {
        'projection': 'perspective', 'camera_location_m': list(camera.location),
        'camera_target_m': list(target), 'ground_horizontal_field_m': field,
        'lens_mm': camera.data.lens, 'f_stop': 4,
        'fixed_focus_point_m': list(focus), 'focus_distance_m': camera.data.dof.focus_distance,
        'focus_method': 'fixed near-end focus; real Cycles aperture depth of field',
    }
    display = {
        **transport.provenance(),
        'mode': 'text-anchored-crescent',
        'method': 'text-anchored crescent presentation of the unchanged accepted liquid',
        'source_x_span_m': [source_x[0], source_x[-1]],
        'screen_station_uv': [[.1+.2*i, float(y)] for i, y in enumerate(station_y)],
        'curve_interpolation': 'linear screen X; monotone PCHIP screen Y through four text anchors',
        'screen_x_anchors': [.1, .3, .5, .7], 'longitudinal_warp_disclosed': True,
        'authored_centerline': True, 'hydraulics_recomputed': False,
        'width_scale': 1, 'height_scale': 1, 'source_preserved': True,
        'source_dataset': 'thinfilm-performance/heightfields.npz',
        'unchanged_source_frames': [24, 72, 120, 168],
        'wrist_framing': 'independent Z-only photographic framing; original pitch, roll, height and local reservoir preserved',
        'wrist_yaw_rule_rad': 'PCHIP(-2.25,-1.10,-.70,-.46) at source stations',
    }
    return photography, transport, display


def project_uv(points, photography):
    points = np.asarray(points, dtype=np.float64).reshape((-1, 3))
    camera = np.asarray(photography['camera_location_m'])
    forward = np.asarray(photography['camera_target_m']) - camera
    forward /= np.linalg.norm(forward)
    right = np.asarray((forward[1], -forward[0], 0.))
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    relative = points - camera
    depth = np.sum(relative * forward, axis=1)
    if np.any(depth <= 0): raise RuntimeError('The photographed object crosses behind the camera')
    ratio = float(-np.sum(camera * forward)) / photography['ground_horizontal_field_m']
    u = .5 + ratio * np.sum(relative * right, axis=1) / depth
    v = .5 - (1920/600) * ratio * np.sum(relative * up, axis=1) / depth
    return np.column_stack((u, v))


def measure(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(obj.matrix_world)
    remaining = set(bm.verts)
    components = 0
    while remaining:
        components += 1
        queue = [remaining.pop()]
        while queue:
            vertex = queue.pop()
            for edge in vertex.link_edges:
                neighbor = edge.other_vert(vertex)
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    queue.append(neighbor)
    result = {'vertices': len(bm.verts), 'faces': len(bm.faces),
              'nonmanifold_edges': sum(not edge.is_manifold for edge in bm.edges),
              'components': components, 'volume_ml': abs(bm.calc_volume(signed=True)) * 1e6,
              'bounds_world_m': {'min': [min(v.co[i] for v in bm.verts) for i in range(3)],
                                 'max': [max(v.co[i] for v in bm.verts) for i in range(3)]}}
    bm.free()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='output/plating-timeline/thinfilm-aligned-final')
    parser.add_argument('--film', default='output/plating-timeline/thinfilm-performance')
    parser.add_argument('--preview-frame', type=int)
    parser.add_argument('--validate-only', action='store_true')
    parser.add_argument('--motion-samples', type=int, default=64)
    parser.add_argument('--station-samples', type=int, default=128)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    output, film = Path(args.output).resolve(), Path(args.film).resolve()
    project = Path(__file__).resolve().parents[2]
    source_hashes = {name: sha(project / name) for name in STUDIO_SOURCES + PHYSICAL_SOURCES + RENDER_SOURCES}
    studio = json.loads((output / 'scene-provenance.json').read_text())
    for name in STUDIO_SOURCES:
        if studio['source_hashes'].get(name) != source_hashes[name]: raise RuntimeError(f'Studio source changed: {name}')
    metadata = json.loads((film / 'metadata.json').read_text())
    if metadata['solver_source_sha256'] != source_hashes[PHYSICAL_SOURCES[1]]: raise RuntimeError('The physical C++ source differs from its solved dataset')
    if metadata['python_source_sha256'] != source_hashes[PHYSICAL_SOURCES[0]]: raise RuntimeError('The physical wrapper differs from its solved dataset')
    if metadata['source_plan_sha256'] != sha(film / 'reservoir-plan.json'): raise RuntimeError('The physical source ledger changed')
    bpy.ops.wm.open_mainfile(filepath=str(output / 'plating.blend'))
    scene = bpy.context.scene
    if any(obj.get('diagnostic_only') for obj in scene.objects): raise RuntimeError('Authored diagnostic sauce must not enter production photography')
    domain = bpy.data.objects['SauceLiquidDomain']
    if any(modifier.type == 'FLUID' for modifier in domain.modifiers): raise RuntimeError('This renderer requires the independent photography studio')
    domain.hide_render = True
    sauce = domain.data.materials[0]
    controls = sauce.node_tree.nodes['Plating material controls']
    material = {'roughness': .07, 'absorption_multiplier': 1.0, 'emulsion_scatter_per_m': 4,
                'roughness_variation': .01, 'transmission': .995}
    for name, value in [('Surface Roughness', .07), ('Absorption Multiplier', 1.0),
                        ('Emulsion Scatter (1/m)', 4), ('Roughness Variation', .01), ('Transmission', .995)]:
        controls.inputs[name].default_value = value
    light = area('Gentle liquid reflection silk', (0, .9, .23), (0, 0, .001), 1.5, .80, .16, (1, .97, .91))
    if hasattr(light.data, 'diffuse_factor'): light.data.diffuse_factor = 0
    reservoir = restore_reservoir(film, sauce)
    if reservoir is None: raise RuntimeError('Missing analytic reservoir plan')
    root = bpy.data.objects['SilverSpoonRoot']
    # A still render evaluates animation again. Remove the studio's baseline
    # action so the saved physical performance is the sole pose authority.
    root.animation_data_clear()
    photography, transport, display_transport = configure_crescent_photography(scene, reservoir.states)
    source_plan = json.loads((film / 'reservoir-plan.json').read_text())
    display_transport['cached_performance_generator_sha256'] = source_plan['provenance']['spoon_performance']['performance_source_sha256']
    display_transport['current_performance_script_executed'] = False
    visual = bpy.data.objects['SilverSpoon']
    local_spoon = np.empty(len(visual.data.vertices) * 3, dtype=np.float64)
    visual.data.vertices.foreach_get('co', local_spoon)
    local_spoon = local_spoon.reshape((-1, 3))
    frames = [args.preview_frame] if args.preview_frame else list(range(24, 169, 2))
    records = []
    directory = output / 'frames'
    directory.mkdir(exist_ok=True)
    for index, frame in enumerate(frames):
        state = reservoir.states[frame]
        scene.frame_set(frame)
        displayed_location, displayed_rotation, pose_transport = transported_pose(state, transport)
        root.location = displayed_location
        root.rotation_euler = displayed_rotation
        reservoir_evidence = reservoir.apply_state(frame)
        obj = load_film_mesh(film, frame, sauce)
        coordinates = np.empty(len(obj.data.vertices) * 3, dtype=np.float64)
        obj.data.vertices.foreach_get('co', coordinates)
        original_coordinates = coordinates.reshape((-1, 3))
        minimum_jacobian = transport.minimum_jacobian(original_coordinates)
        displayed_coordinates = transport.map_points(original_coordinates)
        if np.max(np.abs(displayed_coordinates[:, 2] - original_coordinates[:, 2])) != 0:
            raise RuntimeError('The display bend changed the accepted sauce thickness')
        obj.data.vertices.foreach_set('co', displayed_coordinates.reshape(-1))
        obj.data.update()
        geometry = measure(obj)
        film_evidence = json.loads(obj['thinfilm_provenance'])
        triangles = np.asarray([tuple(p.vertices) for p in obj.data.polygons], dtype=np.int32)
        film_evidence['display_volume_reference_ml'] = _volume(displayed_coordinates, triangles) * 1e6
        film_evidence['display_minimum_jacobian'] = minimum_jacobian
        film_evidence['source_z_preserved'] = True
        film_evidence['rendered_volume_ml'] = geometry['volume_ml']
        film_evidence['relative_volume_error'] = geometry['volume_ml'] / film_evidence['solver_volume_ml'] - 1
        film_evidence['display_transport'] = {**pose_transport,
            'method': 'protected pools with authored connector stretching; accepted physical heightfield unchanged'}
        expected = state['emitted_total_ml']
        reference = film_evidence['display_volume_reference_ml']
        if (geometry['nonmanifold_edges'] or geometry['components'] != 1 or expected <= 0
                or minimum_jacobian <= 0 or not .8 <= geometry['volume_ml']/expected <= 3
                or abs(geometry['volume_ml']/reference - 1) > 1e-5):
            raise RuntimeError(f'Frame{frame} fails connected, closed, finite-volume liquid proof: {geometry}')
        station = frame in STATIONS
        width, height, samples = (1920, 600, args.station_samples) if station or args.preview_frame else (1280, 400, args.motion_samples)
        configure_render(scene, width, height, samples)
        # The page is composited later. Do not bake the cream shadow catcher
        # into the transmitted liquid; retain its shadows and silver reflections.
        surface = bpy.data.objects['PorcelainSurface']
        surface.visible_transmission = False
        scene.cycles.film_transparent_glass = True
        scene.cycles.film_transparent_roughness = .2
        optical_compositing = {
            'film_transparent_glass': bool(scene.cycles.film_transparent_glass),
            'film_transparent_roughness': float(scene.cycles.film_transparent_roughness),
            'shadow_catcher_visible_transmission': bool(surface.visible_transmission),
            'shadow_catcher_is_shadow_catcher': bool(surface.is_shadow_catcher),
            'method': 'Native transparent-glass photography; shadow catcher excluded from transmission rays only',
        }
        bpy.context.view_layer.update()
        spoon_world = _affine(local_spoon, np.asarray(visual.matrix_world, dtype=np.float64))
        spoon_uv = project_uv(spoon_world, photography)
        spoon_bounds = [float(spoon_uv[:, 0].min()), float(spoon_uv[:, 1].min()),
                        float(spoon_uv[:, 0].max()), float(spoon_uv[:, 1].max())]
        if min(spoon_bounds[:2]) < .01 or max(spoon_bounds[2:]) > .99:
            raise RuntimeError(f'Frame{frame} clips the actual spoon: {spoon_bounds}')
        projected_nozzle = project_uv([pose_transport['target_anchor_m']], photography)[0].tolist()
        ground_anchor = list(pose_transport['target_anchor_m']); ground_anchor[2] = 0.
        projected_stop = project_uv([ground_anchor], photography)[0].tolist()
        if station and abs(projected_stop[0] - (.1 + .2 * STATIONS.index(frame))) > 1e-5:
            raise RuntimeError(f'Frame{frame} loses its exact text anchor: {projected_stop}')
        target = output / f'preview-{frame:04d}.png' if args.preview_frame else directory / f'{index:04d}.png'
        scene.render.filepath = str(target)
        if not args.validate_only: bpy.ops.render.render(write_still=True)
        rendered_location, rendered_rotation = list(root.location), list(root.rotation_euler)
        if max(abs(a-b) for a,b in zip(rendered_location, displayed_location)) > 1e-7 or max(abs(a-b) for a,b in zip(rendered_rotation, displayed_rotation)) > 1e-6:
            raise RuntimeError(f'Blender changed the physical spoon pose during render at frame{frame}')
        record = {'frame': frame, 'width': width, 'height': height, 'samples': samples,
                  'png_sha256': None if args.validate_only else sha(target), 'geometry': geometry,
                  'film': film_evidence, 'reservoir': reservoir_evidence,
                  'expected_emitted_volume_ml': expected, 'remaining_reservoir_volume_ml': state['volume_ml'],
                  'root_pose_matches_source': False, 'root_pose_matches_display_transport': True,
                  'source_root_location': state['location'], 'source_root_rotation_euler': state['rotation_euler'],
                  'display_transport': pose_transport,
                  'spoon_screen_bounds': spoon_bounds, 'projected_nozzle_uv': projected_nozzle,
                  'projected_stop_uv': projected_stop,
                  'rendered_root_location': rendered_location, 'rendered_root_rotation_euler': rendered_rotation}
        records.append(record)
        print('THINFILM_VALIDATE_FRAME' if args.validate_only else 'THINFILM_RENDER_FRAME', index, frame, str(target), flush=True)
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0: bpy.data.meshes.remove(mesh)
    for name, digest in source_hashes.items():
        if sha(project / name) != digest: raise RuntimeError(f'Source changed during photography: {name}')
    display_transport.update({key: value for key, value in transport.provenance().items() if key != 'method'})
    proof = {
        'pipeline': 'conservative-viscous-film', 'diagnostic_only': bool(args.preview_frame or args.validate_only),
        'renderer': 'Blender Cycles', 'blender': bpy.app.version_string, 'units': 'meters', 'fps': 24,
        'station_frames': STATIONS, 'full_trail': True, 'source_hashes': source_hashes,
        'studio_blend_sha256': sha(output / 'plating.blend'),
        'studio_provenance_sha256': sha(output / 'scene-provenance.json'),
        'physics_metadata_sha256': sha(film / 'metadata.json'), 'physics_dataset_sha256': sha(film / 'heightfields.npz'),
        'physics_ledger_sha256': sha(film / 'volume-ledger.json'), 'reservoir_plan_sha256': sha(film / 'reservoir-plan.json'),
        'material_overrides': material,
        'liquid_reflection_silk': {'location_m': [0, .9, .23], 'power_w': 1.5, 'size_m': [.80, .16]},
        'photography': photography,
        'optical_compositing': optical_compositing,
        'display_transport': display_transport,
        'motion_rendering': '1280x400/64 samples between detents; native 1920x600/128 samples at the four detents',
        'frames': records,
    }
    filename = 'framing-validation.json' if args.validate_only else f'preview-{args.preview_frame:04d}-proof.json' if args.preview_frame else 'render-provenance.json'
    (output / filename).write_text(json.dumps(proof, indent=2, default=str) + '\n')
    if not args.preview_frame and not args.validate_only: (output / 'render-frames.json').write_text(json.dumps(frames) + '\n')


if __name__ == '__main__': main()
