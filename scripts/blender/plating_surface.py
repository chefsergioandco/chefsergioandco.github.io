"""Conservative render-only skin reconstruction of settled native liquid.

This operates on a frozen mesh copy, never on a fluid domain/cache. The native
upper/lower surfaces are sampled into a 0.25mm height field, unresolved holes
are closed at a 0.5mm kernel, and a 0.3mm Gaussian suppresses mesher-scale pits.
The resulting closed meniscus is normalised to the input mesh's geometric
volume. It is surface reconstruction of CFD output, not an authored trail and
not independent evidence of CFD particle mass or emitted-source calibration.
"""
from __future__ import annotations

import json
import math
from collections import deque

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


class CrescentTransport:
    """Bend frozen straight-trail geometry without scaling its cross sections.

    ``world_points`` samples the desired ground-plane centerline in metres.
    Its arclength must match ``source_x_span``: source X becomes intrinsic
    arclength, and source Y becomes signed distance along the transported
    normal. Source Z is copied exactly. End caps continue along the endpoint
    tangents rather than clamping all their vertices onto one cross section.

    This is an authored photographic centerline deformation of an existing
    solved field, not a new simulation. Its Jacobian is ``1-curvature*y``;
    callers must independently measure the closed mesh volume after bending.
    No height or volume correction is silently applied.
    """

    def __init__(self, world_points, source_x_span=(-0.192, 0.096), *,
                 source_center_y=0.0, length_tolerance_m=0.000002):
        points = np.asarray(world_points, dtype=np.float64)
        if (points.ndim != 2 or points.shape[0] < 3 or points.shape[1] not in (2, 3)
                or not np.isfinite(points).all()):
            raise ValueError('A crescent needs at least three finite 2D/3D ground samples')
        source = np.asarray(source_x_span, dtype=np.float64)
        if source.shape != (2,) or not np.isfinite(source).all() or source[1] <= source[0]:
            raise ValueError('source_x_span must contain two increasing metre coordinates')
        if not math.isfinite(source_center_y) or not math.isfinite(length_tolerance_m) or length_tolerance_m < 0:
            raise ValueError('Invalid crescent source center or length tolerance')
        self._points = points[:, :2].copy()
        lengths = np.sqrt(np.sum(np.diff(self._points, axis=0) ** 2, axis=1))
        if np.any(lengths <= 1e-12):
            raise ValueError('Crescent ground samples must be distinct')
        self._arc = np.concatenate(([0.0], np.cumsum(lengths)))
        self.intrinsic_length_m = float(self._arc[-1])
        self.source_length_m = float(source[1] - source[0])
        if abs(self.intrinsic_length_m - self.source_length_m) > length_tolerance_m:
            raise ValueError(f'Crescent arclength {self.intrinsic_length_m:.12g}m differs from '
                             f'accepted source span {self.source_length_m:.12g}m')
        self._source_span = source
        self._source_center_y = float(source_center_y)
        derivative = np.gradient(self._points, self._arc, axis=0, edge_order=2)
        speed = np.sqrt(np.sum(derivative ** 2, axis=1))
        if np.any(speed <= 1e-12):
            raise ValueError('Crescent centerline contains a degenerate tangent')
        self._tangents = derivative / speed[:, None]
        tangent_derivative = np.gradient(self._tangents, self._arc, axis=0, edge_order=2)
        self._curvature = (self._tangents[:, 0] * tangent_derivative[:, 1]
                           - self._tangents[:, 1] * tangent_derivative[:, 0])
        self._largest_source_half_width_m = 0.0
        self._minimum_jacobian = 1.0
        self._maximum_jacobian = 1.0

    def _sample(self, xs):
        arc = np.asarray(xs, dtype=np.float64) - self._source_span[0]
        return self._sample_arc(arc)

    def _sample_arc(self, arc):
        arc = np.asarray(arc, dtype=np.float64)
        center = np.column_stack([np.interp(arc, self._arc, self._points[:, axis]) for axis in range(2)])
        tangent = np.column_stack([np.interp(arc, self._arc, self._tangents[:, axis]) for axis in range(2)])
        tangent /= np.sqrt(np.sum(tangent ** 2, axis=1))[:, None]
        before, after = np.minimum(arc, 0.0), np.maximum(arc - self.intrinsic_length_m, 0.0)
        center += before[:, None] * self._tangents[0] + after[:, None] * self._tangents[-1]
        curvature = np.interp(arc, self._arc, self._curvature)
        curvature[(arc < 0) | (arc > self.intrinsic_length_m)] = 0.0
        return center, tangent, curvature

    def map_points(self, points):
        """Return a new N×3 array; the input and every source Z are untouched."""
        source = np.asarray(points, dtype=np.float64)
        if source.ndim != 2 or source.shape[1] != 3 or not np.isfinite(source).all():
            raise ValueError('map_points expects finite N×3 metre coordinates')
        if not len(source):
            return source.copy()
        center, tangent, curvature = self._sample(source[:, 0])
        offset = source[:, 1] - self._source_center_y
        jacobian = 1.0 - curvature * offset
        if np.any(jacobian <= 0.0):
            raise ValueError('Crescent curvature folds the supplied finite-width trail')
        result = source.copy()
        result[:, 0] = center[:, 0] - tangent[:, 1] * offset
        result[:, 1] = center[:, 1] + tangent[:, 0] * offset
        self._largest_source_half_width_m = max(self._largest_source_half_width_m, float(np.max(np.abs(offset))))
        self._minimum_jacobian = min(self._minimum_jacobian, float(np.min(jacobian)))
        self._maximum_jacobian = max(self._maximum_jacobian, float(np.max(jacobian)))
        return result

    def map_point(self, point):
        return self.map_points(np.asarray(point, dtype=np.float64).reshape(1, 3))[0]

    def angle_at_x(self, x):
        if not math.isfinite(x):
            raise ValueError('The spoon anchor X must be finite')
        _, tangent, _ = self._sample(np.asarray([x], dtype=np.float64))
        return math.atan2(float(tangent[0, 1]), float(tangent[0, 0]))

    def provenance(self):
        return {
            'method': 'arclength and parallel-normal transport of accepted frozen liquid geometry',
            'revision': 'crescent-transport-v1', 'render_only': True,
            'authored_centerline': True, 'authored_liquid_cross_sections': False,
            'physical_solver_rerun': False, 'source_dataset_modified': False,
            'source_z_preserved': True, 'transverse_scale': 1.0,
            'height_normalization_applied': False,
            'source_x_span_m': self._source_span.tolist(),
            'source_center_y_m': self._source_center_y,
            'intrinsic_length_m': self.intrinsic_length_m,
            'source_length_m': self.source_length_m,
            'intrinsic_length_error_m': self.intrinsic_length_m - self.source_length_m,
            'centerline_samples': int(len(self._points)),
            'centerline_world_xy_m': self._points.tolist(),
            'maximum_abs_curvature_per_m': float(np.max(np.abs(self._curvature))),
            'largest_mapped_source_half_width_m': self._largest_source_half_width_m,
            'minimum_local_area_jacobian': self._minimum_jacobian,
            'maximum_local_area_jacobian': self._maximum_jacobian,
            'end_caps': 'straight tangent extrapolation beyond both source endpoints',
            'volume_caveat': 'Finite-width bending changes local area by 1-curvature*y; closed mesh volume is independently checked after transport.',
        }


