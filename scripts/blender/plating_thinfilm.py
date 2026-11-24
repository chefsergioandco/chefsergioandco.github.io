"""Mass-conserving reduced-order gravity/lubrication liquid, not Mantaflow.

The only source is the saved finite reservoir ledger and actual nozzle motion.
An isolated serial C++ finite-volume solver evolves h using
  dh/dt = div(g h^3/(3 nu) grad(h)) + source.
This Newtonian thin-film model omits 3D jet dynamics, surface-tension pressure,
inertia, wetting hysteresis and sloshing. Ballistic impact and the source's
1.5mm Gaussian footprint are explicit approximations. No trail is authored.
"""
from __future__ import annotations

import argparse
from collections import deque
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

import numpy as np


DOMAIN = (-0.24, 0.16, -0.06, 0.06)


def _components(mask):
    remaining = mask.copy()
    rows, columns = mask.shape
    count, largest = 0, 0
    for index in np.flatnonzero(mask):
        y, x = divmod(int(index), columns)
        if not remaining[y, x]:
            continue
        count += 1
        queue = deque([(x, y)])
        remaining[y, x] = False
        size = 0
        while queue:
            px, py = queue.popleft()
            size += 1
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nx, ny = px + dx, py + dy
                if 0 <= nx < columns and 0 <= ny < rows and remaining[ny, nx]:
                    remaining[ny, nx] = False
                    queue.append((nx, ny))
        largest = max(largest, size)
    return {"components": count, "largest_cells": largest, "wet_cells": int(mask.sum())}


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def solve(plan_path, output_dir, *, grid_m=0.00075, viscosity_multiplier=1.0):
    plan_path, output = Path(plan_path).resolve(), Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    plan = json.loads(plan_path.read_text())
    states = plan['states']
    provenance = plan['provenance']
    nu = float(provenance['kinematic_viscosity_m2_s']) * viscosity_multiplier
    if nu <= 0 or not 0.0004 <= grid_m <= 0.001:
        raise ValueError('Need positive viscosity and a 0.4-1mm grid')
    fps = float(provenance['fps'])
    xmin, xmax, ymin, ymax = DOMAIN
    # Domain aspect 10:3: use a multiple of ten so square cells land exactly
    # on all four requested physical boundaries, without an extra Y strip.
    nx = math.ceil(math.ceil((xmax - xmin) / grid_m) / 10) * 10
    dx = (xmax - xmin) / nx
    ny = nx * 3 // 10
    source = output / 'source-plan.tsv'
    rows = [f'{len(states)} {nx} {ny} {dx:.17g} {xmin} {ymin} {nu:.17g} 9.81 .0015 .00075']
    for i, state in enumerate(states):
        before, after = states[max(0, i - 1)], states[min(len(states) - 1, i + 1)]
        duration = float(after['time_s']) - float(before['time_s'])
        translation = [(after['nozzle_world'][axis] - before['nozzle_world'][axis]) / duration if duration else 0 for axis in range(3)]
        volume = float(state['emitted_since_previous_frame_ml']) * 1e-6
        if i:
            interval = float(state['time_s']) - float(states[i - 1]['time_s'])
            if abs(volume * 1e6 - float(state['flow_ml_s']) * interval) > 1e-9:
                raise ValueError('Finite ledger and preceding-interval mean Q disagree')
        values = [int(state['frame']), float(state['time_s']), volume,
                  *state['nozzle_world'], *state['nozzle_velocity_world_m_s'], *translation]
        rows.append(' '.join(f'{value:.17g}' for value in values))
    source.write_text('\n'.join(rows) + '\n')
    cpp = Path(__file__).with_name('plating_thinfilm_solver.cpp')
    executable = output / 'thinfilm-solver'
    environment = {**os.environ, 'OMP_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1',
                   'VECLIB_MAXIMUM_THREADS': '1', 'NUMEXPR_NUM_THREADS': '1'}
    subprocess.run(['clang++', '-O3', '-std=c++17', str(cpp), '-o', str(executable)], check=True, env=environment)
    binary, ledger_path, stats_path = output / 'heightfields.bin', output / 'volume-ledger.tsv', output / 'statistics.txt'
    started = time.perf_counter()
    subprocess.run([str(executable), str(source), str(binary), str(ledger_path), str(stats_path)], check=True, env=environment)
    elapsed = time.perf_counter() - started
    heights = np.fromfile(binary, dtype=np.float64).reshape((len(states), ny, nx))
    xs = xmin + (np.arange(nx) + 0.5) * dx
    ys = ymin + (np.arange(ny) + 0.5) * dx
    frames = np.asarray([state['frame'] for state in states], dtype=np.int32)
    temporary = output / 'heightfields-pending.npz'
    np.savez_compressed(temporary, h=heights, x=xs, y=ys, frames=frames, dx=dx, nu=nu)
    temporary.replace(output / 'heightfields.npz')
    stats = {line.split()[0]: float(line.split()[1]) for line in stats_path.read_text().splitlines()}
    ledger = list(csv.DictReader(ledger_path.read_text().splitlines(), delimiter='\t'))
    target_ml = math.fsum(float(state['emitted_since_previous_frame_ml']) for state in states)
    measured_ml = float(heights[-1].sum()) * dx * dx * 1e6
    errors = [abs(float(row['error_m3'])) * 1e6 for row in ledger]
    combined_errors = [abs(float(row['measured_m3']) * 1e6 + float(state['volume_ml'])
                           - float(provenance['initial_volume_ml'])) for row, state in zip(ledger, states)]
    if heights.min() < -1e-18 or abs(measured_ml - target_ml) > 1e-8:
        raise RuntimeError('Thin-film positivity or final finite-source mass check failed')
    metadata = {
        'model': 'reduced-order Newtonian gravity/lubrication thin-film finite-volume solver',
        'equation': 'dh/dt = div(g*h^3/(3*nu)*grad(h)) + finite Gaussian source',
        'full_3d_Navier_Stokes': False, 'Mantaflow': False, 'authored_trail': False,
        'surface_tension_pressure': False, 'source_plan': str(plan_path), 'source_plan_sha256': _sha(plan_path),
        'solver_source_sha256': _sha(cpp), 'python_source_sha256': _sha(Path(__file__)),
        'source_volume_ml': target_ml, 'measured_final_volume_ml': measured_ml,
        'maximum_frame_volume_error_ml': max(errors), 'positive': bool(heights.min() >= 0),
        'initial_reservoir_volume_ml': float(provenance['initial_volume_ml']),
        'remaining_reservoir_volume_ml': float(states[-1]['volume_ml']),
        'maximum_combined_reservoir_film_error_ml': max(combined_errors),
        'minimum_height_m': float(heights.min()), 'maximum_height_m': float(heights.max()),
        'kinematic_viscosity_m2_s': nu, 'viscosity_multiplier': viscosity_multiplier,
        'gravity_m_s2': 9.81, 'source_sigma_m': 0.0015, 'source_truncation_sigma': 4,
        'source_world_velocity': 'relative exit velocity plus central-difference nozzle translation',
        'impact': 'positive gravity ballistic flight root to porcelain Z=0',
        'frame_count': len(states), 'fps': fps, 'grid': [ny, nx], 'dx_m': dx,
        'domain_xy_m': [xmin, xmin + nx * dx, ymin, ymin + ny * dx],
        'boundary': 'closed no-flux', 'flux': 'shared-face conservative arithmetic h-cubed mobility',
        'integration': 'positive explicit finite volume with source half-steps; adaptive .2 dx^2 / Dmax bound',
        'threads': 1, 'gpu': False, 'wall_seconds': elapsed, 'statistics': stats,
        'assumptions': ['Newtonian low-Re lubrication; no inertial 3D jet, sloshing, contact-angle hysteresis or surface tension pressure.',
                        'Finite reservoir Q is prescribed from the saved analytic reservoir, not measured sauce rheology.',
                        'Ballistic impact and Gaussian footprint approximate jet landing; the plate film itself evolves under gravity and viscosity.',
                        'A render-only rounded contact-line reconstruction is separately disclosed and volume-normalised.'],
    }
    for requested in (168, 180):
        index = next((i for i, state in enumerate(states) if int(state['frame']) == requested), None)
        if index is not None:
            field = heights[index]
            cross_max = field.max(axis=0)
            active_x = [float(state['nozzle_world'][0]) for state in states[:index + 1] if float(state['flow_ml_s']) > 0]
            span = (xs >= min(active_x)) & (xs <= max(active_x)) if active_x else np.zeros_like(xs, dtype=bool)
            metadata[f'frame_{requested}_connectivity_10micron'] = _components(field > 0.00001)
            metadata[f'frame_{requested}_minimum_cross_trail_height_m'] = float(cross_max[span].min()) if span.any() else 0.0
    ledger_json = []
    for row, state in zip(ledger, states):
        ledger_json.append({**{key: int(value) if key in ('frame', 'steps') else float(value) for key, value in row.items()},
                            'reservoir_remaining_ml': float(state['volume_ml']),
                            'film_ml': float(row['measured_m3']) * 1e6,
                            'combined_ml': float(row['measured_m3']) * 1e6 + float(state['volume_ml'])})
    (output / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (output / 'volume-ledger.json').write_text(json.dumps({'source_volume_ml': target_ml, 'frames': ledger_json}, indent=2) + '\n')
    print('THINFILM_SOLVED', json.dumps(metadata, sort_keys=True), flush=True)
    return metadata


def load_film_mesh(output_dir, frame, material, *, meniscus_sigma_m=0.00075):
    """Create one closed render mesh from an actual solved whole-film frame."""
    import bpy
    from plating_surface import _gaussian, _closed_height_mesh, _volume
    output = Path(output_dir)
    data = np.load(output / 'heightfields.npz')
    frames = data['frames']
    matches = np.flatnonzero(frames == int(frame))
    if not len(matches):
        raise ValueError(f'Frame {frame} is not in the solved thin-film sequence')
    h = data['h'][int(matches[0])].copy()
    xs, ys, dx = data['x'], data['y'], float(data['dx'])
    metadata = json.loads((output / 'metadata.json').read_text())
    target_volume = float(h.sum()) * dx * dx
    if target_volume <= 1e-15:
        mesh = bpy.data.meshes.new(f'ThinFilmFrame{frame}Empty')
        obj = bpy.data.objects.new(mesh.name, mesh)
        bpy.context.collection.objects.link(obj)
        return obj
    # This is an optical contact-line approximation, not a capillary PDE term.
    h = _gaussian(h, max(0.01, meniscus_sigma_m / dx))
    field = h - 0.000001
    wet_components = _components(field > 0)
    bottom = np.full_like(h, 0.000002)
    points, faces, bases, offsets = _closed_height_mesh(xs, ys, field, bottom, h)
    volume_before = _volume(points, faces)
    factor = target_volume / volume_before
    points[:, 2] = bases + offsets * factor
    rendered_volume = _volume(points, faces)
    mesh = bpy.data.meshes.new(f'ConservativeWholeThinFilmFrame{frame}')
    mesh.from_pydata(points.tolist(), [], faces.tolist())
    mesh.update(calc_edges=True)
    committed = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get('co', committed)
    rendered_volume = _volume(committed.reshape((-1, 3)), faces)
    edges = np.sort(np.concatenate((faces[:, (0, 1)], faces[:, (1, 2)], faces[:, (2, 0)])), axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    open_edges = int(np.count_nonzero(counts != 2))
    parents = list(range(len(points)))
    def find(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index
    for a, b, c in faces:
        ra, rb, rc = find(int(a)), find(int(b)), find(int(c))
        parents[rb] = ra
        parents[rc] = ra
    mesh_components = len({find(index) for index in range(len(points))})
    if open_edges or abs(rendered_volume / target_volume - 1) > 0.05:
        bpy.data.meshes.remove(mesh)
        raise RuntimeError('Thin-film render mesh failed closed-surface/volume validation')
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.collection.objects.link(obj)
    evidence = {'model': metadata['model'], 'source_plan_sha256': metadata['source_plan_sha256'],
                'frame': int(frame), 'authored_trail': False,
                'whole_continuous_film': mesh_components == 1,
                'mesh_connected_components': mesh_components, 'wet_field_connectivity': wet_components,
                'full_3d_Navier_Stokes': False, 'Mantaflow': False,
                'solver_volume_ml': target_volume * 1e6, 'rendered_volume_ml': rendered_volume * 1e6,
                'non_manifold_edges': open_edges,
                'relative_volume_error': rendered_volume / target_volume - 1,
                'render_meniscus_sigma_m': meniscus_sigma_m, 'render_height_normalization': factor,
                'contact_offset_m': 0.000002, 'source_dataset': str(output / 'heightfields.npz')}
    obj['thinfilm_provenance'] = json.dumps(evidence, sort_keys=True)
    print('THINFILM_MESH', json.dumps(evidence, sort_keys=True), flush=True)
    return obj


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--grid', type=float, default=0.00075)
    parser.add_argument('--viscosity-multiplier', type=float, default=1.0)
    options = parser.parse_args()
    solve(options.plan, options.output, grid_m=options.grid, viscosity_multiplier=options.viscosity_multiplier)


if __name__ == '__main__':
    main()
