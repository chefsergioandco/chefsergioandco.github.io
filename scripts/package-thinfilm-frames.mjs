// Package conservative thin-film photographs and their physical ledger.
// An explicit display transport may bend the unchanged cached solution for presentation.
// This never solves, renders, or replaces a missing frame with study artwork.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import sharp from 'sharp'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const { positionals, values } = parseArgs({ allowPositionals: true, options: { film: { type: 'string', default: 'output/plating-timeline/thinfilm-performance' } } })
if (positionals.length > 1) throw new Error('Usage: node scripts/package-thinfilm-frames.mjs [render-directory] --film [solved-film-directory]')
const INPUT = path.resolve(ROOT, positionals[0] || 'output/plating-timeline/thinfilm-aligned-final')
const FILM = path.resolve(ROOT, values.film)
const DESTINATION = path.join(ROOT, 'public/art/plating')
const REGISTRY = path.join(ROOT, 'content/art.source.json')
const PIPELINE = 'conservative-viscous-film'
const STUDIO = [
  'scripts/blender/create_plating_scene.py', 'scripts/blender/plating_spoon.py',
  'scripts/blender/plating_fluid.py', 'scripts/blender/plating_materials.py',
  'scripts/blender/plating_engraving.py', 'scripts/blender/plating_reservoir.py',
  'scripts/blender/plating_external.py',
]
const PHYSICAL = ['scripts/blender/plating_thinfilm.py', 'scripts/blender/plating_thinfilm_solver.cpp', 'scripts/blender/prepare_plating_performance.py']
const RENDER = ['scripts/blender/plating_surface.py', 'scripts/blender/render_thinfilm_sequence.py']
const SOURCES = [...STUDIO, ...PHYSICAL, ...RENDER]
const STATION_FRAMES = [24, 72, 120, 168]
const FRAMES = Array.from({ length: 73 }, (_, index) => 24 + index * 2)
const TOLERANCE_ML = 1e-6
const MODEL = 'reduced-order Newtonian gravity/lubrication thin-film finite-volume solver'
const DISPLAY_METHOD = 'arc-length crescent presentation of the unchanged accepted liquid'
const ANCHORED_MODE = 'text-anchored-crescent'
const ANCHORED_METHOD = 'text-anchored crescent presentation of the unchanged accepted liquid'
const WRIST_FRAMING = 'independent Z-only photographic framing; original pitch, roll, height and local reservoir preserved'
const ACCEPTED_SOURCE_HASHES = {
  physics_metadata_sha256: '6e539e6df9eed3f49c5fce7347394467f9d76c1cd757dcb17d0f875e93f1d6b1',
  physics_dataset_sha256: '14219b577ee6edfde5b3547788ddd08f16e31245cfabec6aa12d8f2d908c3f10',
  physics_ledger_sha256: '33a568040f23577b2e59bb0ba0500dfb1ec2a4ae632cfa2a5e2b6354d9c4aa29',
  reservoir_plan_sha256: 'ea6d3d8ff0171c93c157bbf16d7634edf48c9af197ac2cf536c30a6ebfdfc552',
}
const AI_CREDENTIAL = /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia/
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const fail = message => { throw new Error(message) }
const number = (value, label, minimum = 0) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(parsed) || parsed < minimum) fail(`Invalid ${label}`)
  return parsed
}
const near = (actual, expected, label, tolerance = TOLERANCE_ML) => {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > tolerance) fail(`${label}: ${actual} differs from ${expected}`)
}
const exact = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} does not match the required production sequence`)
}
async function read(folder, name, json = true) {
  const bytes = await fs.readFile(path.join(folder, name))
  return { bytes, sha256: sha(bytes), ...(json ? { value: JSON.parse(bytes.toString('utf8')) } : {}) }
}
async function sourcesNow() {
  return Promise.all(SOURCES.map(async source => ({ path: source, sha256: sha(await fs.readFile(path.join(ROOT, source))) })))
}

function validatePhysics(metadata, plan, ledger) {
  if (metadata.model !== MODEL || metadata.full_3d_Navier_Stokes !== false || metadata.Mantaflow !== false || metadata.authored_trail !== false || metadata.surface_tension_pressure !== false || metadata.positive !== true) fail('The physical dataset must explicitly establish its positive, unauthored reduced-order model')
  if (metadata.frame_count !== 180 || metadata.boundary !== 'closed no-flux') fail('The physical dataset must contain all 180 frames with no-flux boundaries')
  const initial = number(plan.provenance?.initial_volume_ml, 'initial reservoir volume', Number.MIN_VALUE)
  near(initial, 8, 'Production initial reservoir volume')
  const fps = number(plan.provenance?.fps, 'reservoir fps', 1)
  near(fps, 24, 'Reservoir fps', 1e-9)
  near(number(metadata.fps, 'physical fps'), fps, 'Physical fps', 1e-9)
  if (plan.provenance.full_moving_cup_CFD !== false || !Array.isArray(plan.states) || plan.states.length !== 180 || plan.states.some((state, index) => state.frame !== index + 1)) fail('The complete analytic reservoir plan and explicit approximation are required')
  if (!Array.isArray(ledger.frames) || ledger.frames.length !== 180 || ledger.frames.some((row, index) => Number(row.frame) !== index + 1)) fail('The physical volume ledger must contain frames 1 through 180 exactly once')
  const states = []
  let previous = initial, cumulative = 0, maximumError = 0
  for (let index = 0; index < 180; index++) {
    const state = plan.states[index], row = ledger.frames[index], frame = index + 1
    const remaining = number(state.volume_ml, `reservoir frame ${frame} remaining volume`)
    const emitted = number(state.emitted_total_ml, `reservoir frame ${frame} cumulative emission`)
    const interval = number(state.emitted_since_previous_frame_ml, `reservoir frame ${frame} interval emission`)
    const flow = number(state.flow_ml_s, `reservoir frame ${frame} mean flow`)
    cumulative += interval
    near(previous - remaining, interval, `Reservoir frame ${frame} finite interval`)
    near(flow / fps, interval, `Reservoir frame ${frame} mean-Q interval`)
    near(cumulative, emitted, `Reservoir frame ${frame} cumulative ledger`)
    near(remaining + emitted, initial, `Reservoir frame ${frame} conservation`)
    if (remaining > previous + TOLERANCE_ML || remaining > initial + TOLERANCE_ML) fail(`Reservoir frame ${frame} gained liquid`)
    if (index === 0) { near(remaining, initial, 'Initial reservoir'); near(emitted, 0, 'Initial emission'); near(interval, 0, 'Initial interval') }
    const measured = number(row.measured_m3, `film frame ${frame} measured volume`) * 1e6
    const target = number(row.target_m3, `film frame ${frame} source target`) * 1e6
    const minimum = number(row.minimum_height_m, `film frame ${frame} minimum height`)
    const maximum = number(row.maximum_height_m, `film frame ${frame} maximum height`)
    if (maximum < minimum) fail(`Film frame ${frame} has invalid height bounds`)
    near(target, emitted, `Film frame ${frame} target versus finite emission`)
    near(measured, target, `Film frame ${frame} finite-volume conservation`)
    near(number(row.reservoir_remaining_ml, `film frame ${frame} reservoir ledger`), remaining, `Film frame ${frame} reservoir reference`)
    near(number(row.film_ml, `film frame ${frame} millilitre ledger`), measured, `Film frame ${frame} measured ledger`)
    near(number(row.combined_ml, `film frame ${frame} combined ledger`), initial, `Film frame ${frame} combined ledger`)
    near(measured + remaining, initial, `Film frame ${frame} combined reservoir + film mass`)
    near(Number(row.error_m3) * 1e6, measured - target, `Film frame ${frame} recorded error`)
    near(number(row.time_s, `film frame ${frame} time`), index / fps, `Film frame ${frame} time`, 1e-9)
    maximumError = Math.max(maximumError, Math.abs(measured + remaining - initial), Math.abs(measured - target))
    states.push({ frame, remainingReservoirMl: remaining, filmVolumeMl: measured, plannedEmittedMl: emitted, plannedIntervalEmissionMl: interval, meanFlowMlS: flow, minimumHeightM: minimum, maximumHeightM: maximum })
    previous = remaining
  }
  const last = states.at(-1)
  near(number(metadata.source_volume_ml, 'physical total finite source'), last.plannedEmittedMl, 'Physical source summary')
  near(number(metadata.measured_final_volume_ml, 'physical final measured volume'), last.filmVolumeMl, 'Physical final volume summary')
  near(number(metadata.initial_reservoir_volume_ml, 'physical initial reservoir reference'), initial, 'Physical initial reservoir summary')
  near(number(metadata.remaining_reservoir_volume_ml, 'physical remaining reservoir reference'), last.remainingReservoirMl, 'Physical remaining reservoir summary')
  near(number(ledger.source_volume_ml, 'ledger total finite source'), last.plannedEmittedMl, 'Ledger source summary')
  near(number(plan.provenance.remaining_volume_ml, 'analytic final remaining volume'), last.remainingReservoirMl, 'Analytic remaining summary')
  near(number(plan.provenance.emitted_volume_ml, 'analytic final emission'), last.plannedEmittedMl, 'Analytic emission summary')
  if (number(metadata.maximum_frame_volume_error_ml, 'maximum physical volume error') > TOLERANCE_ML || number(metadata.maximum_combined_reservoir_film_error_ml, 'maximum combined reservoir/film error') > TOLERANCE_ML || number(plan.provenance.maximum_mass_balance_error_ml, 'maximum analytic error') > TOLERANCE_ML) fail('Recorded physical/analytic mass error exceeds tolerance')
  const nu = number(metadata.kinematic_viscosity_m2_s, 'film kinematic viscosity', Number.MIN_VALUE)
  const dx = number(metadata.dx_m, 'film grid spacing', Number.MIN_VALUE)
  if (!Array.isArray(metadata.grid) || metadata.grid.length !== 2 || metadata.grid.some(value => !Number.isInteger(value) || value < 3)) fail('Invalid physical grid shape')
  if (!Array.isArray(metadata.domain_xy_m) || metadata.domain_xy_m.length !== 4 || !metadata.domain_xy_m.every(Number.isFinite)) fail('Invalid physical domain')
  near((metadata.domain_xy_m[1] - metadata.domain_xy_m[0]) / dx, metadata.grid[1], 'Physical X extent/grid', 1e-6)
  near((metadata.domain_xy_m[3] - metadata.domain_xy_m[2]) / dx, metadata.grid[0], 'Physical Y extent/grid', 1e-6)
  return { initial, fps, nu, dx, states, maximumError }
}

function finiteVector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) fail(`Invalid ${label}`)
  return [...value]
}

function nearVector(actual, expected, label, tolerance = 1e-7) {
  const vector = finiteVector(actual, label)
  const reference = finiteVector(expected, `${label} reference`)
  for (let axis = 0; axis < 3; axis++) near(vector[axis], reference[axis], `${label} axis ${axis}`, tolerance)
  return vector
}

function finiteArray(value, length, label) {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) fail(`Invalid ${label}`)
  return [...value]
}

function renderLayout(displayTransport) {
  return displayTransport?.mode === ANCHORED_MODE
    ? { desktop: [1920, 600], motion: [1280, 400], mobile: [768, 240] }
    : { desktop: [1920, 900], motion: [1280, 600], mobile: [768, 360] }
}

function validateDisplayTransport(value, plan) {
  if (value === undefined) return undefined
  const anchored = value?.mode === ANCHORED_MODE
  if (value?.mode !== undefined && !anchored) fail('Unknown display transport mode')
  const method = anchored ? ANCHORED_METHOD : DISPLAY_METHOD
  if (!value || value.method !== method || value.authored_centerline !== true || value.hydraulics_recomputed !== false || value.source_preserved !== true) fail('Display transport must explicitly preserve the original solve and disclose its authored presentation centerline')
  if (anchored) {
    const span = finiteArray(value.source_x_span_m, 2, 'display transport accepted source span')
    near(span[0], -.192, 'Accepted source span start', 1e-7)
    near(span[1], .096, 'Accepted source span end', 1e-7)
  } else exact(value.source_x_span_m, [-.192, .096], 'Display transport accepted source span')
  if (value.width_scale !== 1 || value.height_scale !== 1) fail('Display transport must preserve liquid width and height scales')
  if (value.wrist_framing !== WRIST_FRAMING) fail('Display transport must disclose the independent Z-only photographic wrist framing')
  const historicalGenerator = plan?.provenance?.spoon_performance?.performance_source_sha256
  if (!/^[a-f0-9]{64}$/.test(historicalGenerator ?? '') || value.cached_performance_generator_sha256 !== historicalGenerator || value.current_performance_script_executed !== false) fail('Display transport must identify the cached performance generator and disclose that the current generator was not executed')
  let anchoring
  if (anchored) {
    if (value.longitudinal_warp_disclosed !== true || value.authored_longitudinal_connector_stretch !== true || value.source_z_preserved !== true || value.transverse_scale !== 1 || value.protected_pool_longitudinal_scale !== 1 || value.height_normalization_applied !== false) fail('Text-anchored transport must disclose connector stretching while preserving pool scale, transverse width and source heights without normalization')
    exact(value.screen_x_anchors, [.1, .3, .5, .7], 'Text column screen anchors')
    const halfWidth = number(value.protected_pool_half_width_m, 'protected source pool half-width', .024)
    const minimumJacobian = number(value.minimum_local_area_jacobian, 'minimum display area Jacobian', Number.MIN_VALUE)
    const sourceX = finiteArray(value.source_x_knots_m, 4, 'source pool X knots')
    const sourceY = finiteArray(value.source_y_knots_m, 4, 'source pool Y knots')
    const targetArc = finiteArray(value.target_arc_knots_m, 4, 'display pool arc knots')
    near(targetArc[0], 0, 'First display arc knot', 1e-7)
    for (let index = 0; index < 4; index++) {
      const state = plan.states[STATION_FRAMES[index] - 1]
      near(sourceX[index], state.nozzle_world[0], `Source pool ${index + 1} physical X knot`, 1e-7)
      near(sourceY[index], state.nozzle_world[1], `Source pool ${index + 1} physical Y knot`, 1e-7)
      if (index && (sourceX[index] - sourceX[index - 1] <= halfWidth * 2 || targetArc[index] - targetArc[index - 1] <= halfWidth * 2)) fail('Protected pool windows must remain disjoint in source and display coordinates')
    }
    const centerline = value.centerline_world_xy_m
    if (!Array.isArray(centerline) || centerline.length < 3) fail('The authored display centerline samples are required')
    const points = centerline.map((point, index) => finiteArray(point, 2, `display centerline point ${index}`))
    const arcLength = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - points[index][0], point[1] - points[index][1]), 0)
    near(targetArc.at(-1), arcLength, 'Final display arc knot versus authored centerline length', 1e-6)
    const sourceConnectors = finiteArray(value.source_connector_lengths_m, 3, 'source connector lengths')
    const displayConnectors = finiteArray(value.display_connector_lengths_m, 3, 'display connector lengths')
    for (let index = 0; index < 3; index++) {
      near(sourceConnectors[index], sourceX[index + 1] - sourceX[index] - halfWidth * 2, `Source connector ${index + 1} length`, 1e-7)
      near(displayConnectors[index], targetArc[index + 1] - targetArc[index] - halfWidth * 2, `Display connector ${index + 1} length`, 1e-7)
    }
    anchoring = { mode: ANCHORED_MODE, longitudinalWarpDisclosed: true, authoredLongitudinalConnectorStretch: true, geometricVolumePreserving: false,
      screenXAnchors: [.1, .3, .5, .7], protectedPoolHalfWidthM: halfWidth, protectedPoolLongitudinalScale: 1,
      sourceZPreserved: true, transverseScale: 1, heightNormalizationApplied: false,
      sourceXKnotsM: sourceX, sourceYKnotsM: sourceY, targetArcKnotsM: targetArc, centerlineWorldXyM: points,
      sourceConnectorLengthsM: sourceConnectors, displayConnectorLengthsM: displayConnectors,
      minimumLocalAreaJacobian: minimumJacobian }
  }
  return { method, sourceXSpanM: [...value.source_x_span_m], authoredCenterline: true,
    hydraulicsRecomputed: false, sourcePreserved: true, widthScale: 1, heightScale: 1,
    cachedPerformanceGeneratorSha256: historicalGenerator, currentPerformanceScriptExecuted: false,
    wristFraming: WRIST_FRAMING,
    ...anchoring,
    physicalInterpretation: anchored
      ? 'Unchanged accepted physical heightfields with authored connector-only longitudinal stretching for text alignment. Displayed mesh volume is measured separately from the unchanged physical mass ledger; no height normalization or curved-route simulation was performed.'
      : 'Authored presentation bend of the unchanged accepted physical heightfields; the curved route was not resimulated.' }
}

function validateFraming(record, displayTransport) {
  if (displayTransport?.mode !== ANCHORED_MODE) return {}
  const frame = record.frame
  const bounds = finiteArray(record.spoon_screen_bounds, 4, `frame ${frame} projected spoon bounds`)
  if (bounds[0] > bounds[2] || bounds[1] > bounds[3] || Math.min(bounds[0], bounds[1], 1 - bounds[2], 1 - bounds[3]) < .01 - 1e-6) fail(`Frame ${frame} spoon must stay within its native photograph with a 1% margin`)
  const nozzle = finiteArray(record.projected_nozzle_uv, 2, `frame ${frame} projected nozzle`)
  if (nozzle.some(value => value < 0 || value > 1)) fail(`Frame ${frame} nozzle lies outside its native photograph`)
  const stop = finiteArray(record.projected_stop_uv, 2, `frame ${frame} projected plate stop`)
  if (stop.some(value => value < 0 || value > 1)) fail(`Frame ${frame} plate stop lies outside its native photograph`)
  const station = STATION_FRAMES.indexOf(frame)
  if (station >= 0) near(stop[0], displayTransport.screenXAnchors[station], `Frame ${frame} plate-stop/text-column alignment`, 1e-5)
  return { spoonScreenBounds: bounds, projectedNozzleUv: nozzle, projectedStopUv: stop }
}

function validateDisplayPose(record, sourcePose, displayTransport) {
  const frame = record.frame
  const sourceLocation = finiteVector(sourcePose.location, `frame ${frame} physical root location`)
  const sourceRotation = finiteVector(sourcePose.rotation_euler, `frame ${frame} physical root rotation`)
  if (!displayTransport) {
    if (record.display_transport !== undefined || record.film?.display_transport !== undefined || record.root_pose_matches_source !== true) fail(`Frame ${frame} does not establish its unchanged physical source pose`)
    nearVector(record.rendered_root_location, sourceLocation, `frame ${frame} rendered root location`)
    nearVector(record.rendered_root_rotation_euler, sourceRotation, `frame ${frame} rendered root rotation`, 1e-6)
    return { rootPoseMatchesSource: true }
  }
  if (record.root_pose_matches_source !== false || record.root_pose_matches_display_transport !== true) fail(`Frame ${frame} must distinguish its transported display pose from its original physical pose`)
  nearVector(record.source_root_location, sourceLocation, `frame ${frame} recorded physical root location`)
  nearVector(record.source_root_rotation_euler, sourceRotation, `frame ${frame} recorded physical root rotation`, 1e-6)
  const transport = record.display_transport
  if (!transport) fail(`Frame ${frame} lacks its display transform`)
  const angle = number(transport.angle_rad, `frame ${frame} display angle`, -Infinity)
  const fieldAngle = number(transport.field_angle_rad, `frame ${frame} liquid field angle`, -Infinity)
  const wristAngle = number(transport.wrist_yaw_adjustment_rad, `frame ${frame} photographic wrist adjustment`, -Infinity)
  near(angle, fieldAngle + wristAngle, `Frame ${frame} independent wrist versus liquid field angle`, 1e-9)
  const sourceAnchor = nearVector(transport.source_anchor_m, sourcePose.nozzle_world, `frame ${frame} original nozzle anchor`)
  const targetAnchor = finiteVector(transport.target_anchor_m, `frame ${frame} display nozzle anchor`)
  near(targetAnchor[2], sourceAnchor[2], `Frame ${frame} display nozzle height`, 1e-9)
  const cosine = Math.cos(angle), sine = Math.sin(angle)
  const rotate = vector => [cosine * vector[0] - sine * vector[1], sine * vector[0] + cosine * vector[1], vector[2]]
  const offset = rotate(sourceLocation.map((value, axis) => value - sourceAnchor[axis]))
  const expectedLocation = targetAnchor.map((value, axis) => value + offset[axis])
  const expectedRotation = [sourceRotation[0], sourceRotation[1], sourceRotation[2] + angle]
  nearVector(record.rendered_root_location, expectedLocation, `frame ${frame} transported root location`)
  nearVector(record.rendered_root_rotation_euler, expectedRotation, `frame ${frame} transported root rotation`, 1e-6)
  const filmTransport = record.film?.display_transport
  if (!filmTransport) fail(`Frame ${frame} liquid surface lacks explicit display transport evidence`)
  near(number(filmTransport.angle_rad, `frame ${frame} liquid display angle`, -Infinity), angle, `Frame ${frame} liquid/spoon display angle`, 1e-9)
  near(number(filmTransport.field_angle_rad, `frame ${frame} recorded liquid field angle`, -Infinity), fieldAngle, `Frame ${frame} liquid field angle binding`, 1e-9)
  near(number(filmTransport.wrist_yaw_adjustment_rad, `frame ${frame} recorded wrist adjustment`, -Infinity), wristAngle, `Frame ${frame} liquid evidence wrist binding`, 1e-9)
  nearVector(filmTransport.source_anchor_m, sourceAnchor, `frame ${frame} liquid original anchor`)
  nearVector(filmTransport.target_anchor_m, targetAnchor, `frame ${frame} liquid display anchor`)
  const rotatedAnchor = rotate(sourceAnchor)
  const translation = targetAnchor.map((value, axis) => value - rotatedAnchor[axis])
  return { rootPoseMatchesSource: false, rootPoseMatchesDisplayTransport: true,
    sourceRootLocationM: sourceLocation, sourceRootRotationEulerRad: sourceRotation,
    displayTransport: { angleRad: angle, fieldAngleRad: fieldAngle, wristYawAdjustmentRad: wristAngle,
      sourceAnchorM: sourceAnchor, targetAnchorM: targetAnchor,
      spoonMatrixRowMajor: [cosine, -sine, 0, translation[0], sine, cosine, 0, translation[1], 0, 0, 1, translation[2], 0, 0, 0, 1] } }
}

function validatePhotography(value) {
  if (value?.projection !== 'perspective') fail('The photographic proof must establish its perspective camera')
  const location = finiteVector(value.camera_location_m, 'camera location')
  const target = finiteVector(value.camera_target_m, 'camera target')
  const focus = finiteVector(value.fixed_focus_point_m, 'fixed camera focus point')
  const forward = target.map((coordinate, axis) => coordinate - location[axis])
  const distance = Math.hypot(...forward)
  if (distance <= 0) fail('Camera location and target must differ')
  const focusDistance = number(value.focus_distance_m, 'camera focus distance', Number.MIN_VALUE)
  const projectedFocusDistance = focus.reduce((sum, coordinate, axis) => sum + (coordinate - location[axis]) * forward[axis] / distance, 0)
  near(focusDistance, projectedFocusDistance, 'Fixed focus point versus lens-plane distance', 1e-6)
  const focusMethod = 'fixed near-end focus; real Cycles aperture depth of field'
  if (value.focus_method !== focusMethod) fail('The photographic proof must establish its actual fixed aperture focus method')
  return {
    projection: 'perspective', cameraLocationM: location, cameraTargetM: target,
    groundHorizontalFieldM: number(value.ground_horizontal_field_m, 'camera ground field', Number.MIN_VALUE),
    lensMm: number(value.lens_mm, 'camera focal length', Number.MIN_VALUE),
    fStop: number(value.f_stop, 'camera aperture', Number.MIN_VALUE),
    fixedFocusPointM: focus, focusDistanceM: focusDistance, focusMethod,
  }
}

function sanitizePerformance(plan) {
  const performance = plan.provenance.spoon_performance
  if (!performance) return undefined
  if (performance.authored_spoon_motion !== true || performance.authored_liquid_outline !== false) fail('The performance must distinguish authored spoon motion from the solved liquid outline')
  const result = { authoredSpoonMotion: true, authoredLiquidOutline: false }
  if (performance.route === 'oblique') {
    const parameters = performance.route_parameters
    if (parameters?.camera_projection_compensation !== true || parameters.spoon_trajectory_authored !== true || parameters.liquid_outline_authored !== false) fail('The oblique route must disclose its authored camera-compensated spoon trajectory')
    const anchors = parameters.station_x_m
    if (!Array.isArray(anchors) || anchors.length !== STATION_FRAMES.length || !anchors.every(Number.isFinite) || anchors.some((value, index) => index > 0 && value <= anchors[index - 1])) fail('Invalid physical projection-compensated X anchors')
    const samples = performance.detent_route_samples
    if (!Array.isArray(samples) || samples.length !== STATION_FRAMES.length || samples.some((sample, index) => sample.frame !== STATION_FRAMES[index])) fail('Missing oblique route detent samples')
    result.route = 'oblique curved approach'
    result.cameraProjectionCompensation = true
    result.stationXM = [...anchors]
    result.farStartYM = number(parameters.far_start_y_m, 'route far-start Y', -Infinity)
    result.nearFinishYM = number(parameters.near_finish_y_m, 'route near-finish Y', -Infinity)
    result.bowM = number(parameters.bow_m, 'route bow', -Infinity)
    result.detents = samples.map((sample, index) => {
      const nozzle = finiteVector(sample.nozzle_world, `route frame ${sample.frame} nozzle`)
      const source = finiteVector(plan.states[sample.frame - 1].nozzle_world, `source frame ${sample.frame} nozzle`)
      for (let axis = 0; axis < 3; axis++) near(nozzle[axis], source[axis], `Route frame ${sample.frame} nozzle axis ${axis}`, 1e-7)
      near(nozzle[0], anchors[index], `Route frame ${sample.frame} physical X anchor`, 1e-7)
      return { frame: sample.frame, nozzleWorldM: nozzle }
    })
  }
  return result
}

function validateRenders(proof, frames, physics, metadata, planHash, sourceStates, displayTransport) {
  if (proof.pipeline !== PIPELINE || proof.diagnostic_only !== false || proof.renderer !== 'Blender Cycles' || proof.units !== 'meters' || proof.full_trail !== true) fail('A complete non-diagnostic conservative-film photographic proof is required')
  exact(frames, FRAMES, 'render-frames.json')
  exact(proof.station_frames, STATION_FRAMES, 'Detent frames')
  if (!Array.isArray(proof.frames) || proof.frames.length !== FRAMES.length || proof.frames.some((record, index) => record.frame !== FRAMES[index])) fail('Render records do not match all 73 actual frames')
  near(number(proof.fps, 'photography fps'), physics.fps, 'Photographic fps', 1e-9)
  const material = proof.material_overrides
  for (const key of ['roughness', 'roughness_variation', 'transmission']) if (number(material?.[key], `material ${key}`) > 1) fail(`Material ${key} exceeds its physical range`)
  number(material.absorption_multiplier, 'material absorption', Number.MIN_VALUE)
  number(material.emulsion_scatter_per_m, 'material scatter')
  const optics = proof.optical_compositing
  if (optics?.film_transparent_glass !== true || optics?.shadow_catcher_visible_transmission !== false || optics?.shadow_catcher_is_shadow_catcher !== true) fail('Native transparent-glass photography must preserve the shadow catcher while excluding its transmission rays')
  near(number(optics.film_transparent_roughness, 'transparent-glass roughness threshold'), .2, 'Transparent-glass roughness threshold', 1e-7)
  const anchored = displayTransport?.mode === ANCHORED_MODE
  const layout = renderLayout(displayTransport)
  return proof.frames.map(record => {
    const frame = record.frame, state = physics.states[frame - 1], geometry = record.geometry, film = record.film
    const sourcePose = sourceStates[frame - 1]
    const poseEvidence = validateDisplayPose(record, sourcePose, displayTransport)
    const framingEvidence = validateFraming(record, displayTransport)
    const station = STATION_FRAMES.includes(frame)
    exact([record.width, record.height], station ? layout.desktop : layout.motion, `Frame ${frame} native source dimensions`)
    if (!Number.isInteger(record.samples) || record.samples < (station ? 128 : 64)) fail(`Frame ${frame} lacks its detent/motion sample quality`)
    if (!/^[a-f0-9]{64}$/.test(record.png_sha256 ?? '')) fail(`Frame ${frame} has no actual PNG hash`)
    if (!geometry || !Number.isInteger(geometry.vertices) || geometry.vertices < 4 || !Number.isInteger(geometry.faces) || geometry.faces < 4 || geometry.nonmanifold_edges !== 0 || geometry.components !== 1) fail(`Frame ${frame} must contain one connected, closed liquid volume`)
    const volume = number(geometry.volume_ml, `frame ${frame} rendered film volume`, Number.MIN_VALUE)
    const sourceVolumeRatio = volume / state.filmVolumeMl
    if (state.filmVolumeMl <= 0 || !Number.isFinite(sourceVolumeRatio)) fail(`Frame ${frame} has no positive physical film volume`)
    if (anchored ? sourceVolumeRatio < .8 || sourceVolumeRatio > 3 : Math.abs(sourceVolumeRatio - 1) > .01) fail(anchored ? `Frame ${frame} displayed/source volume ratio must remain between 0.8 and 3` : `Frame ${frame} mesh volume differs from its solved film by more than 1%`)
    if (film?.frame !== frame || film.model !== metadata.model || film.authored_trail !== false || film.full_3d_Navier_Stokes !== false || film.Mantaflow !== false || film.whole_continuous_film !== true || film.mesh_connected_components !== 1 || film.non_manifold_edges !== 0 || film.source_plan_sha256 !== planHash) fail(`Frame ${frame} does not establish actual connected, unauthored reduced-model liquid`)
    near(number(film.solver_volume_ml, `frame ${frame} solver proof volume`), state.filmVolumeMl, `Frame ${frame} solved volume binding`)
    near(number(film.rendered_volume_ml, `frame ${frame} committed mesh proof volume`), volume, `Frame ${frame} mesh volume binding`, Math.max(1e-6, volume * 1e-5))
    const sourceRelativeError = number(film.relative_volume_error, `frame ${frame} render volume difference`, -1)
    if (!anchored && Math.abs(sourceRelativeError) > .01) fail(`Frame ${frame} render surface exceeds its volume bound`)
    near(sourceRelativeError, sourceVolumeRatio - 1, `Frame ${frame} original physical/display volume difference`, 1e-5)
    let displayVolumeEvidence
    if (anchored) {
      const reference = number(film.display_volume_reference_ml, `frame ${frame} independent mapped-triangle display volume`, Number.MIN_VALUE)
      const difference = volume / reference - 1
      if (Math.abs(difference) > 1e-5) fail(`Frame ${frame} committed display volume differs from its independently computed mapped-triangle reference`)
      const minimumJacobian = number(film.display_minimum_jacobian, `frame ${frame} minimum display Jacobian`, Number.MIN_VALUE)
      displayVolumeEvidence = { displayReferenceVolumeMl: reference, relativeDisplayVolumeError: difference,
        displayVolumeDifferenceMl: volume - state.filmVolumeMl, displayToPhysicalVolumeRatio: sourceVolumeRatio,
        minimumDisplayJacobian: minimumJacobian }
    }
    const reservoir = record.reservoir
    if (reservoir?.frame !== frame) fail(`Frame ${frame} lacks visible reservoir evidence`)
    near(number(reservoir.target_volume_ml, `frame ${frame} visible reservoir target`), state.remainingReservoirMl, `Frame ${frame} analytic reservoir binding`)
    const visibleReservoir = number(reservoir.mesh_volume_ml, `frame ${frame} visible reservoir volume`)
    if (Math.abs(visibleReservoir - state.remainingReservoirMl) > Math.max(1e-6, state.remainingReservoirMl * .01)) fail(`Frame ${frame} visible reservoir exceeds its analytic volume bound`)
    near(number(record.expected_emitted_volume_ml, `frame ${frame} expected emission`), state.plannedEmittedMl, `Frame ${frame} expected emission binding`)
    near(number(record.remaining_reservoir_volume_ml, `frame ${frame} remaining reservoir`), state.remainingReservoirMl, `Frame ${frame} remaining reservoir binding`)
    return { frame, sourceWidth: record.width, sourceHeight: record.height, renderSamples: record.samples,
      ...poseEvidence, ...framingEvidence, ...displayVolumeEvidence, renderedRootLocationM: record.rendered_root_location,
      renderedRootRotationEulerRad: record.rendered_root_rotation_euler,
      sourceResolutionTier: station ? 'native-1920-detent' : 'native-1280-motion-upscaled-for-desktop',
      pngSha256: record.png_sha256, vertices: geometry.vertices, faces: geometry.faces,
      nonmanifoldEdges: 0, components: 1, solverVolumeMl: state.filmVolumeMl, renderedVolumeMl: volume,
      relativeRenderVolumeError: sourceRelativeError, analyticReservoirVolumeMl: state.remainingReservoirMl,
      visibleReservoirVolumeMl: visibleReservoir,
      renderMeniscusSigmaM: number(film.render_meniscus_sigma_m, `frame ${frame} render meniscus sigma`),
      renderHeightNormalization: number(film.render_height_normalization, `frame ${frame} render height normalization`, Number.MIN_VALUE),
      contactOffsetM: number(film.contact_offset_m, `frame ${frame} render contact offset`),
    }
  })
}

let stage, backup, temporaryRegistry, installed = false, registryCommitted = false
try {
  const [render, proof, studio, studioBlend, metadata, dataset, ledger, plan, sources] = await Promise.all([
    read(INPUT, 'render-frames.json'), read(INPUT, 'render-provenance.json'), read(INPUT, 'scene-provenance.json'), read(INPUT, 'plating.blend', false),
    read(FILM, 'metadata.json'), read(FILM, 'heightfields.npz', false), read(FILM, 'volume-ledger.json'), read(FILM, 'reservoir-plan.json'), sourcesNow(),
  ])
  const hashes = proof.value.source_hashes
  if (!hashes || Object.keys(hashes).length !== SOURCES.length || sources.some(source => hashes[source.path] !== source.sha256)) fail('All twelve photographed studio/solver/render sources must match their exact recorded hashes')
  for (const source of sources.filter(item => STUDIO.includes(item.path))) if (studio.value.source_hashes?.[source.path] !== source.sha256) fail(`${source.path} differs from the saved photography studio`)
  const byPath = new Map(sources.map(source => [source.path, source.sha256]))
  if (metadata.value.solver_source_sha256 !== byPath.get(PHYSICAL[1]) || metadata.value.python_source_sha256 !== byPath.get(PHYSICAL[0]) || metadata.value.source_plan_sha256 !== plan.sha256) fail('Solved film metadata is not bound to the current C++/Python solver and finite source plan')
  const bindings = { studio_blend_sha256: studioBlend.sha256, studio_provenance_sha256: studio.sha256,
    physics_metadata_sha256: metadata.sha256, physics_dataset_sha256: dataset.sha256,
    physics_ledger_sha256: ledger.sha256, reservoir_plan_sha256: plan.sha256 }
  for (const [key, hash] of Object.entries(bindings)) if (proof.value[key] !== hash) fail(`Photographic ${key} binding differs from the actual input`)
  const displayTransport = validateDisplayTransport(proof.value.display_transport, plan.value)
  if (displayTransport) for (const [key, hash] of Object.entries(ACCEPTED_SOURCE_HASHES)) {
    if (bindings[key] !== hash) fail(`Crescent display transport must reuse the unchanged accepted ${key}`)
  }
  if (studio.value.units !== 'meters') fail('Photography studio units must be metres')
  const physics = validatePhysics(metadata.value, plan.value, ledger.value)
  const camera = validatePhotography(proof.value.photography)
  const spoonPerformance = sanitizePerformance(plan.value)
  const records = validateRenders(proof.value, render.value, physics, metadata.value, plan.sha256, plan.value.states, displayTransport)
  const layout = renderLayout(displayTransport)
  const oldRegistry = await fs.readFile(REGISTRY, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (oldRegistry && (JSON.parse(oldRegistry).assets || []).some(asset => !String(asset.file).startsWith('art/plating/'))) fail('Preserve artwork outside this timeline before replacing its registry')
  const blender = String(proof.value.blender || '').match(/^\d+\.\d+(?:\.\d+)?(?:\s+LTS)?/)?.[0]
  if (!blender) fail('Missing actual Blender version')
  const provenance = {
    kind: 'authored-3d-render', pipeline: PIPELINE, renderer: 'Blender Cycles', blender, units: 'meters', fps: physics.fps,
    photographyStudioOnly: true,
    ...(displayTransport ? { displayTransport: { ...displayTransport, sourceProofHashes: ACCEPTED_SOURCE_HASHES } } : {}),
    physics: { model: MODEL, equation: 'dh/dt = div(g*h^3/(3*nu)*grad(h)) + finite Gaussian source',
      full3dNavierStokes: false, fullMovingCupCfd: false, Mantaflow: false, surfaceTensionPressure: false, authoredTrail: false,
      coupling: 'one-way prescribed analytic-reservoir discharge into a conservative gravity/lubrication film',
      simulatedFrames: 180, initialReservoirVolumeMl: physics.initial, finalFilmVolumeMl: physics.states.at(-1).filmVolumeMl,
      remainingReservoirVolumeMl: physics.states.at(-1).remainingReservoirMl, maximumCombinedMassErrorMl: physics.maximumError,
      kinematicViscosityM2S: physics.nu, gravityMS2: number(metadata.value.gravity_m_s2, 'gravity', Number.MIN_VALUE),
      grid: metadata.value.grid, dxM: physics.dx, domainXyM: metadata.value.domain_xy_m, boundary: 'closed no-flux',
      sourceSigmaM: number(metadata.value.source_sigma_m, 'source Gaussian sigma', Number.MIN_VALUE),
      sourceTruncationSigma: number(metadata.value.source_truncation_sigma, 'source Gaussian truncation', Number.MIN_VALUE),
      impact: 'Ballistic flight to the plate using relative exit velocity plus actual nozzle translation',
      spoonPerformance,
      massLedger: physics.states,
      assumptions: ['Reduced Newtonian low-Re gravity/lubrication model; no 3D jet inertia, sloshing, wetting hysteresis or capillary pressure.',
        'Reservoir discharge, ballistic landing and Gaussian impact footprint are explicit approximations; sauce rheology is not measured.',
        'Render-only contact-line smoothing is volume-normalised and is separate from the physical height evolution.',
        ...(displayTransport ? ['The cached physical solution and discharge timing are unchanged. The displayed crescent is an authored geometric transport, not a new simulation of liquid flowing along that curve.'] : []),
        ...(displayTransport?.mode === ANCHORED_MODE ? ['Only the thin connectors are stretched longitudinally to align the four protected pools with text columns. Displayed mesh volume is independently measured and differs from the original physical mass ledger; no post-transport height or volume normalization is applied.'] : [])],
    },
    photography: { camera, materialOverrides: {
      roughness: proof.value.material_overrides.roughness, roughnessVariation: proof.value.material_overrides.roughness_variation,
      absorptionMultiplier: proof.value.material_overrides.absorption_multiplier,
      emulsionScatterPerM: proof.value.material_overrides.emulsion_scatter_per_m,
      transmission: proof.value.material_overrides.transmission },
      opticalCompositing: proof.value.optical_compositing,
      lastPhotographedFrame: 168, desktopEncoding: layout.desktop, mobileEncoding: layout.mobile, sourceTiers: 'Native 1920 detents; native 1280 motion explicitly upscaled for desktop', frames: records },
    sources, sourceStages: { studio: STUDIO, physicalSolver: PHYSICAL, photography: RENDER },
    proofHashes: { ...bindings, renderProvenance: proof.sha256, renderFrames: render.sha256 },
  }
  stage = await fs.mkdtemp(path.join(INPUT, '.thinfilm-package-'))
  await Promise.all(['desktop', 'mobile'].map(directory => fs.mkdir(path.join(stage, directory))))
  const assets = []
  let finalSource
  sharp.concurrency(2)
  for (let index = 0; index < records.length; index++) {
    const record = records[index], filename = `${String(index).padStart(4, '0')}.png`
    const bytes = await fs.readFile(path.join(INPUT, 'frames', filename))
    if (sha(bytes) !== record.pngSha256) fail(`${filename} differs from its photographed per-frame PNG hash`)
    if (AI_CREDENTIAL.test(bytes.toString('latin1'))) fail(`${filename} carries a generative-AI content credential`)
    const image = await sharp(bytes, { failOn: 'error' }).metadata()
    if (image.format !== 'png' || image.hasAlpha !== true || image.width !== record.sourceWidth || image.height !== record.sourceHeight) fail(`${filename} lacks the exact recorded PNG dimensions and alpha channel`)
    for (const variant of [{ directory: 'desktop', width: layout.desktop[0], height: layout.desktop[1] }, { directory: 'mobile', width: layout.mobile[0], height: layout.mobile[1] }]) {
      const buffer = await sharp(bytes).resize(variant.width, variant.height, { fit: 'inside' }).webp({ quality: 90, effort: 4 }).toBuffer()
      const dimensions = await sharp(buffer).metadata()
      if (dimensions.width !== variant.width || dimensions.height !== variant.height || dimensions.hasAlpha !== true) fail(`${filename} failed aspect-preserving alpha encoding`)
      const relative = `${variant.directory}/${String(index).padStart(4, '0')}.webp`
      await fs.writeFile(path.join(stage, relative), buffer)
      assets.push({ file: `art/plating/${relative}`, sha256: sha(buffer) })
    }
    if (index === records.length - 1) finalSource = bytes
    if ((index + 1) % 12 === 0 || index === records.length - 1) console.log(`Encoded ${index + 1}/${records.length} verified alpha photographs.`)
  }
  for (const width of [1280, 640, 1920]) {
    const name = `poster-${width}.webp`
    const buffer = await sharp(finalSource).resize(width, Math.round(width * layout.desktop[1] / layout.desktop[0]), { fit: 'inside' }).webp({ quality: 90, effort: 4 }).toBuffer()
    await fs.writeFile(path.join(stage, name), buffer)
    assets.push({ file: `art/plating/${name}`, sha256: sha(buffer) })
  }
  const manifest = { version: 1, pipeline: PIPELINE, frames: render.value, stations: STATION_FRAMES.map(frame => FRAMES.indexOf(frame)),
    desktop: { width: layout.desktop[0], height: layout.desktop[1], directory: 'desktop' }, mobile: { width: layout.mobile[0], height: layout.mobile[1], directory: 'mobile' },
    poster: 'poster-1280.webp', provenance: { kind: 'authored-3d-render', pipeline: PIPELINE, renderer: 'Blender Cycles', blender,
      file: 'scene-provenance.json', proofHashes: provenance.proofHashes,
      ...(displayTransport ? { displayTransport } : {}) } }
  await fs.writeFile(path.join(stage, 'sequence.json'), JSON.stringify(manifest, null, 2) + '\n')
  await fs.writeFile(path.join(stage, 'scene-provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
  const current = await sourcesNow()
  if (sources.some((source, index) => source.sha256 !== current[index].sha256)) fail('A studio/solver/render source changed during packaging')
  const registry = { kind: 'authored-3d-render', pipeline: PIPELINE, sources, assets: assets.sort((a, b) => a.file.localeCompare(b.file)) }
  await fs.mkdir(path.dirname(DESTINATION), { recursive: true })
  if (await fs.stat(DESTINATION).then(() => true).catch(error => error.code === 'ENOENT' ? false : Promise.reject(error))) {
    backup = path.join(INPUT, `.previous-plating-${Date.now()}-${process.pid}`)
    await fs.rename(DESTINATION, backup)
  }
  await fs.rename(stage, DESTINATION); stage = null; installed = true
  temporaryRegistry = `${REGISTRY}.tmp-${process.pid}`
  await fs.writeFile(temporaryRegistry, JSON.stringify(registry, null, 2) + '\n')
  await fs.rename(temporaryRegistry, REGISTRY); temporaryRegistry = null; registryCommitted = true
  if (backup) { await fs.rm(backup, { recursive: true }).catch(error => console.warn(`Previous timeline retained at ${backup}: ${error.message}`)); backup = null }
  console.log(`Packaged ${records.length} actual conservative-film photographs, four native detents, two encodings and three alpha posters.`)
  console.log(`Finite volume: ${physics.initial.toFixed(9)} ml = ${physics.states.at(-1).filmVolumeMl.toFixed(9)} ml film + ${physics.states.at(-1).remainingReservoirMl.toFixed(9)} ml reservoir.`)
  if (displayTransport?.mode === ANCHORED_MODE) console.log(`Displayed frame ${records.at(-1).frame}: ${records.at(-1).renderedVolumeMl.toFixed(9)} ml mesh; ${records.at(-1).solverVolumeMl.toFixed(9)} ml unchanged physical film. Authored connector stretching is recorded separately.`)
  console.log(`Sequence: ${path.join(DESTINATION, 'sequence.json')}`)
} catch (error) {
  if (!registryCommitted && backup) { await fs.rm(DESTINATION, { recursive: true, force: true }).catch(() => {}); await fs.rename(backup, DESTINATION).catch(() => {}); backup = null }
  else if (!registryCommitted && installed) await fs.rm(DESTINATION, { recursive: true, force: true }).catch(() => {})
  if (stage) await fs.rm(stage, { recursive: true }).catch(() => {})
  if (temporaryRegistry) await fs.rm(temporaryRegistry, { force: true }).catch(() => {})
  console.error(`Thin-film package rejected: ${error.message}`)
  process.exitCode = 1
}