class AnchoredCrescentTransport(CrescentTransport):
    """Place accepted pools at exact anchors, stretching only their connectors.

    A protected window around each source knot has unit longitudinal scale
    and constant source-center Y. Connector gaps use a monotone C1 cubic with
    unit endpoint slopes, while their center Y follows a zero-slope smoothstep.
    Cross-trail distances and source Z remain unchanged. The authored connector
    stretching can change the displayed geometric volume; it is not a new
    physical solve, nor is the displayed volume silently normalised.
    """

    def __init__(self, world_points, target_arc_knots, source_x_knots,
                 source_y_knots, *, protected_half_width_m=0.018):
        points = np.asarray(world_points, dtype=np.float64)
        if points.ndim != 2 or points.shape[0] < 3 or points.shape[1] not in (2, 3):
            raise ValueError('An anchored crescent needs finite sampled ground points')
        curve_length = float(np.sqrt(np.sum(np.diff(points[:, :2], axis=0) ** 2, axis=1)).sum())
        super().__init__(points, source_x_span=(0.0, curve_length))
        xs, ys, arcs = (np.asarray(values, dtype=np.float64)
                        for values in (source_x_knots, source_y_knots, target_arc_knots))
        if (xs.ndim != 1 or len(xs) < 2 or ys.shape != xs.shape or arcs.shape != xs.shape
                or not np.isfinite(xs).all() or not np.isfinite(ys).all()
                or not np.isfinite(arcs).all() or np.any(np.diff(xs) <= 0)
                or np.any(np.diff(arcs) <= 0)):
            raise ValueError('Anchor X and target arc knots must be finite and strictly increasing')
        half_width = float(protected_half_width_m)
        if not math.isfinite(half_width) or half_width <= 0:
            raise ValueError('Protected pool half-width must be positive and finite')
        if abs(float(arcs[0])) > 1e-7 or abs(float(arcs[-1]) - self.intrinsic_length_m) > 1e-7:
            raise ValueError('Target arc knots must span the entire sampled crescent')
        source_gap = np.diff(xs) - 2 * half_width
        target_gap = np.diff(arcs) - 2 * half_width
        if np.any(source_gap <= 0) or np.any(target_gap <= 0):
            raise ValueError('Protected source or target pool windows overlap')
        gap_secant = target_gap / source_gap
        minimum_derivative = np.minimum(1.0, 1.0 + 1.5 * (gap_secant - 1.0))
        maximum_derivative = np.maximum(1.0, 1.0 + 1.5 * (gap_secant - 1.0))
        if np.any(minimum_derivative <= 1e-9):
            raise ValueError('A target connector is too compressed for monotone unit-slope cubic transport')
        self._source_knots = xs.copy()
        self._source_y_knots = ys.copy()
        self._target_knots = arcs.copy()
        self._protected_half_width_m = half_width
        self._source_span = xs[[0, -1]].copy()
        self.source_length_m = float(xs[-1] - xs[0])
        self._source_gap = source_gap
        self._target_gap = target_gap
        self._minimum_gap_derivative = minimum_derivative
        self._maximum_gap_derivative = maximum_derivative
        self._anchored_minimum_jacobian = math.inf
        self._anchored_maximum_jacobian = -math.inf

    def _arc_mapping(self, xs):
        xs = np.asarray(xs, dtype=np.float64)
        insertion = np.searchsorted(self._source_knots, xs)
        left = np.clip(insertion - 1, 0, len(self._source_knots) - 1)
        right = np.clip(insertion, 0, len(self._source_knots) - 1)
        nearest = np.where(np.abs(xs - self._source_knots[left]) <= np.abs(xs - self._source_knots[right]), left, right)
        arc = xs - self._source_knots[nearest] + self._target_knots[nearest]
        center_y = self._source_y_knots[nearest].copy()
        derivative = np.ones_like(xs)
        gap = np.clip(np.searchsorted(self._source_knots, xs, side='right') - 1, 0, len(self._source_gap) - 1)
        gap_start = self._source_knots[gap] + self._protected_half_width_m
        gap_end = self._source_knots[gap + 1] - self._protected_half_width_m
        active = (xs > gap_start) & (xs < gap_end)
        if np.any(active):
            selected = gap[active]
            length = self._source_gap[selected]
            t = (xs[active] - gap_start[active]) / length
            smooth = t * t * (3.0 - 2.0 * t)
            delta = self._target_gap[selected] - length
            arc[active] = self._target_knots[selected] + self._protected_half_width_m + length * t + delta * smooth
            derivative[active] = 1.0 + 6.0 * (delta / length) * t * (1.0 - t)
            center_y[active] = (self._source_y_knots[selected]
                                + (self._source_y_knots[selected + 1] - self._source_y_knots[selected]) * smooth)
        return arc, center_y, derivative

    def _sample(self, xs):
        arc, _, _ = self._arc_mapping(xs)
        return self._sample_arc(arc)

    def jacobian_at_points(self, points):
        """Return the signed XY area scale before committing any mesh change."""
        source = np.asarray(points, dtype=np.float64)
        if source.ndim != 2 or source.shape[1] != 3 or not np.isfinite(source).all():
            raise ValueError('jacobian_at_points expects finite N×3 metre coordinates')
        if not len(source):
            return np.empty(0, dtype=np.float64)
        arc, center_y, derivative = self._arc_mapping(source[:, 0])
        _, _, curvature = self._sample_arc(arc)
        return derivative * (1.0 - curvature * (source[:, 1] - center_y))

    def minimum_jacobian(self, points):
        values = self.jacobian_at_points(points)
        return float(np.min(values)) if len(values) else 1.0

    def map_points(self, points):
        source = np.asarray(points, dtype=np.float64)
        if source.ndim != 2 or source.shape[1] != 3 or not np.isfinite(source).all():
            raise ValueError('map_points expects finite N×3 metre coordinates')
        if not len(source):
            return source.copy()
        arc, center_y, derivative = self._arc_mapping(source[:, 0])
        jacobian = self.jacobian_at_points(source)
        if np.any(jacobian <= 0.0):
            raise ValueError('Anchored crescent folds the supplied finite-width trail')
        centered = source.copy()
        centered[:, 1] -= center_y
        result = super().map_points(centered)
        self._anchored_minimum_jacobian = min(self._anchored_minimum_jacobian, float(np.min(jacobian)))
        self._anchored_maximum_jacobian = max(self._anchored_maximum_jacobian, float(np.max(jacobian)))
        return result

    def provenance(self):
        result = super().provenance()
        result.pop('intrinsic_length_error_m')
        result.update({
            'method': 'protected-pool anchored crescent with authored connector-only longitudinal stretching',
            'revision': 'anchored-crescent-transport-v1',
            'authored_longitudinal_connector_stretch': True,
            'protected_pool_half_width_m': self._protected_half_width_m,
            'protected_pool_longitudinal_scale': 1.0,
            'source_x_knots_m': self._source_knots.tolist(),
            'source_y_knots_m': self._source_y_knots.tolist(),
            'target_arc_knots_m': self._target_knots.tolist(),
            'source_center_y_interpolation': 'constant inside protected pools; zero-slope cubic smoothstep in connector gaps',
            'longitudinal_mapping': 'unit slope inside protected pools; monotone C1 cubic Hermite with unit endpoint slopes in connector gaps',
            'source_connector_lengths_m': self._source_gap.tolist(),
            'display_connector_lengths_m': self._target_gap.tolist(),
            'minimum_connector_longitudinal_scale': self._minimum_gap_derivative.tolist(),
            'maximum_connector_longitudinal_scale': self._maximum_gap_derivative.tolist(),
            'presentation_arc_excess_m': self.intrinsic_length_m - self.source_length_m,
            'minimum_local_area_jacobian': self._anchored_minimum_jacobian if math.isfinite(self._anchored_minimum_jacobian) else None,
            'maximum_local_area_jacobian': self._anchored_maximum_jacobian if math.isfinite(self._anchored_maximum_jacobian) else None,
            'volume_caveat': 'Authored connector stretching changes displayed geometric volume; accepted source volume/flow/timing remain frozen and displayed volume is measured separately without normalization.',
        })
        return result


def _shift(array, dx, dy, fill=0):
    result = np.full_like(array, fill)
    height, width = array.shape
    sx0, sx1 = max(0, -dx), min(width, width - dx)
    sy0, sy1 = max(0, -dy), min(height, height - dy)
    result[sy0 + dy:sy1 + dy, sx0 + dx:sx1 + dx] = array[sy0:sy1, sx0:sx1]
    return result


def _disk(radius, step):
    extent = math.ceil(radius / step)
    return [(x, y) for y in range(-extent, extent + 1) for x in range(-extent, extent + 1)
            if (x * step) ** 2 + (y * step) ** 2 <= radius * radius + 1e-15]


def _dilate(mask, offsets):
    result = np.zeros_like(mask)
    for dx, dy in offsets:
        result |= _shift(mask, dx, dy)
    return result


def _close(mask, offsets):
    expanded = _dilate(mask, offsets)
    result = np.ones_like(mask)
    for dx, dy in offsets:
        result &= _shift(expanded, dx, dy)
    return result


def _gaussian(array, sigma_cells):
    radius = max(1, math.ceil(sigma_cells * 3))
    positions = np.arange(-radius, radius + 1, dtype=np.float64)
    weights = np.exp(-0.5 * (positions / max(sigma_cells, 0.01)) ** 2)
    weights /= weights.sum()
    value = array.astype(np.float64)
    horizontal = np.zeros_like(value)
    for offset, weight in zip(range(-radius, radius + 1), weights):
        horizontal += _shift(value, offset, 0) * weight
    result = np.zeros_like(value)
    for offset, weight in zip(range(-radius, radius + 1), weights):
        result += _shift(horizontal, 0, offset) * weight
    return result


def _volume(vertices, triangles):
    if not len(triangles):
        return 0.0
    origin = np.mean(vertices, axis=0)
    points = vertices - origin
    a, b, c = (points[triangles[:, i]] for i in range(3))
    return abs(float(np.einsum('ij,ij->i', a, np.cross(b, c)).sum()) / 6)


def _affine(points, matrix):
    # Explicit component products avoid spurious macOS Accelerate BLAS
    # floating-point warnings when NumPy runs inside Blender's process.
    return (points[:, 0, None] * matrix[:3, 0] + points[:, 1, None] * matrix[:3, 1]
            + points[:, 2, None] * matrix[:3, 2] + matrix[:3, 3])


def _remove_tiny_islands(mask, thickness, cell_area):
    remaining = mask.copy()
    components = []
    height, width = mask.shape
    for start in np.flatnonzero(mask):
        y, x = divmod(int(start), width)
        if not remaining[y, x]:
            continue
        remaining[y, x] = False
        queue = deque([(x, y)])
        indices = []
        while queue:
            px, py = queue.popleft()
            indices.append(py * width + px)
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
                nx, ny = px + dx, py + dy
                if 0 <= nx < width and 0 <= ny < height and remaining[ny, nx]:
                    remaining[ny, nx] = False
                    queue.append((nx, ny))
        mass = float(thickness.ravel()[indices].sum()) * cell_area
        components.append((mass, indices))
    total = sum(item[0] for item in components)
    removed = 0.0
    removed_count = 0
    result = mask.copy()
    for mass, indices in sorted(components, key=lambda item: item[0]):
        if mass < total * 0.005 and removed + mass <= total * 0.01:
            result.ravel()[indices] = False
            removed += mass
            removed_count += 1
    return result, {"input_islands": len(components), "removed_islands": removed_count,
                    "estimated_removed_volume_m3": removed, "maximum_individual_fraction": 0.005,
                    "maximum_aggregate_fraction": 0.01}


def _closed_height_mesh(xs, ys, field, bottom, height):
    """Marching triangles share their contact-line vertices with the bottom.
    This yields a closed smooth contour rather than stepped vertical walls.
    """
    ny, nx = field.shape
    f = field.ravel()
    lo, hi = bottom.ravel(), height.ravel()
    vertices, heights, bases, faces = [], [], [], []
    grid_cache, edge_cache = {}, {}

    def point(index):
        y, x = divmod(index, nx)
        return xs[x], ys[y]

    def original(index):
        pair = grid_cache.get(index)
        if pair is not None:
            return pair
        x, y = point(index)
        top_id, bottom_id = len(vertices), len(vertices) + 1
        vertices.extend(((x, y, lo[index] + hi[index]), (x, y, lo[index])))
        heights.extend((hi[index], 0.0))
        bases.extend((lo[index], lo[index]))
        pair = (top_id, bottom_id)
        grid_cache[index] = pair
        return pair

    def crossing(a, b):
        key = (min(a, b), max(a, b))
        pair = edge_cache.get(key)
        if pair is not None:
            return pair
        t = f[a] / (f[a] - f[b])
        ax, ay = point(a)
        bx, by = point(b)
        base = lo[a] + (lo[b] - lo[a]) * t
        index = len(vertices)
        vertices.append((ax + (bx - ax) * t, ay + (by - ay) * t, base))
        heights.append(0.0)
        bases.append(base)
        pair = (index, index)
        edge_cache[key] = pair
        return pair

    def triangle(ids):
        polygon = []
        for i, a in enumerate(ids):
            b = ids[(i + 1) % 3]
            inside_a, inside_b = f[a] > 0, f[b] > 0
            if inside_a:
                polygon.append(original(a))
            if inside_a != inside_b:
                polygon.append(crossing(a, b))
        for i in range(1, len(polygon) - 1):
            a, b, c = polygon[0], polygon[i], polygon[i + 1]
            faces.append((a[0], b[0], c[0]))
            faces.append((c[1], b[1], a[1]))

    cells = (field[:-1, :-1] > 0) | (field[1:, :-1] > 0) | (field[:-1, 1:] > 0) | (field[1:, 1:] > 0)
    for y, x in zip(*np.nonzero(cells)):
        a = int(y * nx + x)
        triangle((a, a + 1, a + nx + 1))
        triangle((a, a + nx + 1, a + nx))
    return np.asarray(vertices, dtype=np.float64), np.asarray(faces, dtype=np.int32), np.asarray(bases), np.asarray(heights)


def refine_surface(obj, *, voxel_m=0.00025, close_radius_m=0.0005,
                   blur_sigma_m=0.0003, edge_sigma_m=0.00022,
                   max_height_m=0.006, plate_z=0.0):
    """Refine a frozen settled-liquid mesh, committing only a validated skin.

    Tall jets and height-field overhang fill above 5% are rejected unchanged.
    The return value always explains acceptance/rejection and measured volume.
    """
    if obj.get('surface_reconstruction'):
        return json.loads(obj['surface_reconstruction'])
    evidence = {"method": "native-CFD settled-plate height-field surface reconstruction",
                "reconstruction_revision": "native-heightfield-v1",
                "accepted": False, "object": obj.name, "fluid_cache_modified": False,
                "authored_trail": False, "no_authored_outline": True,
                "source": "independently copied native CFD geometry",
                "voxel_m": voxel_m, "close_radius_m": close_radius_m, "closing_radius_m": close_radius_m,
                "blur_sigma_m": blur_sigma_m, "edge_sigma_m": edge_sigma_m,
                "max_height_limit_m": max_height_m,
                "volume_reference": "geometric volume of native cached mesh; not a CFD mass/flux proof"}
    if any(modifier.type == 'FLUID' for modifier in obj.modifiers):
        evidence['rejection'] = 'Pass a frozen render-only mesh copy, never a live fluid domain'
        return evidence
    graph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(graph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=False, depsgraph=graph)
    try:
        if mesh is None or len(mesh.vertices) < 4:
            evidence['rejection'] = 'No liquid mesh'
            return evidence
        local = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
        mesh.vertices.foreach_get('co', local)
        local = local.reshape((-1, 3))
        matrix = np.asarray(evaluated.matrix_world, dtype=np.float64)
        vertices = _affine(local, matrix)
        if not np.isfinite(vertices).all():
            evidence['rejection'] = 'Native mesh has non-finite coordinates'
            return evidence
        mesh.calc_loop_triangles()
        triangles = np.asarray([tuple(triangle.vertices) for triangle in mesh.loop_triangles], dtype=np.int32)
        native_edges = np.sort(np.concatenate((triangles[:, (0, 1)], triangles[:, (1, 2)], triangles[:, (2, 0)])), axis=1)
        _, native_counts = np.unique(native_edges, axis=0, return_counts=True)
        native_open_edges = int(np.count_nonzero(native_counts != 2))
        native_volume = _volume(vertices, triangles)
        minimum, maximum = vertices.min(axis=0), vertices.max(axis=0)
        evidence.update(native_vertices=len(vertices), native_volume_m3=native_volume,
                        native_non_manifold_edges=native_open_edges,
                        maximum_height_m=float(maximum[2] - plate_z))
        if native_open_edges:
            evidence['rejection'] = 'Native mesh is not closed; its geometric-volume reference is unreliable'
            return evidence
        if native_volume <= 1e-12:
            evidence['rejection'] = 'Native mesh has no positive geometric volume'
            return evidence
        if maximum[2] - plate_z > max_height_m:
            evidence['rejection'] = 'Tall jet requires a full 3D reconstruction, not a settled height field'
            return evidence
        pad = close_radius_m + 3 * max(blur_sigma_m, edge_sigma_m) + voxel_m * 3
        step = float(voxel_m)
        dimensions = maximum[:2] - minimum[:2] + 2 * pad
        if np.prod(np.ceil(dimensions / step)) > 1_600_000:
            step *= math.sqrt(float(np.prod(np.ceil(dimensions / step))) / 1_600_000)
        nx, ny = [int(math.ceil(value / step)) + 1 for value in dimensions]
        xs = minimum[0] - pad + np.arange(nx) * step
        ys = minimum[1] - pad + np.arange(ny) * step
        evidence.update(voxel_m=step, grid_shape=[ny, nx])
        tree = BVHTree.FromPolygons([Vector(value) for value in vertices],
                                   [tuple(value) for value in triangles], all_triangles=True)
        # Native vertex support limits exact ray queries to the occupied band;
        # it is only an acceleration mask, not the reconstructed outline.
        support = np.zeros((ny, nx), dtype=bool)
        ix = np.clip(np.rint((vertices[:, 0] - xs[0]) / step).astype(int), 0, nx - 1)
        iy = np.clip(np.rint((vertices[:, 1] - ys[0]) / step).astype(int), 0, ny - 1)
        support[iy, ix] = True
        support = _dilate(support, _disk(max(0.00075, step * 3), step))
        top = np.zeros((ny, nx), dtype=np.float64)
        bottom = np.zeros_like(top)
        raw_mask = np.zeros_like(support)
        above, below = float(maximum[2] + 0.002), float(minimum[2] - 0.002)
        down, up = Vector((0, 0, -1)), Vector((0, 0, 1))
        distance = above - below
        for y, x in zip(*np.nonzero(support)):
            top_hit = tree.ray_cast(Vector((float(xs[x]), float(ys[y]), above)), down, distance)[0]
            if top_hit is None:
                continue
            bottom_hit = tree.ray_cast(Vector((float(xs[x]), float(ys[y]), below)), up, distance)[0]
            if bottom_hit is None or top_hit.z - bottom_hit.z <= 1e-7:
                continue
            raw_mask[y, x] = True
            top[y, x], bottom[y, x] = top_hit.z, bottom_hit.z
    finally:
        evaluated.to_mesh_clear()
    thickness = top - bottom
    column_volume = float(thickness[raw_mask].sum()) * step * step
    excess = column_volume / native_volume - 1
    evidence.update(raw_column_volume_m3=column_volume, overhang_filling_fraction=excess)
    if excess > 0.05:
        evidence['rejection'] = 'Filling multiple liquid layers/overhangs would add more than 5% volume'
        return evidence
    if column_volume <= 1e-12 or not raw_mask.any():
        evidence['rejection'] = 'No resolved settled liquid columns'
        return evidence
    closed = _close(raw_mask, _disk(close_radius_m, step))
    denominator = _gaussian(raw_mask, blur_sigma_m / step)
    safe = np.maximum(denominator, 1e-12)
    smooth_thickness = _gaussian(np.where(raw_mask, thickness, 0), blur_sigma_m / step) / safe
    smooth_bottom = _gaussian(np.where(raw_mask, bottom, 0), blur_sigma_m / step) / safe
    closed, island_evidence = _remove_tiny_islands(closed, smooth_thickness, step * step)
    evidence['islands'] = island_evidence
    field = _gaussian(closed, max(0.8, edge_sigma_m / step)) - 0.5 - 1e-10
    interior = np.maximum(field, 0)
    meniscus = 1 - np.exp(-np.power(interior / 0.17, 1.4))
    heights = smooth_thickness * meniscus
    points, faces, bases, offsets = _closed_height_mesh(xs, ys, field, smooth_bottom, heights)
    if not len(faces):
        evidence['rejection'] = 'Reconstruction produced no closed skin'
        return evidence
    before_normalization = _volume(points, faces)
    if before_normalization <= 1e-12:
        evidence['rejection'] = 'Reconstruction has no enclosed volume'
        return evidence
    factor = native_volume / before_normalization
    evidence.update(pre_normalization_volume_m3=before_normalization, thickness_normalization_factor=factor)
    if not 0.5 <= factor <= 2.0:
        evidence['rejection'] = 'Conservative reconstruction would require excessive thickness normalisation'
        return evidence
    points[:, 2] = bases + offsets * factor
    reconstructed_volume = _volume(points, faces)
    error = reconstructed_volume / native_volume - 1
    evidence.update(reconstructed_volume_m3=reconstructed_volume, relative_volume_error=error,
                    reconstructed_vertices=len(points), reconstructed_faces=len(faces),
                    maximum_reconstructed_height_m=float(points[:, 2].max() - plate_z))
    if abs(error) > 0.05:
        evidence['rejection'] = 'Reconstruction would exceed the 5% geometric-volume bound'
        return evidence
    inverse = np.linalg.inv(matrix)
    points = _affine(points, inverse)
    candidate = bpy.data.meshes.new(obj.name + '_ReconstructedLiquidSkin')
    candidate.from_pydata(points.tolist(), [], faces.tolist())
    candidate.update(calc_edges=True)
    committed_points = np.empty(len(candidate.vertices) * 3, dtype=np.float64)
    candidate.vertices.foreach_get('co', committed_points)
    committed_world = _affine(committed_points.reshape((-1, 3)), matrix)
    committed_volume = _volume(committed_world, faces)
    committed_error = committed_volume / native_volume - 1
    evidence.update(reconstructed_volume_m3=committed_volume, relative_volume_error=committed_error)
    if not np.isfinite(committed_world).all() or abs(committed_error) > 0.05:
        bpy.data.meshes.remove(candidate)
        evidence['rejection'] = 'Committed mesh would exceed the finite-coordinate or 5% volume bound'
        return evidence
    # Each oriented contour is shared by the top and underside. This check is
    # performed before touching the source object's data or modifier stack.
    edge_counts = {}
    for a, b, c in faces:
        for first, second in ((a, b), (b, c), (c, a)):
            key = (min(int(first), int(second)), max(int(first), int(second)))
            edge_counts[key] = edge_counts.get(key, 0) + 1
    bad_edges = sum(count != 2 for count in edge_counts.values())
    evidence['non_manifold_edges'] = bad_edges
    if bad_edges:
        bpy.data.meshes.remove(candidate)
        evidence['rejection'] = 'Reconstructed liquid skin is not closed'
        return evidence
    for material in obj.data.materials:
        candidate.materials.append(material)
    for polygon in candidate.polygons:
        polygon.use_smooth = True
    previous = obj.data
    obj.modifiers.clear()
    obj.data = candidate
    if previous.users == 0:
        bpy.data.meshes.remove(previous)
    evidence['accepted'] = True
    evidence['render_only'] = True
    obj['surface_reconstruction'] = json.dumps(evidence, sort_keys=True)
    return evidence
